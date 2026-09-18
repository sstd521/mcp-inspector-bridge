/**
 * 运行时日志监听器 (Runtime Log Listener)
 *
 * 采用 Hybrid 三层策略：
 *   1. 主进程尝试注册 console-message 事件（对 BrowserView 类型有效）
 *   2. 对 <webview> 类型：优先 CDP debugger 附加监听 Runtime.consoleAPICalled
 *      （零注入，完美保留 DevTools 源归属）
 *   3. CDP 不可用时降级：通过 executeJavaScript 注入 Proxy 包装脚本
 *
 * 为什么需要 CDP 优先？
 *   Electron <webview> 的 console 输出不触发主进程 console-message 事件。
 *   之前唯一的方案是注入 Proxy 包装脚本，但这会导致 DevTools 中所有日志
 *   的源归属显示为注入脚本（mcp-log-capture.js），无法定位真实调用位置。
 *   CDP Runtime.consoleAPICalled 事件自带正确的 stackTrace，无需任何注入。
 */
declare const Editor: any;

/** 单条日志条目 */
export interface CdpLogEntry {
    cursor: number;
    type: string;          // "log" | "warn" | "error"
    timestamp: number;
    message: string;
    args: any[];
    name?: string;
    stack?: string;
    url?: string;
    // CDP coordinates: zero-based, including injected/native-event sources.
    line?: number;
    column?: number;
}

export interface CdpLogsQuery {
    tail?: number;
    level?: 'all' | 'warn' | 'error';
    sinceCursor?: number;
}

export interface CdpLogsResult {
    items: CdpLogEntry[];
    nextCursor: number;
    total: number;
    dropped: number;
    truncated: boolean;
}

const MAX_BUFFER = 500;
const MAX_MSG_LEN = 300;
const MAX_URL_LEN = 300;

let buffer: CdpLogEntry[] = [];
let targetWC: any = null;
let listening = false;
let _useInjection = false; // ★ 是否使用了注入模式（webview 场景）
let _useCdp = false;      // ★ 是否使用 CDP debugger 模式（webview 场景优先）
let _cdpAttached = false;
let _eventCount = 0;
let _nextCursor = 0;
let _nativeConsoleListener: any = null;
let _cdpMessageListener: any = null;
let _cdpDetachListener: any = null;
let _targetDestroyedListener: any = null;
const CDP_PROTOCOL_VERSION = '1.3';

