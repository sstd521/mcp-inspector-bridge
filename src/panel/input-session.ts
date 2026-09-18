import { randomBytes } from 'crypto';

// One panel owns only its own request leases. There is no public cancel/eval tool.
export function createInputSession(getView: () => any, getProject: () => string) {
    const retired = new Map<string, number>();
    let active: any = null;
    let closed = false;
    const keyOf = (owner: any) => owner && typeof owner.owner === 'string' && typeof owner.requestId === 'string' &&
        /^[a-f0-9]{48}$/.test(owner.owner) && /^[a-f0-9]{48}$/.test(owner.requestId) ? owner.owner + ':' + owner.requestId : '';
    const retire = (key: string) => {
        for (const [id, expiry] of retired) if (expiry <= Date.now()) retired.delete(id);
        retired.set(key, Date.now() + 6000);
        while (retired.size > 64) retired.delete(retired.keys().next().value!);
    };
    const failure = (error: string, partial = false) => ({ success: false, error,
        ...(partial ? { status: 'partial', verified: false, retryable: false } : {}) });
    const bounded = (operation: Promise<any>, milliseconds: number) => new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('INPUT_IPC_TIMEOUT')), milliseconds);
        Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    const readContext = async (wv: any) => {
        if (closed || !wv || wv.isConnected === false) throw new Error('INPUT_UNAVAILABLE');
        wv.getWebContentsId();
        return JSON.parse(await bounded(wv.executeJavaScript('JSON.stringify(window.__mcpCrawler.getInputContext())'), 500));
    };
    const cancel = async (args: any) => {
        const key = keyOf(args);
        if (!key || args.projectPath !== (active?.key === key ? active.projectPath : getProject())) return { ok: false, matched: false, released: false };
        retire(key);
        if (!active || active.key !== key) return { ok: true, matched: false, released: false };
        const lease = active;
        if (lease.canceled) return lease.cancelPromise || { ok: true, matched: true, released: false };
        lease.canceled = true;
        if (!lease.dispatched) return { ok: true, matched: true, released: false };
        lease.cancelPromise = (async () => {
            try {
                if (lease.wv.getWebContentsId() !== lease.guest) throw new Error('stale');
                return JSON.parse(await bounded(lease.wv.executeJavaScript(`JSON.stringify(window.__mcpCrawler.cancelInput(${JSON.stringify(args.owner)},${JSON.stringify(args.requestId)}))`), 500));
            } catch (_) { return { ok: false, matched: true, released: false }; }
        })();
        return lease.cancelPromise;
    };
    return {
        context: () => readContext(getView()), cancel,
        close: () => { closed = true; if (active) void cancel({ ...active.ownership, projectPath: active.projectPath }); },
        async run(request: any) {
            if (closed) return failure('INPUT_UNAVAILABLE');
            const wrapped = request && Object.prototype.hasOwnProperty.call(request, 'input');
            const input = wrapped ? request.input : request;
            const ownership = wrapped ? request.ownership : { owner: randomBytes(24).toString('hex'), requestId: randomBytes(24).toString('hex') };
            const projectPath = wrapped ? request.projectPath : getProject();
            const key = keyOf(ownership);
            if (!key || projectPath !== getProject()) return failure('INVALID_INPUT_OWNER');
            for (const [id, expiry] of retired) if (expiry <= Date.now()) retired.delete(id);
            if (active || retired.size >= 64 || (retired.get(key) || 0) > Date.now()) return failure('INPUT_BUSY');
            const lease: any = { key, ownership, projectPath, wv: null, canceled: false, dispatched: false };
            active = lease;
            const cleanup: Array<() => void> = [];
            try {
                const wv = lease.wv = getView();
                if (!wv || wv.isConnected === false) return failure('INPUT_UNAVAILABLE');
                lease.guest = wv.getWebContentsId();
                const abort = (event?: any) => { if (!event || event.isMainFrame !== false) void cancel({ ...ownership, projectPath }); };
                const identityTimer = setInterval(() => {
                    try { if (getProject() !== projectPath || getView() !== wv || wv.isConnected === false || wv.getWebContentsId() !== lease.guest) abort(); }
                    catch (_) { abort(); }
                }, 50);
                cleanup.push(() => clearInterval(identityTimer));
                if (typeof wv.addEventListener === 'function') {
                    for (const name of ['did-start-navigation', 'destroyed', 'render-process-gone']) {
                        cleanup.push(() => wv.removeEventListener(name, abort)); wv.addEventListener(name, abort);
                    }
                }
                const context = await readContext(wv);
                if (lease.canceled) return failure('INPUT_CANCELED');
                if (getProject() !== projectPath || getView() !== wv || wv.isConnected === false || wv.getWebContentsId() !== lease.guest) return failure('STALE_INPUT_CONTEXT');
                lease.dispatched = true;
                const code = `(async function(){ if(Date.now()>${Date.now() + 500}) return JSON.stringify({success:false,error:'INPUT_EXPIRED'}); if(window.__mcpCrawler.getInputContext().id!==${JSON.stringify(context.id)}) return JSON.stringify({success:false,error:'STALE_INPUT_CONTEXT'}); return JSON.stringify(await window.__mcpCrawler.simulateInput(${JSON.stringify(input)},true,${JSON.stringify(ownership)})); })()`;
                return JSON.parse(await bounded(wv.executeJavaScript(code), 3500));
            } catch (_) {
                if (lease.dispatched) await cancel({ ...ownership, projectPath });
                return failure('INPUT_EXECUTION_FAILED', lease.dispatched);
            }
            finally {
                for (const remove of cleanup) { try { remove(); } catch (_) {} }
                if (active === lease) active = null;
                retire(key);
            }
        },
    };
}
