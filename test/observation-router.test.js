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
 assert.strictEqual(responses.find(r=>r.id===1).result.isError,true);assert(!responses.find(r=>r.id===2).result.isError);
 for(const [name,args] of [['runtime_bundle_inventory',{limit:1}],['runtime_asset_detail',{uuid:'asset'}]]) {
  await sockets[1].listeners('message')[0](JSON.stringify({id:name,method:'tools/call',params:{name,args}}));
  assert.strictEqual(calls[calls.length-1].channel,'mcp-'+name.replace(/_/g,'-'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[calls.length-1].args)),args);
  assert(!responses.find(r=>r.id===name).result.isError);
 }
 router.close();
 const adapterFile=path.join(__dirname,'../dist/mcp-client/tools.js'),adapter={exports:{}},handlers=[];let rpcCall;
 vm.runInNewContext(fs.readFileSync(adapterFile,'utf8'),{module:adapter,exports:adapter.exports,require:name=>name==='./index'?{}:createRequire(adapterFile)(name)});
 adapter.exports.setupTools({setRequestHandler:(_schema,handler)=>handlers.push(handler)},async(name,args)=>{rpcCall={name,args};return {isError:true,content:[{type:'text',text:'BUNDLE_NOT_FOUND'}]};});
 const catalog=await handlers[0]();
 for(const name of ['runtime_bundle_inventory','runtime_asset_detail']) assert.strictEqual(catalog.tools.find(t=>t.name===name).annotations.readOnlyHint,true);
 const error=await handlers[1]({params:{name:'runtime_bundle_inventory',arguments:{bundle:'missing'}}});
 assert.strictEqual(rpcCall.name,'runtime_bundle_inventory');assert.strictEqual(rpcCall.args.bundle,'missing');assert.strictEqual(error.isError,true);
 let panel;global.Editor={url:v=>v,warn(){},Panel:{extend:definition=>panel=definition},Project:{path:'/project'}};require('../dist/panel/index');
 const win={__mcpCrawler:{getInputContext:()=>({id:'scene'})},__mcpEnvironment:{getEnvironment:()=>({success:true,version:'2.4.7'})},__mcpResourceInventory:{inventory:input=>({assets:[{uuid:'asset'}],limit:input.limit}),detail:input=>({found:true,asset:{uuid:input.uuid}})}};
 const view={isConnected:true,getWebContentsId:()=>1,executeJavaScript:code=>Promise.resolve(vm.runInNewContext(code,{window:win,Date}))};
 const host={shadowRoot:{querySelector:()=>view}};let result;
 await panel.messages['mcp-runtime-environment'].call(host,{reply:(error,data)=>{assert.ifError(error);result=data;}},{});
 assert.strictEqual(result.version,'2.4.7');
 for(const [name,args] of [['runtime_bundle_inventory',{limit:1}],['runtime_asset_detail',{uuid:'asset'}]]) {
  await panel.messages['mcp-'+name.replace(/_/g,'-')].call(host,{reply:(error,data)=>{assert.ifError(error);result=data;}},args);
  assert.strictEqual(result.success,true);
  assert.strictEqual(name==='runtime_asset_detail'?result.asset.uuid:result.assets[0].uuid,'asset');
 }
 host.__mcpDiagnosticSession.close();
 console.log('observation-router.test.js: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
