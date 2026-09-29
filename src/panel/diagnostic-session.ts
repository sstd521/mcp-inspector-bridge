import { randomBytes } from 'crypto';
import { validDiagnosticArgs } from '../runtime-diagnostic-contract';

const methods: Record<string,string> = {
    runtime_trace_node:'window.__mcpNodeTrace.observe(input,id)',
    runtime_hit_candidates:'window.__mcpNodePicker.getCandidates(input.x,input.y,input.limit)',
    runtime_render_summary:'window.__mcpRenderDebuggerHook.captureSummary(input,id)',
    runtime_environment:'window.__mcpEnvironment.getEnvironment()',
    runtime_storage:'window.__mcpEnvironment.readStorage(input)',
};
export function createDiagnosticSession(getView:()=>any, getProject:()=>string) {
    let closed=false;
    const active=new Map<string,any>(), retired=new Map<string,number>();
    const keyOf=(o:any)=>o && /^[a-f0-9]{48}$/.test(o.owner) && /^[a-f0-9]{48}$/.test(o.requestId) ? o.owner+':'+o.requestId : '';
    const fail=(error:string)=>({success:false,error});
    const retire=(key:string)=>{ for(const [id,expiry] of retired) if(expiry<=Date.now()) retired.delete(id); retired.set(key,Date.now()+6000); while(retired.size>64) retired.delete(retired.keys().next().value!); };
    const stopProbe=(lease:any)=>{
        if (!lease.dispatched) return;
        const method=lease.name==='runtime_trace_node'?'window.__mcpNodeTrace.cancel':'window.__mcpRenderDebuggerHook.cancelCapture';
        try { Promise.resolve(lease.view.executeJavaScript(`try { ${method}(${JSON.stringify(lease.id)}); } catch (_) {}`)).catch(()=>{}); } catch (_) {}
    };
    const cancel=(args:any)=>{
        const key=keyOf(args);
        if(!key || args.projectPath!==getProject()) return Promise.resolve({canceled:false});
        retire(key);
        const lease=active.get(key);
        if(lease) { stopProbe(lease);lease.done(fail('OBSERVATION_CANCELED')); }
        return Promise.resolve({canceled:!!lease});
    };
    return {
        cancel,
        close(){closed=true;for(const lease of active.values()){stopProbe(lease);lease.done(fail('OBSERVATION_CANCELED'));}},
        run(name:string,args:any):Promise<any> {
            if(closed) return Promise.resolve(fail('OBSERVATION_CANCELED'));
            const scoped=name==='runtime_trace_node'||name==='runtime_render_summary';
            const input=scoped?args && args.input:args;
            const key=scoped?keyOf(args && args.ownership):randomBytes(24).toString('hex');
            if(!validDiagnosticArgs(name,input)||!key||scoped && args.projectPath!==getProject()) return Promise.resolve(fail('INVALID_OBSERVATION_ARGUMENTS'));
            if(active.has(key)||(retired.get(key)||0)>Date.now()||active.size>=4) return Promise.resolve(fail('OBSERVATION_BUSY'));
            return new Promise(resolve=>{
                const cleanup:Array<()=>void>=[];
                const lease:any={name,id:randomBytes(24).toString('hex'),dispatched:false,view:null,done:null};
                let finished=false;
                lease.done=(value:any)=>{if(finished)return;finished=true;cleanup.forEach(fn=>{try{fn();}catch(_){}});active.delete(key);retire(key);resolve(value);};
                active.set(key,lease);
                try {
                    const view=getView(),project=getProject();lease.view=view;
                    if(!view||view.isConnected===false) {lease.done(fail('PREVIEW_UNAVAILABLE'));return;}
                    const guest=view.getWebContentsId();
                    const current=()=>{try{return getView()===view&&getProject()===project&&view.isConnected!==false&&view.getWebContentsId()===guest;}catch(_){return false;}};
                    const changed=(event?:any)=>{if(event&&event.isMainFrame===false)return;if(scoped)stopProbe(lease);lease.done(fail('OBSERVATION_CONTEXT_CHANGED'));};
                    if(typeof view.addEventListener==='function') for(const event of ['did-start-navigation','destroyed','render-process-gone']){view.addEventListener(event,changed);cleanup.push(()=>view.removeEventListener(event,changed));}
                    const identity=setInterval(()=>{if(!current())changed();},50);
                    const timer=setTimeout(()=>{if(scoped)stopProbe(lease);lease.done(fail('OBSERVATION_TIMEOUT'));},2200);
                    cleanup.push(()=>clearInterval(identity),()=>clearTimeout(timer));
                    const code=`(async function(){
                        if(Date.now()>${Date.now()+500}) return JSON.stringify({success:false,error:'OBSERVATION_EXPIRED'});
                        const input=${JSON.stringify(input)},id=${JSON.stringify(lease.id)};
                        const context=window.__mcpCrawler.getInputContext().id;
                        try {
                            const result=await ${methods[name]};
                            if(window.__mcpCrawler.getInputContext().id!==context) return JSON.stringify({success:false,error:'OBSERVATION_CONTEXT_CHANGED'});
                            if(!result||typeof result!=='object'||Array.isArray(result)) return JSON.stringify({success:false,error:'INVALID_DIAGNOSTIC_RESULT'});
                            return JSON.stringify(Object.assign({success:!result.error},result));
                        } catch (_) { return JSON.stringify({success:false,error:'DIAGNOSTIC_UNAVAILABLE'}); }
                    })()`;
                    lease.dispatched=true;
                    Promise.resolve(view.executeJavaScript(code)).then(raw=>{
                        if(finished)return;if(!current()){changed();return;}
                        try{const value=typeof raw==='string'?JSON.parse(raw):raw;lease.done(value&&typeof value.success==='boolean'?value:fail('INVALID_DIAGNOSTIC_RESULT'));}
                        catch(_){lease.done(fail('INVALID_DIAGNOSTIC_RESULT'));}
                    },()=>{if(scoped)stopProbe(lease);lease.done(fail('DIAGNOSTIC_UNAVAILABLE'));});
                }catch(_){if(scoped)stopProbe(lease);lease.done(fail('DIAGNOSTIC_UNAVAILABLE'));}
            });
        },
    };
}
