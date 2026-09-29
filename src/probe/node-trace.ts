// @ts-nocheck
import { getCcEngine } from './engine-helper';

// Short observations avoid persistent breakpoints and cross-conversation trace ownership.
export function initNodeTrace() {
    if (window.__mcpNodeTrace) window.__mcpNodeTrace.close();
    const pending = new Map(), cancelled = new Map();
    const retire = id => {
        for (const [key,expiry] of cancelled) if (expiry <= Date.now()) cancelled.delete(key);
        cancelled.set(id, Date.now()+6000);
        while (cancelled.size > 32) cancelled.delete(cancelled.keys().next().value);
    };
    const events = ['position-changed', 'rotation-changed', 'scale-changed', 'size-changed',
        'anchor-changed', 'color-changed', 'child-added', 'child-removed', 'child-reorder',
        'group-changed', 'sibling-order-changed', 'active-in-hierarchy-changed'];
    const snapshot = node => {
        const value = {};
        for (const key of ['x', 'y', 'z', 'angle', 'scaleX', 'scaleY', 'width', 'height', 'anchorX', 'anchorY', 'opacity', 'groupIndex']) {
            if (typeof node[key] === 'number' && Number.isFinite(node[key])) value[key] = node[key];
        }
        value.active = node.active === true;
        value.activeInHierarchy = node.activeInHierarchy === true;
        value.parentUuid = node.parent ? String(node.parent.uuid || node.parent.id || '').slice(0, 128) : null;
        value.childCount = node.children ? node.children.length : 0;
        if (node.color) value.color = ['r','g','b','a'].map(k => Number(node.color[k]) || 0);
        return value;
    };
    const close = () => { for (const finish of Array.from(pending.values())) finish('OBSERVATION_CANCELED'); };
    window.addEventListener('pagehide', close);
    window.__mcpNodeTrace = {
        close() { close(); window.removeEventListener('pagehide', close); },
        cancel(id) { if (typeof id !== 'string' || !id || id.length > 128) return false; retire(id); const finish = pending.get(id); if (!finish) return false; finish('OBSERVATION_CANCELED'); return true; },
        observe(args, id) {
            const fail = error => Promise.resolve({ success:false, error });
            if (!args || typeof args.uuid !== 'string' || !args.uuid || args.uuid.length > 128 ||
                Object.keys(args).some(k => !['uuid','durationMs','maxEvents','includeStack'].includes(k)) ||
                (args.includeStack !== undefined && typeof args.includeStack !== 'boolean')) return fail('INVALID_OBSERVATION_ARGUMENTS');
            const durationMs = args.durationMs === undefined ? 500 : args.durationMs;
            const maxEvents = args.maxEvents === undefined ? 32 : args.maxEvents;
            if (!Number.isInteger(durationMs) || durationMs < 50 || durationMs > 1500 ||
                !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 64 || typeof id !== 'string' || !id || id.length > 128) return fail('INVALID_OBSERVATION_ARGUMENTS');
            if ((cancelled.get(id) || 0) > Date.now()) return fail('OBSERVATION_CANCELED');
            if (pending.size >= 4 || pending.has(id)) return fail('OBSERVATION_BUSY');
            const eng = getCcEngine(), scene = eng && eng.director.getScene();
            const node = window.__mcpCrawler && window.__mcpCrawler.findNodeByUuid(args.uuid);
            if (!scene || !node || node.isValid === false || typeof node.on !== 'function' || typeof node.off !== 'function') return fail('NODE_UNAVAILABLE');
            return new Promise(resolve => {
                const records = [], cleanup = [];
                let previous, stopped = false, dropped = 0, timer, identityTimer;
                const startedAt = Date.now();
                const current = () => getCcEngine() === eng && eng.director.getScene() === scene;
                const finish = (error?, terminalReason = 'duration-elapsed') => {
                    if (stopped) return;
                    stopped = true;
                    clearTimeout(timer); clearInterval(identityTimer);
                    cleanup.forEach(fn => { try { fn(); } catch (_) {} }); pending.delete(id);
                    resolve({ success: !error, ...(error ? {error} : {}), uuid:args.uuid,
                        sceneUuid:String(scene.uuid || scene.id || '').slice(0,128), durationMs:Date.now()-startedAt,
                        events:records, dropped, truncated:dropped>0, observedEvents:events, terminalReason:error ? 'interrupted' : terminalReason,
                        coverage:'Native node events only; no event does not prove no change. Stack is the synchronous emitter stack, not necessarily the original caller.' });
                };
                pending.set(id, finish);
                try {
                    previous = snapshot(node);
                    const attach = (target, type, onlySelf = false) => {
                        const handler = child => {
                            try {
                                if (onlySelf && child !== node) return;
                                if (!current()) { finish('OBSERVATION_CONTEXT_CHANGED'); return; }
                                if (node.isValid === false) { finish(undefined, 'node-destroyed'); return; }
                                const after = snapshot(node);
                                if (records.length < maxEvents) {
                                    const record = { event:onlySelf ? 'removed-from-parent' : type, atMs:Date.now()-startedAt,
                                        frame:typeof eng.director.getTotalFrames === 'function' ? eng.director.getTotalFrames() : null,
                                        before:previous, after, relatedUuid:child && (child.uuid || child.id) ? String(child.uuid || child.id).slice(0,128) : null };
                                    if (args.includeStack) record.stack = String(new Error().stack || '').split('\n').slice(1,9).map(frame => frame.replace(/([?#])[^\s):]+/g, '$1[redacted]').slice(0,256));
                                    records.push(record);
                                } else dropped++;
                                previous = after;
                            } catch (_) { finish('OBSERVATION_READ_FAILED'); }
                        };
                        target.on(type, handler); cleanup.push(() => target.off(type, handler));
                    };
                    for (const event of events) attach(node,event);
                    if (node.parent && typeof node.parent.on === 'function') attach(node.parent,'child-removed',true);
                    identityTimer = setInterval(() => { try { if (!current()) finish('OBSERVATION_CONTEXT_CHANGED'); else if (node.isValid === false) finish(undefined, 'node-destroyed'); } catch (_) { finish('OBSERVATION_CONTEXT_CHANGED'); } },25);
                    timer = setTimeout(() => { try { finish(current() ? undefined : 'OBSERVATION_CONTEXT_CHANGED', node.isValid === false ? 'node-destroyed' : 'duration-elapsed'); } catch (_) { finish('OBSERVATION_CONTEXT_CHANGED'); } },durationMs);
                } catch (_) { finish('OBSERVATION_READ_FAILED'); }
            });
        },
    };
}
