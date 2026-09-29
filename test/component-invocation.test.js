const assert = require('assert');
const vm = require('vm');
const { invokeComponentMethod } = require('../dist/panel/component-invocation');
const args = { uuid: "node'quoted", compIndex: 0, methodName: 'run' };
function fixture(result) {
  const listeners = new Map();
  const state = { calls: 0, result, listeners, guest: 1 };
  state.view = { isConnected: true, getWebContentsId: () => state.guest,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    executeJavaScript: code => { state.calls++; return vm.runInNewContext(code, { window: { __mcpCrawler: { executeComponentMethod(uuid, index, name) {
      assert.strictEqual(uuid, args.uuid); assert.strictEqual(name, 'run'); return state.result;
    } } } }); } };
  return state;
}
(async () => {
  const completed = { success: true, status: 'completed', completionVerified: true, completionEvidence: 'method-promise-resolved' };
  let finish;
  const f = fixture(new Promise(resolve => finish = resolve));
  let settled = false;
  const pending = invokeComponentMethod(() => f.view, args).then(r => { settled = true; return r; });
  await Promise.resolve(); assert.strictEqual(settled, false);
  finish(completed); assert.deepStrictEqual(await pending, completed); assert.strictEqual(f.listeners.size, 0);
  for (const mode of ['navigation', 'guest', 'timeout', 'destroyed']) {
    const f = fixture(new Promise(() => {}));
    const pending = invokeComponentMethod(() => f.view, args);
    if (mode === 'navigation') f.listeners.get('did-start-navigation')({ isMainFrame: true });
    if (mode === 'guest') f.guest++;
    if (mode === 'destroyed') f.view.isConnected = false;
    const r = await pending;
    assert.strictEqual(r.success, false); assert.strictEqual(r.status, 'partial'); assert.strictEqual(r.retryable, false);
    assert.strictEqual(r.error, mode === 'timeout' ? 'METHOD_TIMEOUT' : 'METHOD_CONTEXT_CHANGED');
    assert.strictEqual(f.calls, 1); assert.strictEqual(f.listeners.size, 0);
  }
  const invalid = fixture(completed);
  assert.strictEqual((await invokeComponentMethod(() => invalid.view, { ...args, compIndex: -1 })).success, false);
  assert.strictEqual(invalid.calls, 0);
  const legacy = fixture(true);
  assert.strictEqual((await invokeComponentMethod(() => legacy.view, args)).error, 'INVALID_METHOD_RECEIPT');
  // Exercise the actual panel IPC and UI bindings, including refresh after a null reference resolves.
  let panel;
  global.Editor = { url: value => value, warn() {}, Panel: { extend: definition => panel = definition } };
  require('../dist/panel/index');
  const bound = fixture(completed);
  let reply;
  await panel.messages['mcp-invoke-component-method'].call({ shadowRoot: { querySelector: () => bound.view } },
    { reply: (error, result) => { assert.ifError(error); reply = result; } }, args);
  assert.deepStrictEqual(reply, completed);
  const { useNodeSystem } = require('../dist/panel/composables/useNodeSystem');
  const { effectScope } = require('vue');
  const state = { nodeDetail: { id: args.uuid } };
  const scope = effectScope();
  global.window = { addEventListener() {}, removeEventListener() {} };
  const realInterval = global.setInterval;
  global.setInterval = (...args) => { const timer = realInterval(...args); timer.unref(); return timer; };
  const ui = scope.run(() => useNodeSystem(state, { value: bound.view }, {}, {}, {}));
  global.setInterval = realInterval;
  assert.strictEqual(await ui.onComponentMethod({ realIndex: 0 }, 'run'), true);
  assert.strictEqual(bound.calls, 2);
  state.nodeDetail = { id: 'node', components: [{ properties: [{ key: 'target', type: 'null', value: null, declaredType: 'cc.Node' }] }] };
  const next = { id: 'node', prefabUuid: 'prefab', components: [{ properties: [{ key: 'target', type: 'node', value: { uuid: 'target' } }] }] };
  bound.view.executeJavaScript = () => Promise.resolve(JSON.stringify(next));
  ui.onNodeSelect({ id: 'node' }, true);
  await Promise.resolve();
  assert.deepStrictEqual(state.nodeDetail.components[0].properties, next.components[0].properties);
  scope.stop();
  console.log('component-invocation.test.js: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
