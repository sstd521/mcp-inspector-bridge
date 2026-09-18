'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { nextTick } = require('vue');

function fixture() {
  const writes = [];
  const editor = { Project: { path: '/owned/project' }, url: value => value,
    Panel: { extend: value => value }, Ipc: { sendToMain: (...args) => writes.push(args) } };
  const globals = { Editor: editor, console, window: { localStorage: { getItem() { return null; } }, dispatchEvent() {} }, CustomEvent: class {} };
  let onMutation = null;
  globals.MutationObserver = class { constructor(callback) { onMutation = callback; } observe() {} disconnect() {} };
  function load(file, panel = false) {
    const filename = path.join(__dirname, '..', 'dist', file);
    const module = { exports: {} }, actual = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { ...globals, module, exports: module.exports, __dirname: path.dirname(filename),
      require: name => panel && name.startsWith('./') ? {} : actual(name),
    }, { filename });
    return module.exports;
  }
  const layout = load('panel/composables/useLayout.js').useLayout({}, { value: null }, { value: { width: 389, height: 513 } });
  const definition = load('panel/index.js', true);
  const listeners = new Map();
  const view = { isConnected: true, id: 91, getWebContentsId() { return this.id; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
  };
  const panel = { _runtimeViewport: layout.runtimeViewport, shadowRoot: { querySelector: selector => selector === '#game-view' ? view : null },
    _vueApp: { unmount() {} } };
  const request = args => new Promise(resolve => definition.messages['mcp-runtime-viewport'].call(panel, { reply(error, result) { resolve({ error, result }); } }, args));
  return { layout, definition, panel, view, editor, writes, request, listeners, mutate() { onMutation(); } };
}

async function run() {
  const f = fixture();
  assert.strictEqual(typeof f.definition.messages['mcp-runtime-viewport'], 'function', 'bounded panel viewport IPC must exist');
  const args = { action: 'set_viewport', owner: 'a'.repeat(48), webContentsId: 91, projectPath: '/owned/project', width: 640, height: 360 };
  const baselineWrites = f.writes.length;
  assert.strictEqual((await f.request(args)).result.ok, true);
  assert.strictEqual(f.layout.gameContainerStyle.value.width, '640px');
  assert.strictEqual(f.layout.gameContainerStyle.value.height, '360px');
  assert.strictEqual(f.layout.selectedResolution.value, 'FIT');
  assert.strictEqual(f.writes.length, baselineWrites, 'temporary viewport must not persist user preferences');
  for (const override of [{ owner: 'b'.repeat(48) }, { webContentsId: 92 }, { projectPath: '/other/project' }, { width: 239 }, { height: 4097 }, { action: 'eval' }]) {
    assert.strictEqual((await f.request({ ...args, ...override })).result.ok, false);
    assert.strictEqual(f.layout.runtimeViewport.value.width, 640);
  }
  const reset = { action: 'reset_viewport', owner: args.owner, webContentsId: 91, projectPath: args.projectPath };
  assert.strictEqual((await f.request({ ...reset, owner: 'b'.repeat(48) })).result.ok, false);
  assert.strictEqual((await f.request(reset)).result.ok, true);
  assert.strictEqual(f.layout.gameContainerStyle.value.width, '100%');
  await f.request(args);
  f.listeners.get('did-start-loading')();
  assert.strictEqual(f.layout.runtimeViewport.value, null, 'navigation releases the old guest lease');
  await f.request(args);
  f.definition.close.call(f.panel);
  assert.strictEqual(f.layout.runtimeViewport.value, null, 'panel close releases temporary dimensions');
  const late = fixture();
  const pending = late.request(args);
  late.definition.close.call(late.panel);
  assert.strictEqual((await pending).result.ok, false, 'late Vue tick cannot reactivate a closed panel');
  const switched = fixture();
  const switching = switched.request(args);
  switched.view.id = 92;
  assert.strictEqual((await switching).result.ok, false, 'guest replacement invalidates pending set');
  assert.strictEqual(switched.layout.runtimeViewport.value, null);
  const unavailable = fixture();
  const failing = unavailable.request(args);
  unavailable.view.getWebContentsId = () => { throw new Error('guest destroyed'); };
  assert.strictEqual((await failing).result.ok, false);
  assert.strictEqual(unavailable.layout.runtimeViewport.value, null, 'native identity errors after Vue commit release the lease');
  const detached = fixture(); await detached.request(args);
  detached.view.isConnected = false; detached.mutate();
  assert.strictEqual(detached.layout.runtimeViewport.value, null, 'removing the old DOM view cannot leak dimensions to its replacement');
  const destroyed = fixture(); await destroyed.request(args);
  destroyed.listeners.get('destroyed')();
  assert.strictEqual(destroyed.layout.runtimeViewport.value, null);
  const changed = fixture(); await changed.request(args);
  changed.view.id = 92;
  assert.strictEqual((await changed.request(reset)).result.ok, false);
  assert.strictEqual(changed.layout.runtimeViewport.value, null, 'stale reset is rejected but releases only its vanished old lease');
  await nextTick();
  console.log('PASS bounded runtime viewport panel IPC, layout and lease lifecycle');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
