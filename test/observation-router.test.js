const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const {EventEmitter}=require('events'),{createRequire}=require('module');
(async()=>{
 let server;const calls=[],waiting=[],module={exports:{}};
 const filename=path.join(__dirname,'../dist/ipc-router.js');
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>name==='ws'?{Server:class extends EventEmitter{constructor(){super();server=this;}close(){}}}:createRequire(filename)(name),
 Editor:{Project:{path:'/project'},Ipc:{sendToPanel(panel,channel,args,callback){if(!callback)return;calls.push({channel,args});if(channel==='mcp-runtime-trace-node'||channel==='mcp-runtime-render-summary')waiting.push(callback);else callback(null,{success:true});}}},setTimeout,clearTimeout});
 const router=module.exports.startMcpRouter(()=>{}),sockets=[new EventEmitter(),new EventEmitter()],responses=[];
 sockets.forEach(s=>{s.send=data=>responses.push(JSON.parse(data));server.emit('connection',s);});
 const pending=['runtime_trace_node','runtime_render_summary'].map((name,i)=>sockets[i].listeners('message')[0](JSON.stringify({id:i+1,method:'tools/call',params:{name,args:name==='runtime_trace_node'?{uuid:'node'}:{}}})));
 assert.strictEqual(waiting.length,2);const traces=calls.filter(c=>c.channel.startsWith('mcp-runtime-'));
 assert.notStrictEqual(traces[0].args.ownership.owner,traces[1].args.ownership.owner);
 sockets[0].emit('close');await Promise.resolve();
 const canceled=calls.filter(c=>c.channel==='mcp-cancel-observation');assert.strictEqual(canceled.length,1);assert.strictEqual(canceled[0].args.owner,traces[0].args.ownership.owner);
 waiting[0](null,{success:false,error:'OBSERVATION_CANCELED'});waiting[1](null,{success:true,breaks:[]});await Promise.all(pending);
 assert.strictEqual(responses.find(r=>r.id===1).result.isError,true);assert(!responses.find(r=>r.id===2).result.isError);router.close();
 let panel;global.Editor={url:v=>v,warn(){},Panel:{extend:definition=>panel=definition},Project:{path:'/project'}};require('../dist/panel/index');
 const win={__mcpCrawler:{getInputContext:()=>({id:'scene'})},__mcpEnvironment:{getEnvironment:()=>({success:true,version:'2.4.7'})}};
 const view={isConnected:true,getWebContentsId:()=>1,executeJavaScript:code=>Promise.resolve(vm.runInNewContext(code,{window:win,Date}))};
 const host={shadowRoot:{querySelector:()=>view}};let result;
 await panel.messages['mcp-runtime-environment'].call(host,{reply:(error,data)=>{assert.ifError(error);result=data;}},{});
 assert.strictEqual(result.version,'2.4.7');host.__mcpDiagnosticSession.close();
 console.log('observation-router.test.js: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
