import * as WebSocket from 'ws';
import { randomBytes } from 'crypto';
declare const Editor: any;

const TOOL_IPC_MAP: Record<string, string> = {
    'get_selected_node': 'mcp-query-selected-node',
    'capture_runtime_screenshot': 'mcp-capture-screenshot',
    'get_node_detail': 'mcp-query-node-detail',
    'update_node_property': 'mcp-update-property',
    'get_memory_ranking': 'mcp-query-memory',
    'simulate_input': 'mcp-simulate-input',
    'get_node_tree': 'mcp-query-tree',
    'get_runtime_logs': 'mcp-query-logs',
    'get_runtime_stats': 'mcp-query-stats',
    'install_script': 'mcp-script-install',
    'enable_script': 'mcp-script-enable',
    'disable_script': 'mcp-script-disable',
    'list_scripts': 'mcp-script-list',
    'refresh_preview': 'mcp-refresh-preview',
    'invoke_component_method': 'mcp-invoke-component-method',
};

/**
 * 直接复用 uuid_lookup 的主进程能力，避免复制资源索引和 Scene/Prefab 扫描逻辑。
 */
export const UUID_LOOKUP_TOOL_MAP: Record<string, { channel: string, timeout: number }> = {
    'search_editor_assets': { channel: 'uuid_lookup:query-resource', timeout: 10000 },
    'get_asset_references': { channel: 'uuid_lookup:query-uuid-usage', timeout: 30000 },
    'scan_missing_asset_references': { channel: 'uuid_lookup:scan-missing-uuid', timeout: 60000 },
    'open_asset_by_uuid': { channel: 'uuid_lookup:open-asset-by-main', timeout: 5000 },
};

const CACHE: Record<string, { timestamp: number, data: any }> = {};

function dispatchToPanelWithTimeout(channel: string, args: any, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
        let isTimeout = false;
        const timer = setTimeout(() => {
            isTimeout = true;
            reject(new Error(`RPC_TIMEOUT: 面板在 ${timeoutMs}ms 内未响应`));
        }, timeoutMs);

        Editor.Ipc.sendToPanel('mcp-inspector-bridge', channel, args, (err: any, res: any) => {
            if (isTimeout) return;
            clearTimeout(timer);
            if (err) reject(err);
            else resolve(res);
        }, timeoutMs + 500); 
    });
}

/** 调用可选的 uuid_lookup 插件，并在未安装时尽早返回可读错误。 */
function dispatchToUuidLookupWithTimeout(channel: string, args: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        let packagePath = '';
        try {
            packagePath = Editor.Package && Editor.Package.packagePath
                ? Editor.Package.packagePath('uuid_lookup')
                : '';
        } catch (_) {}
        if (!packagePath) {
            reject(new Error('未安装或未启用 uuid_lookup 插件，无法使用编辑器资源联动工具'));
            return;
        }

        let finished = false;
        const timer = setTimeout(() => {
            finished = true;
            reject(new Error(`UUID_LOOKUP_TIMEOUT: ${channel} 在 ${timeoutMs}ms 内未响应`));
        }, timeoutMs);
        Editor.Ipc.sendToMain(channel, args, (err: any, result: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (err) reject(err);
            else resolve(result);
        }, timeoutMs + 500);
    });
}

function handleCaptureScreenshot(ws: WebSocket.WebSocket, reqId: string) {
    const { webContents } = require('electron');
    const allWc = webContents.getAllWebContents();
    const targetWc = allWc.find((wc: any) => {
        const url = wc.getURL();
        return url && url.includes('localhost:') && !url.includes('inspector');
    });

    if (!targetWc) {
        const errText = "未能找到活跃的预览画面，请确认预览面板已打开。";
        try { Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', { type: 'err', time: new Date().toLocaleTimeString(), content: `[capture_runtime_screenshot]\nError: ${errText}` }); } catch(e) {}
        ws.send(JSON.stringify({
            jsonrpc: "2.0", id: reqId,
            result: { isError: true, content: [{ type: "text", text: errText }] }
        }));
        return;
    }

    const handleImage = (img: any) => {
        if (!img || img.isEmpty()) {
            const errText = "获取画面为空，可能处于后台";
            try { Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', { type: 'err', time: new Date().toLocaleTimeString(), content: `[capture_runtime_screenshot]\nError: ${errText}` }); } catch(e) {}
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { isError: true, content: [{ type: "text", text: errText }] }}));
            return;
        }
        const dataUrl = img.toDataURL();
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        
        try { 
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', { 
                type: 'res', 
                time: new Date().toLocaleTimeString(), 
                content: `[capture_runtime_screenshot]\nResult: { type: "image", data: "${base64Data.substring(0, 100)}...[截断:${base64Data.length} chars]" }` 
            }); 
        } catch(e) {}

        ws.send(JSON.stringify({
            jsonrpc: "2.0", id: reqId,
            result: {
                content: [
                    { type: "image", data: base64Data, mimeType: "image/png" },
                    { type: "text", text: "已截取当前 runtime 游戏视图。" }
                ]
            }
        }));
    };

    const result = targetWc.capturePage();
    if (result && typeof result.then === 'function') {
        result.then(handleImage).catch((e: any) => {
            try { Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', { type: 'err', time: new Date().toLocaleTimeString(), content: `[capture_runtime_screenshot]\nError: 截图异常: ${e.message}` }); } catch(e) {}
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { isError: true, content: [{ type: "text", text: "截图异常: " + e.message }] }}));
        });
    } else if (result) {
        handleImage(result);
    }
}

