// A timeout ends observation, not the component's work; never replay the method.
export function invokeComponentMethod(getView: () => any, args: any): Promise<any> {
    return new Promise(resolve => {
        let finished = false, dispatched = false;
        const cleanup: Array<() => void> = [];
        const done = (value: any) => {
            if (finished) return;
            finished = true;
            cleanup.forEach(fn => { try { fn(); } catch (_) {} });
            resolve(value);
        };
        const fail = (error: string) => done({ success: false, error,
            ...(dispatched ? { status: 'partial', verified: false, retryable: false } : {}) });
        if (!args || typeof args.uuid !== 'string' || !args.uuid || args.uuid.length > 128 ||
            !Number.isInteger(args.compIndex) || args.compIndex < 0 || args.compIndex > 255 ||
            typeof args.methodName !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(args.methodName)) {
            fail('INVALID_METHOD_ARGUMENTS'); return;
        }
        try {
            const wv = getView();
            if (!wv || wv.isConnected === false) { fail('METHOD_UNAVAILABLE'); return; }
            const guest = wv.getWebContentsId();
            const current = () => {
                try { return getView() === wv && wv.isConnected !== false && wv.getWebContentsId() === guest; }
                catch (_) { return false; }
            };
            const changed = (event: any) => { if (!event || event.isMainFrame !== false) fail('METHOD_CONTEXT_CHANGED'); };
            if (typeof wv.addEventListener === 'function') {
                for (const name of ['did-start-navigation', 'destroyed', 'render-process-gone']) {
                    wv.addEventListener(name, changed);
                    cleanup.push(() => wv.removeEventListener(name, changed));
                }
            }
            const timer = setTimeout(() => fail('METHOD_TIMEOUT'), 2000);
            const identity = setInterval(() => { if (!current()) fail('METHOD_CONTEXT_CHANGED'); }, 50);
            cleanup.push(() => clearTimeout(timer), () => clearInterval(identity));
            const code = `(async function(){
                if (!window.__mcpCrawler) return JSON.stringify({success:false,error:'METHOD_UNAVAILABLE'});
                return JSON.stringify(await window.__mcpCrawler.executeComponentMethod(${JSON.stringify(args.uuid)},${args.compIndex},${JSON.stringify(args.methodName)}));
            })()`;
            dispatched = true;
            Promise.resolve(wv.executeJavaScript(code)).then(raw => {
                if (!current()) { fail('METHOD_CONTEXT_CHANGED'); return; }
                try {
                    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (value && value.success === true && value.status === 'completed' && value.completionVerified === true &&
                        ['method-returned', 'method-promise-resolved'].includes(value.completionEvidence)) {
                        done({ success: true, status: 'completed', completionVerified: true, completionEvidence: value.completionEvidence });
                    } else {
                        fail(value && ['METHOD_UNAVAILABLE', 'METHOD_FAILED', 'METHOD_CONTEXT_CHANGED'].includes(value.error)
                            ? value.error : 'INVALID_METHOD_RECEIPT');
                    }
                } catch (_) { fail('INVALID_METHOD_RECEIPT'); }
            }, () => fail('METHOD_EXECUTION_FAILED'));
        } catch (_) { fail('METHOD_EXECUTION_FAILED'); }
    });
}