/** 将日志条目推入 RingBuffer（自动截断到 MAX_BUFFER 上限） */
function redact(value: any, limit: number): string {
    return String(value || '')
        .replace(/\b(password|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token|x-?api[_-]?key|api[_-]?key)["']?\s*[:=]\s*(["'])(?:\\.|(?!\2)[^\\])*\2/gi, '$1=$2[REDACTED]$2')
        .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n,]*/gi, '$1: [REDACTED]')
        .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(/(https?:\/\/)[^\s/?#]+@/gi, '$1[REDACTED]@')
        .replace(/([?&;,#\s]|^)(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\s*[=:]\s*[^&#\s,;]+/gi, '$1$2=[REDACTED]')
        .replace(/\b(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\s+[^\s,;]+/gi, '$1 [REDACTED]')
        .replace(/\bcookie\s+[^\r\n,]*/gi, 'cookie [REDACTED]')
        .replace(/(["'])(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\1\s*:\s*(["'])[^"']*\3/gi, '$1$2$1: $3[REDACTED]$3')
        .slice(0, limit);
}

function push(e: Omit<CdpLogEntry, 'cursor'>): void {
    _eventCount = Math.min(Number.MAX_SAFE_INTEGER, _eventCount + 1);
    _nextCursor = Math.min(Number.MAX_SAFE_INTEGER, _nextCursor + 1);
    buffer.push({
        ...e,
        cursor: _nextCursor,
        message: redact(e.message, MAX_MSG_LEN),
        url: e.url ? redact(e.url, MAX_URL_LEN) : undefined,
        name: e.name ? redact(e.name, 128) : undefined,
        stack: e.stack ? redact(e.stack, 4096) : undefined,
        line: Number.isSafeInteger(e.line) && e.line! >= 0 ? e.line : undefined,
        column: Number.isSafeInteger(e.column) && e.column! >= 0 ? e.column : undefined,
    });
    if (buffer.length > MAX_BUFFER) buffer.shift();
}

function detachDebugger(): void {
    if (_cdpAttached && targetWC && !targetWC.isDestroyed?.()) {
        try { (targetWC as any).debugger.detach(); } catch (_) {}
    }
    _cdpAttached = false;
}

/** 将 CDP Runtime.consoleAPICalled 事件的 args (RemoteObject[]) 解析为可读字符串 */
function parseCdpArgs(args: any[]): string {
    return args.map((a: any) => {
        if (a.type === 'string' && a.value !== undefined) return a.value;
        if (a.type === 'undefined') return 'undefined';
        if (a.type === 'null' || a.value === null) return 'null';
        if (a.type === 'number' || a.type === 'boolean') return String(a.value);
        if (a.type === 'object' && a.description) return a.description;
        if (a.type === 'function' && a.description) return a.description;
        if (a.value !== undefined) return String(a.value);
        return a.description || `[${a.type}]`;
    }).join(' ');
}

/** 处理 CDP Runtime.consoleAPICalled 事件，转为 CdpLogEntry 并推入 buffer */
function handleCdpConsoleEvent(params: any): void {
    const rawType = params.type || 'log';
    const type = rawType === 'warning' ? 'warn' : rawType;
    const message = parseCdpArgs(params.args || []);
    const firstFrame = params.stackTrace?.callFrames?.[0];
    const error = (params.args || []).find((arg: any) => arg.subtype === 'error');

    push({
        type,
        timestamp: params.timestamp || Date.now(),
        message,
        args: [],
        url: firstFrame?.url,
        line: firstFrame?.lineNumber,
        column: firstFrame?.columnNumber,
        name: error?.className,
        stack: [error?.description, cdpStack(params.stackTrace)].filter(Boolean).join('\n'),
    });
}

function cdpStack(trace: any): string {
    // ponytail: bound async-parent traversal; diagnostics need no source-map resolver.
    const frames: string[] = [];
    for (let depth = 0; trace && depth < 8 && frames.length < 32; depth++, trace = trace.parent) {
        for (const frame of (trace.callFrames || []).slice(0, 32 - frames.length)) {
            frames.push(`    at ${frame.functionName || '<anonymous>'} (${frame.url || ''}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`);
        }
    }
    return frames.join('\n');
}

function handleCdpException(params: any): void {
    const details = params.exceptionDetails || {};
    const error = details.exception || {};
    push({
        type: 'error', timestamp: params.timestamp || Date.now(), args: [],
        message: error.description || (error.value !== undefined ? String(error.value) : details.text) || 'Uncaught exception',
        name: error.className,
        stack: [error.description, cdpStack(details.stackTrace)].filter(Boolean).join('\n'),
        url: details.url, line: details.lineNumber, column: details.columnNumber,
    });
}

/**
 * 要注入到 webview 页面内的 JS 代码（IIFE）
 *
 * 原理：包装 console.log/warn/error，每次调用时将副本写入 window.__mcpLogBuffer。
 * 原始行为完全不变（originalFn.apply(console, args)），零视觉影响。
 * 来源追踪通过 Error.stack 解析获取（仅用于内部存储，不注入输出文本）。
 */
const INJECTION_SCRIPT = `
//# sourceURL=mcp-log-capture.js
(function(){
    if (window.__mcpLogInjected) return;
    window.__mcpLogInjected = true;
    window.__mcpLogBuffer = [];
    var MAX = 1000;
    var MAX_TEXT = 300;
    var restores = [];
    var active = true;

    function redact(value, limit) {
        return String(value || '')
            .replace(/\\b(password|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token|x-?api[_-]?key|api[_-]?key)["']?\\s*[:=]\\s*(["'])(?:\\\\.|(?!\\2)[^\\\\])*\\2/gi, '$1=$2[REDACTED]$2')
            .replace(/\\b(authorization|cookie|set-cookie)\\s*[:=]\\s*[^\\r\\n,]*/gi, '$1: [REDACTED]')
            .replace(/\\bbearer\\s+[^\\s,;]+/gi, 'Bearer [REDACTED]')
            .replace(/(https?:\\/\\/)[^\\s/?#]+@/gi, '$1[REDACTED]@')
            .replace(/([?&;,#\\s]|^)(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\\s*[=:]\\s*[^&#\\s,;]+/gi, '$1$2=[REDACTED]')
            .replace(/\\b(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\\s+[^\\s,;]+/gi, '$1 [REDACTED]')
            .replace(/\\bcookie\\s+[^\\r\\n,]*/gi, 'cookie [REDACTED]')
            .replace(/(["'])(access[_-]?token|refresh[_-]?token|token|password|client[_-]?secret|secret|x-?api[_-]?key|api[_-]?key)\\1\\s*:\\s*(["'])[^"']*\\3/gi, '$1$2$1: $3[REDACTED]$3')
            .slice(0, limit);
    }
    
    function parseCaller() {
        try { throw new Error('_'); } catch(e) {
            var lines = e.stack.split('\\n');
            // 调用栈: [0]=Error, [1]=parseCaller, [2]=capture, [3~N]=console包装层/真实调用者
            for (var i = 3; i < Math.min(lines.length, 16); i++) {
                var m = lines[i].match(/\\((.+?):(\\d+):(\\d+)\\)/);
                if (!m) m = lines[i].match(/at\\s+(.+?):(\\d+):(\\d+)/);
                if (m && !m[1].includes('mcp-log-capture')) return { url: m[1], line: parseInt(m[2]) - 1, col: parseInt(m[3]) - 1 };
            }
        }
        return null;
    }
    
    function capture(type, args, source) {
        if (!active) return;
        try {
            var caller = source || parseCaller();
            var error = Array.prototype.find.call(args, function(a) { return a && typeof a.stack === 'string'; });
            var msg = Array.prototype.slice.call(args).map(function(a) {
                if (a && typeof a.stack === 'string') return a.message || a.stack;
                if (typeof a === 'object') try { return JSON.stringify(a); } catch(e) {}
                return String(a);
            }).join(' ');
            var entry = {
                t: type === 'warning' ? 'warn' : type,
                ts: Date.now(),
                m: redact(msg, MAX_TEXT),
                n: error ? redact(error.name, 128) : undefined,
                s: error ? redact(error.stack, 4096) : undefined,
                u: caller ? redact(caller.url, MAX_TEXT) : undefined,
                l: caller ? caller.line : undefined,
                c: caller ? caller.col : undefined
            };
            window.__mcpLogBuffer.push(entry);
            if (window.__mcpLogBuffer.length > MAX) window.__mcpLogBuffer.shift();
        } catch(_) {}
    }

    function createProxy(orig, k) {
        return new Proxy(orig, {
            apply: function(target, thisArg, argumentsList) {
                if (window.__mcpLogRecursionGuard) {
                    return Reflect.apply(target, thisArg, argumentsList);
                }
                window.__mcpLogRecursionGuard = true;
                try {
                    capture(k, argumentsList);
                    return Reflect.apply(target, thisArg, argumentsList);
                } finally { window.__mcpLogRecursionGuard = false; }
            }
        });
    }
    function wrap(owner, key) {
        var original = owner[key];
        var proxy = createProxy(original, key);
        owner[key] = proxy;
        restores.push(function() { if (owner[key] === proxy) owner[key] = original; });
    }

    function onError(event) {
        capture('error', [event.error || event.message], { url: event.filename, line: event.lineno - 1, col: event.colno - 1 });
    }
    function onRejection(event) { capture('error', [event.reason]); }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.__mcpLogCleanup = function() {
        active = false;
        clearInterval(timer);
        clearTimeout(stopTimer);
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        restores.forEach(function(restore) { restore(); });
        window.__mcpLogInjected = false;
        window.__mcpCcHijacked = false;
        window.__mcpLogBuffer = [];
        delete window.__mcpLogCleanup;
    };
    
    var methods = ['log', 'warn', 'error', 'info', 'debug'];
    methods.forEach(function(k) {
        if (console[k]) {
            wrap(console, k);
        }
    });

    // 侵入式劫持 cc API，支持稍后加载的 cc
    var hijackCc = function() {
        if (window.cc && !window.__mcpCcHijacked) {
            window.__mcpCcHijacked = true;
            ['log', 'warn', 'error'].forEach(function(k) {
                if (window.cc[k]) {
                    wrap(window.cc, k);
                }
            });
            console.log('[MCP] cc 对象引擎日志通道劫持已完成');
        }
    };
    
    // 立即尝试，未就绪时轮询
    hijackCc();
    if (!window.__mcpCcHijacked) {
        var timer = setInterval(function() {
            hijackCc();
            if (window.__mcpCcHijacked) clearInterval(timer);
        }, 500);
        // 10秒后停止轮询，防止非 cocos 环境死循环
        var stopTimer = setTimeout(function() { clearInterval(timer); }, 10000);
    }
    
    console.log('[MCP] 日志捕获已启用');
})();
`;

/**
 * 初始化日志监听器（幂等 — 重复调用安全）
 */
export async function initCdpLogListener(silent = false): Promise<boolean> {
    if (listening && targetWC && !targetWC.isDestroyed()) return true;
    if (listening && (!targetWC || targetWC.isDestroyed?.())) {
        listening = false;
        targetWC = null;
        _useInjection = false;
        _cdpAttached = false;
    }

    try {
        const { webContents } = require('electron');
        const all = webContents.getAllWebContents();

        if (!silent) Editor.log(`[CDP Log] 扫描到 ${all.length} 个 WebContents`);

        // 查找预览游戏页面
        const game = all.find((w: any) => {
            const u = w.getURL();
            if (!u || w.isDestroyed?.()) return false;
            if (u.includes('inspector') || u.startsWith('chrome-extension') || u === 'about:blank') return false;
            return /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(u);
        });

        if (!game) {
            if (!silent) Editor.log('[CDP Log] 未找到匹配的预览页面 WebContents');
            return false;
        }

        if (!silent) Editor.log(`[CDP Log] ✓ 找到目标: id=${game.id} type=${game.getType?.()}`);
        targetWC = game;

        const wcType = game.getType?.() || 'unknown';

        if (wcType === 'webview') {
            // ★ Webview 模式: CDP debugger 优先 + 注入降级
            try {
                // 尝试通过 CDP debugger 附加（零侵入，无源归属问题）
                if (!silent) Editor.log('[CDP Log] 尝试 CDP debugger 附加到 webview...');

                (game as any).debugger.attach(CDP_PROTOCOL_VERSION);
                _cdpAttached = true;
                await (game as any).debugger.sendCommand('Runtime.enable');

                // 注册 CDP 事件监听
                _cdpMessageListener = (_ev: any, method: string, params: any) => {
                    if (method === 'Runtime.consoleAPICalled') {
                        handleCdpConsoleEvent(params);
                    } else if (method === 'Runtime.exceptionThrown') {
                        handleCdpException(params);
                    }
                };
                (game as any).debugger.on('message', _cdpMessageListener);

                // 监听 debugger 被外部 detach（如用户打开 DevTools）
                _cdpDetachListener = (_ev: any, reason: string) => {
                    if (!silent) Editor.log(`[CDP Log] Debugger 被外部 detach (${reason})，降级到注入方案`);
                    _useCdp = false;
                    _cdpAttached = false;
                    _useInjection = true;
                    // 尝试注入作为补救
                    game.executeJavaScript(INJECTION_SCRIPT).catch(() => {});
                };
                (game as any).debugger.on('detach', _cdpDetachListener);

                _useCdp = true;
                _useInjection = false;
                if (!silent) Editor.log('[CDP Log] ✓ CDP debugger 附加成功，使用 Runtime.consoleAPICalled 监听日志');
            } catch (e: any) {
                // CDP 附加失败（如 DevTools 已占用），降级到注入方案
                if (!silent) Editor.log(`[CDP Log] Debugger 附加失败 (${e.message})，降级到注入方案`);
                detachDebugger();

                try {
                    await game.executeJavaScript(INJECTION_SCRIPT);
                    _useCdp = false;
                    _useInjection = true;

                    // 验证注入是否生效
                    await new Promise<void>((resolve) => setTimeout(resolve, 200));
                    const testResult: any = await game.executeJavaScript(`
                        JSON.stringify({
                            injected: !!window.__mcpLogInjected,
                            bufferSize: window.__mcpLogBuffer ? window.__mcpLogBuffer.length : -1
                        })
                    `);
                    if (!silent) Editor.log(`[CDP Log] 注入降级验证结果: ${testResult}`);
                } catch (injErr: any) {
                    if (!silent) Editor.error('[CDP Log] 注入降级也失败了:', injErr.message);
                }
            }
        } else {
            // ★ 非 Webview 模式：使用原生 console-message 事件
            _useInjection = false;
            _nativeConsoleListener = (_ev: any, level: number, message: string, line: number, sourceId: string) => {
                push({
                    type: level === 1 ? 'warn' : (level >= 2 ? 'error' : 'log'),
                    timestamp: Date.now(),
                    message,
                    args: [],
                    url: sourceId || undefined,
                    line: Number.isSafeInteger(line) && line > 0 ? line - 1 : undefined,
                    column: undefined,
                });
            };
            game.on('console-message', _nativeConsoleListener);
        }

        _targetDestroyedListener = () => {
            if (!silent) Editor.log('[CDP Log] 目标 WebContents 已销毁');
            listening = false;
            targetWC = null;
            _useInjection = false;
            _useCdp = false;
            _cdpAttached = false;
        };
        game.once('destroyed', _targetDestroyedListener);

        listening = true;
        if (!silent) Editor.log(`[CDP Log] ✓ 初始化完成 (mode=${_useCdp ? 'cdp-debugger' : (_useInjection ? 'injection' : 'native-event')})`);
        return true;
    } catch (e: any) {
        detachCdpListener();
        if (!silent) Editor.error('[CDP Log] initCdpLogListener 失败:', e.message || e);
        return false;
    }
}

/**
 * 获取缓存日志（支持 tail 截断和 level 过滤）
 * 
 * @param tail - 最多返回的条目数（默认 30，上限 100）
 * @param level - 过滤级别: "all" | "warn" | "error"
 */
export async function getCdpLogs(query: CdpLogsQuery = {}): Promise<CdpLogsResult> {
    const tail = Number.isSafeInteger(query.tail) && (query.tail as number) >= 1
        ? Math.min(query.tail as number, 100)
        : 30;
    const level = query.level === 'all' || query.level === 'error' || query.level === 'warn' ? query.level : 'warn';
    const sinceCursor = Number.isSafeInteger(query.sinceCursor) && (query.sinceCursor as number) >= 0
        ? query.sinceCursor as number
        : 0;
    // 如果是注入模式，先从 webview 轮询最新数据
    if (_useInjection && !_useCdp && targetWC && !targetWC.isDestroyed?.()) {
        try {
            const raw: any = await targetWC.executeJavaScript(`
                (function() {
                    if (!window.__mcpLogBuffer) return [];
                    var data = window.__mcpLogBuffer.slice();
                    window.__mcpLogBuffer = [];
                    return data;
                })()
            `);
            if (Array.isArray(raw)) {
                for (const entry of raw) {
                    push({
                        type: entry.t || 'log',
                        timestamp: entry.ts || Date.now(),
                        message: entry.m || '',
                        name: entry.n,
                        stack: entry.s,
                        args: [],
                        url: entry.u,
                        line: entry.l,
                        column: entry.c,
                    });
                }
            }
        } catch (_) {
            // 轮询失败时返回已有缓存
        }
    }

    const newestCursor = _nextCursor;
    const reset = sinceCursor > newestCursor;
    const effectiveSince = reset ? 0 : sinceCursor;
    const oldestCursor = buffer[0]?.cursor || newestCursor + 1;
    const dropped = !reset ? Math.max(0, oldestCursor - 1 - effectiveSince) : 0;
    let r = buffer.filter(e => e.cursor > effectiveSince);

    if (level === 'error') {
        r = r.filter(e => e.type === 'error');
    } else if (level === 'warn') {
        r = r.filter(e => e.type === 'warn' || e.type === 'error');
    }

    const items = r.slice(-tail);
    // Bound UTF-8 bytes too: a full tail of stacks can otherwise exceed IPC/MCP budgets.
    let bytes = Buffer.byteLength(JSON.stringify(items), 'utf8');
    while (items.length > 1 && bytes > 100 * 1024 - 512) {
        bytes -= Buffer.byteLength(JSON.stringify(items.shift()), 'utf8') + 1;
    }
    return {
        items,
        nextCursor: newestCursor,
        total: r.length,
        dropped,
        truncated: reset || dropped > 0 || r.length > items.length,
    };
}

/** 获取当前连接状态和缓冲区大小 */
export function getCdpStatus(): { attached: boolean; size: number; method: string; eventCount: number; injection: boolean; cdp: boolean } {
    let method = 'native-event';
    if (_useCdp) method = 'cdp-debugger';
    else if (_useInjection) method = 'webview-injection';

    return {
        attached: listening,
        size: buffer.length,
        method,
        eventCount: _eventCount,
        injection: _useInjection,
        cdp: _useCdp,
    };
}

/** 断开并清空 */
export function detachCdpListener(): void {
    const current = targetWC;
    if (_useInjection && current && !current.isDestroyed?.()) {
        try { current.executeJavaScript('window.__mcpLogCleanup && window.__mcpLogCleanup()').catch(() => {}); } catch (_) {}
    }
    try {
        if (_nativeConsoleListener) current?.removeListener?.('console-message', _nativeConsoleListener);
        if (_targetDestroyedListener) current?.removeListener?.('destroyed', _targetDestroyedListener);
        if (_cdpMessageListener) current?.debugger?.removeListener?.('message', _cdpMessageListener);
        if (_cdpDetachListener) current?.debugger?.removeListener?.('detach', _cdpDetachListener);
    } catch (_) {
        // 目标销毁期间移除监听器可能失败，仍继续释放其余资源
    }
    detachDebugger();
    targetWC = null;
    listening = false;
    _useInjection = false;
    _useCdp = false;
    _nativeConsoleListener = null;
    _cdpMessageListener = null;
    _cdpDetachListener = null;
    _targetDestroyedListener = null;
    buffer = [];
}