export function startMcpRouter(onStatusChange: (status: any) => void): { close: () => void } {
    let _wss: WebSocket.Server | null = null;
    let _port = 4456;
    const inputConnections = new Set<() => void>();
    let disposed = false;

    const tryListen = () => {
        try {
            _wss = new WebSocket.Server({ port: _port });
            
            _wss.on('error', (e: any) => {
                if (e.code === 'EADDRINUSE') {
                    _port++;
                    tryListen();
                } else {
                    onStatusChange({ active: false, port: _port, error: e.message || 'Unknown network error' });
                }
            });

            _wss.on('listening', () => {
                onStatusChange({ active: true, port: _port, error: '' });
            });

            _wss.on('connection', (ws) => {
                if (disposed) { ws.close(); return; }
                let closed = false;
                const owner = randomBytes(24).toString('hex');
                const inputs = new Map<string, any>();
                const cancelInput = (request: any) => {
                    if (request.canceled) return Promise.resolve();
                    request.canceled = true;
                    return dispatchToPanelWithTimeout('mcp-cancel-input', {
                    ...request.ownership, projectPath: request.projectPath,
                    }, 500).catch(() => undefined);
                };
                const cancelOwned = () => { for (const request of inputs.values()) void cancelInput(request); inputs.clear(); };
                inputConnections.add(cancelOwned);
                ws.on('close', () => { closed = true; cancelOwned(); inputConnections.delete(cancelOwned); });
                ws.on('message', async (message) => {
                    if (disposed || closed) return;
                    try {
                        const data = JSON.parse(message.toString());
                        if (data.type === 'ping') {
                            try {
                                Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                    time: new Date().toLocaleTimeString(),
                                    type: 'req',
                                    content: `[System] ping`
                                });
                            } catch (e) {}

                            const projectPath = Editor.Project.path || 'Unknown';
                            const resPayload = { 
                                type: 'pong',
                                port: _port,
                                projectPath: projectPath,
                                projectName: require('path').basename(projectPath)
                            };

                            try {
                                Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                    time: new Date().toLocaleTimeString(),
                                    type: 'res',
                                    content: `[System] pong\nResult: ${JSON.stringify(resPayload)}`
                                });
                            } catch (e) {}

                            ws.send(JSON.stringify(resPayload));
                            return;
                        }
                    
                    if (data.method === 'tools/call' && data.params) {
                        const name = data.params.name;
                        const controlledWrite = name === 'simulate_input' || name === 'refresh_preview';
                        const args = data.params.args || {};
                        const reqId = data.id || Date.now().toString();
                        const inputRequest = name === 'simulate_input' ? {
                            input: args, ownership: { owner, requestId: randomBytes(24).toString('hex') },
                            projectPath: Editor.Project?.path || '',
                        } : null;

                        try {
                            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                time: new Date().toLocaleTimeString(),
                                type: 'req',
                                content: `[${name}]\nArgs: ${JSON.stringify(args, null, 2)}`
                            });
                        } catch (e) {}

                        if (name === 'capture_runtime_screenshot') {
                            handleCaptureScreenshot(ws, reqId);
                            return;
                        }

                        const ipcChannel = TOOL_IPC_MAP[name];
                        const uuidLookupTool = UUID_LOOKUP_TOOL_MAP[name];
                        if (!ipcChannel && !uuidLookupTool) {
                            ws.send(JSON.stringify({
                                jsonrpc: "2.0",
                                id: reqId,
                                result: { content: [{ type: "text", text: `Tool unknown: ${name}` }] }
                            }));
                            return;
                        }

                        // ★ get_runtime_logs 优先走主进程 CDP 数据源（零侵入，无需面板 IPC 中转）
                        if (name === 'get_runtime_logs') {
                            try {
                                const directArgs = {
                                    tail: args.tail === undefined ? 50 : args.tail,
                                    level: args.level === undefined ? 'all' : args.level,
                                    ...(args.sinceCursor === undefined ? {} : { sinceCursor: args.sinceCursor }),
                                };
                                const directRes = await new Promise<any>((resolve, reject) => {
                                    const timer = setTimeout(() => reject(new Error('CDP 日志查询超时')), 3500);
                                    Editor.Ipc.sendToMain(
                                        'mcp-inspector-bridge:query-cdp-logs',
                                        directArgs,
                                        (err: any, data: any) => { clearTimeout(timer); err ? reject(err) : resolve(data); },
                                        4000
                                    );
                                });

                                const legacyLogs = directRes?.ok === true && Array.isArray(directRes.logs?.items)
                                    ? directRes.logs.items
                                    : (directRes.result || directRes);
                                const finalContent = JSON.stringify(legacyLogs, null, 2);
                                try {
                                    let resText = finalContent;
                                    if (resText.length > 500) resText = resText.substring(0, 500) + '...[truncated:超长响应已截断]';
                                    Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                        time: new Date().toLocaleTimeString(),
                                        type: 'res',
                                        content: `[${name}]\nResult: ${resText}`
                                    });
                                } catch (e) {}
                                ws.send(JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { content: [{ type: "text", text: finalContent }] } }));
                                return; // 已处理，不再走面板 IPC
                            } catch (err: any) {
                                // CDP 查询失败时返回错误信息
                                try {
                                    Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                        time: new Date().toLocaleTimeString(),
                                        type: 'err',
                                        content: `[${name}]\nError: ${err.message}`
                                    });
                                } catch (e) {}
                                ws.send(JSON.stringify({
                                    jsonrpc: "2.0", id: reqId,
                                    result: { content: [{ type: "text", text: `CDP 日志不可用: ${err.message}` }], isError: true }
                                }));
                                return;
                            }
                        }

                        // Check cache for specific frequent queries
                        const cacheKey = `${name}_${JSON.stringify(args)}`;
                        if (name === 'get_node_tree' && CACHE[cacheKey] && Date.now() - CACHE[cacheKey].timestamp < 500) {
                            ws.send(JSON.stringify({ jsonrpc: "2.0", id: reqId, result: CACHE[cacheKey].data }));
                            return;
                        }

                        try {
                            if (inputRequest) inputs.set(inputRequest.ownership.requestId, inputRequest);
                            const res = uuidLookupTool
                                ? await dispatchToUuidLookupWithTimeout(uuidLookupTool.channel, args, uuidLookupTool.timeout)
                                : await dispatchToPanelWithTimeout(ipcChannel, inputRequest || args,
                                    name === 'simulate_input' ? 4000 : name === 'refresh_preview' ? 10000 : 3000);
                            let contentText = '';
                            const controlledFailure = controlledWrite && (!res || res.success === false || res.error);
                            if (controlledFailure) {
                                contentText = JSON.stringify({ success: false,
                                    error: typeof res?.error === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(res.error)
                                        ? res.error : 'RUNTIME_OPERATION_FAILED',
                                    ...(res?.status === 'partial' ? { status: 'partial', verified: false, retryable: false,
                                        ...(name === 'simulate_input' && Number.isInteger(res.framesDispatched) && Number.isInteger(res.totalFrames) &&
                                            res.framesDispatched >= 0 && res.framesDispatched <= res.totalFrames && res.totalFrames >= 2 && res.totalFrames <= 120
                                            ? { framesDispatched: res.framesDispatched, totalFrames: res.totalFrames } : {}) } : {}) });
                            } else if (!res || res.error) {
                                contentText = JSON.stringify({ error: (res && res.error) || 'Unknown IPC error' });
                            } else {
                                contentText = JSON.stringify(res.result || res, null, 2);
                            }
                            
                            const resultPayload = { content: [{ type: "text", text: contentText }],
                                ...(controlledFailure ? { isError: true } : {}) };
                            
                            if (name === 'get_node_tree') {
                                CACHE[cacheKey] = { timestamp: Date.now(), data: resultPayload };
                            }

                            try {
                                let resText = contentText;
                                if (resText.length > 500) resText = resText.substring(0, 500) + '...[truncated:超长响应已截断]';
                                Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                    time: new Date().toLocaleTimeString(),
                                    type: (controlledFailure || !res || res.error) ? 'err' : 'res',
                                    content: `[${name}]\nResult: ${resText}`
                                });
                            } catch (e) {}

                            ws.send(JSON.stringify({ jsonrpc: "2.0", id: reqId, result: resultPayload }));
                        } catch (err: any) {
                            if (inputRequest) await cancelInput(inputRequest);
                            try {
                                Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-inspector-bridge:mcp-log', {
                                    time: new Date().toLocaleTimeString(),
                                    type: 'err',
                                    content: `[${name}]\nError: ${err.message}`
                                });
                            } catch (e) {}
                            ws.send(JSON.stringify({
                                jsonrpc: "2.0",
                                id: reqId,
                                result: controlledWrite
                                    ? { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
                                        error: 'RUNTIME_OPERATION_FAILED', status: 'partial', verified: false, retryable: false }) }] }
                                    : { content: [{ type: "text", text: `Execution failed: ${err.message}` }] }
                            }));
                        } finally { if (inputRequest) inputs.delete(inputRequest.ownership.requestId); }
                    }
                } catch(e) {}
            });
        });
        } catch(err: any) {
            onStatusChange({ active: false, port: _port, error: err.message || 'Unknown error' });
        }
    };

    tryListen();

    return { 
        close: () => {
            disposed = true;
            for (const cancel of inputConnections) cancel();
            inputConnections.clear();
            if (_wss) {
                try { _wss.close(); } catch(e) {}
                _wss = null;
            }
        } 
    };
}
