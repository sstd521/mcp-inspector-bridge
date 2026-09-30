// @ts-nocheck
import { getCcEngine } from './engine-helper';

const sensitiveKey = /token|password|passwd|secret|credential|authorization|cookie|session|private.?key|api.?key/i;
function scalar(source: any, keys: string[]) {
    const result: any = {};
    keys.forEach(key => { try {
        const value = source && source[key];
        if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) result[key] = value;
        else if (typeof value === 'string') result[key] = value.slice(0, 256);
    } catch (_) {} });
    return result;
}
function scrub(value: any, depth = 0): any {
    if (depth > 6) return '[REDACTED: depth limit]';
    if (value && typeof value === 'object') {
        const output: any = Array.isArray(value) ? [] : {};
        Object.keys(value).slice(0, 128).forEach(key => {
            Object.defineProperty(output, key, { enumerable: true, configurable: true, writable: true,
                value: sensitiveKey.test(key) ? '[REDACTED]' : scrub(value[key], depth + 1) });
        });
        return output;
    }
    if (typeof value !== 'string') return value;
    return value.replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*/gi, '[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[REDACTED]')
        .replace(/((?:token|password|passwd|secret|credential|authorization|cookie|session|private.?key|api.?key)[\w-]*["']?\s*[:=]\s*["']?)[^\s&,}"']+/gi, '$1[REDACTED]');
}
export function initEnvironment() {
    window.__mcpEnvironment = {
        getEnvironment() {
            const cc = getCcEngine();
            if (!cc) return { success: false, available: false, error: 'ENGINE_UNAVAILABLE' };
            const info: any = { success: true, available: true, version: String(cc.ENGINE_VERSION || '').slice(0, 64),
                ...scalar(cc.sys, ['isNative', 'isMobile', 'platform', 'os', 'osVersion', 'browserType', 'browserVersion', 'language']),
                flags: scalar(window, ['CC_DEV', 'CC_DEBUG', 'CC_EDITOR', 'CC_PREVIEW', 'CC_BUILD', 'CC_JSB', 'CC_WECHATGAME', 'CC_RUNTIME', 'CC_TEST']),
                downloader: scalar(cc.assetManager && cc.assetManager.downloader, ['maxConcurrency', 'maxRequestsPerFrame', 'maxRetryCount', 'retryInterval']),
                dynamicAtlas: scalar(cc.dynamicAtlasManager, ['enabled', 'maxFrameSize', 'textureSize', 'maxAtlasCount', 'atlasCount', 'textureBleeding']) };
            for (const [name, method] of [['designResolution', 'getDesignResolutionSize'], ['frameSize', 'getFrameSize'], ['visibleSize', 'getVisibleSize']]) {
                try { if (cc.view && typeof cc.view[method] === 'function') info[name] = scalar(cc.view[method](), ['width', 'height']); } catch (_) {}
            }
            try {
                const phys = cc.director.getPhysicsManager && cc.director.getPhysicsManager();
                if (phys) {
                    info.physics = scalar(phys, ['enabled', 'allowSleep', 'maxSubSteps', 'fixedTimeStep', 'debugDrawFlags']);
                    info.physics.gravity = scalar(phys.gravity, ['x', 'y']);
                }
            } catch (_) {}
            try {
                const collision = cc.director.getCollisionManager && cc.director.getCollisionManager();
                if (collision) info.collision = scalar(collision, ['enabled', 'enabledDrawBoundingBox', 'enabledDebugDraw']);
            } catch (_) {}
            return info;
        },
        readStorage(options: any = {}) {
            if (!options || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'INVALID_STORAGE_QUERY' };
            const keys = options.keys;
            const limit = options.limit === undefined ? 64 : options.limit;
            if (!Number.isInteger(limit) || limit < 1 || limit > 128 ||
                (options.prefix !== undefined && (typeof options.prefix !== 'string' || options.prefix.length > 128)) ||
                (keys !== undefined && (!Array.isArray(keys) || keys.length < 1 || keys.length > 8 || keys.some(key => typeof key !== 'string' || !key || key.length > 128)))) {
                return { success: false, error: 'INVALID_STORAGE_QUERY' };
            }
            try {
                const cc = getCcEngine();
                const storage = (cc && cc.sys && cc.sys.localStorage) || window.localStorage;
                if (!storage || typeof storage.getItem !== 'function') return { success: false, available: false, error: 'STORAGE_UNAVAILABLE' };
                const result: any = { success: true, available: true, valuesIncluded: keys !== undefined, entries: [], truncated: false };
                const names: string[] = [];
                if (keys) names.push(...Array.from(new Set(keys)));
                else {
                    // Bound enumeration independently of result count for huge stores.
                    const count = Math.min(Number(storage.length) || 0, 2048);
                    for (let i = 0; i < count; i++) {
                        const key = storage.key(i);
                        if (typeof key !== 'string' || (options.prefix && !key.startsWith(options.prefix))) continue;
                        if (names.length === limit) { result.truncated = true; break; }
                        names.push(key);
                    }
                    if (Number(storage.length) > count) result.truncated = true;
                }
                for (const key of names) {
                    const entry: any = { key: key.slice(0, 128) };
                    if (key.length > 128) entry.keyTruncated = true;
                    try {
                        const value = storage.getItem(key);
                        entry.size = typeof value === 'string' ? value.length : 0;
                        if (value === null || value === undefined) entry.missing = true;
                        if (keys && !entry.missing) {
                            if (sensitiveKey.test(key)) { entry.value = '[REDACTED]'; entry.redacted = true; }
                            else {
                                let safe = String(value).slice(0, 16384);
                                try { safe = JSON.stringify(scrub(JSON.parse(safe))); } catch (_) { safe = scrub(safe); }
                                entry.value = safe.slice(0, 2048);
                                entry.truncated = value.length > 16384 || safe.length > 2048;
                                entry.redacted = safe !== value && safe.includes('[REDACTED');
                            }
                        }
                    } catch (_) { entry.error = 'STORAGE_READ_FAILED'; }
                    result.entries.push(entry);
                }
                return result;
            } catch (_) { return { success: false, available: false, error: 'STORAGE_UNAVAILABLE' }; }
        }
    };
}
