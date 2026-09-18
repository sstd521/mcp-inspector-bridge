'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { reactive } = require('vue');

function emitter() {
  const listeners = new Map();
  return { listeners,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, event = {}) { for (const fn of [...(listeners.get(name) || [])]) fn(event); },
  };
}
function fixture() {
  const timers = new Map(), ports = [], loads = [];
  let timerId = 0, mutation = null;
  const state = reactive({ runMode: 'preview', isEditorSceneActive: true, previewPort: 7456, webviewSrc: '' });
  const window = emitter();
  const view = Object.assign(emitter(), { src: 'http://localhost:7456/', currentUrl: 'http://localhost:7456/',
    clientWidth: 800, clientHeight: 600, isConnected: true, ownerDocument: {}, getWebContentsId: () => 91,
    getURL() { return this.currentUrl; },
    loadURL(url) { loads.push(url); return new Promise((resolve, reject) => { this.resolveLoad = resolve; this.rejectLoad = reject; }); },
  });
  const gameView = { value: view };
  const filename = path.join(__dirname, '../dist/panel/composables/useGameView.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: createRequire(filename),
    Editor: { Ipc: { sendToMain(channel, callback) { if (channel === 'mcp-inspector-bridge:query-preview-port') ports.push(callback); } } },
    window, URL, console: { log() {}, warn() {} },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} disconnect() { mutation = null; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { filename });
  const runtime = module.exports.useGameView(state, gameView, { value: null }, { value: 300 }, { value: '' }, () => {});
  const nav = { url: 'http://localhost:7462/', isMainFrame: true, isInPlace: false, frameProcessId: 2, frameRoutingId: 7 };
  return { state, view, window, runtime, timers, ports, loads, gameView, nav,
    mutate() { if (mutation) mutation(); },
    timeout() { for (const [, item] of [...timers]) item.fn(); },
    start(event = nav) { view.emit('did-start-navigation', event); },
    commit(event = nav) { view.currentUrl = event.url; view.emit('did-frame-navigate', event); },
    finish(event = nav) { view.emit('did-frame-finish-load', event); view.resolveLoad?.(); },
    clean() { assert.strictEqual(timers.size, 0, 'request deadline cleared');
      for (const target of [view, window]) assert([...target.listeners.values()].every(set => set.size === 0), 'request listeners removed');
      assert.strictEqual(mutation, null, 'detach observer removed'); },
  };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

async function run() {
  const f = fixture(); let result;
  const request = f.runtime.refreshGame(true).then(value => { result = value; return value; });
  f.ports[0](null, 7462); await flush();
  assert.strictEqual(result, undefined, 'refresh cannot complete at dispatch');
  assert.deepStrictEqual(f.loads, ['http://localhost:7462']);
  f.finish(); await flush(); assert.strictEqual(result, undefined, 'old finish ignored before our navigation');
  f.start({ ...f.nav, isMainFrame: false }); f.commit({ ...f.nav, isMainFrame: false });
  f.finish({ ...f.nav, isMainFrame: false }); await flush(); assert.strictEqual(result, undefined, 'subframe events ignored');
  f.start(); f.finish(); await flush(); assert.strictEqual(result, undefined, 'finish before this URL commits is insufficient');
  f.commit(); f.finish({ ...f.nav, frameRoutingId: 99 }); await flush(); assert.strictEqual(result, undefined, 'other frame ignored');
  f.finish();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await request)), { success: true, status: 'completed', completionVerified: true, completionEvidence: 'navigation-finished' });
  assert.strictEqual(f.state.webviewSrc, '', 'do not mutate the Vue-bound src after native loadURL: Electron treats even same-value src assignment as reload');
  f.clean();

  for (const cancel of [f => f.window.emit('panel-close'), f => f.window.emit('beforeunload'),
    f => f.view.emit('destroyed'), f => { f.state.runMode = 'custom'; },
    f => { f.gameView.value = {}; f.mutate(); }, f => { f.view.isConnected = false; f.mutate(); }, f => f.timeout()]) {
    const canceled = fixture(); const pending = canceled.runtime.refreshGame(true);
    cancel(canceled); assert.strictEqual((await pending).success, false, 'cancel pending port query');
    assert.strictEqual((await pending).status, undefined, 'cancel before dispatch is distinct from partial execution');
    canceled.ports[0](null, 7462); await flush(); assert.strictEqual(canceled.loads.length, 0, 'late query must not dispatch'); canceled.clean();
  }
  for (const cancel of [f => f.window.emit('panel-close'), f => f.runtime.switchRunMode('custom'),
    f => f.view.emit('destroyed'), f => f.view.emit('render-process-gone'), f => f.timeout(),
    f => { f.view.emit('did-fail-load', { ...f.nav, validatedURL: f.nav.url, errorCode: -105 }); },
    f => f.start({ ...f.nav, url: 'https://unrelated.test/' })]) {
    const canceled = fixture(); const pending = canceled.runtime.refreshGame(true);
    canceled.ports[0](null, 7462); await flush(); canceled.start();
    cancel(canceled); assert.strictEqual((await pending).success, false);
    assert.strictEqual((await pending).status, 'partial', 'navigation dispatch cannot be reported as zero effects');
    assert.strictEqual((await pending).verified, false); assert.strictEqual((await pending).retryable, false);
    // Existing UI mode-switch timers are not owned by the completed MCP operation.
    if (canceled.state.runMode === 'custom') canceled.timers.clear();
    canceled.clean(); canceled.finish(); assert.strictEqual(canceled.loads.length, 1);
  }
  const hidden = fixture(); hidden.view.clientWidth = 0;
  assert.strictEqual((await hidden.runtime.refreshGame(true)).success, false);
  assert.strictEqual(hidden.loads.length, 0); assert.strictEqual(hidden.ports.length, 0);
  assert.strictEqual(hidden.timers.size, 0, 'hidden MCP request must not schedule deferred refresh');

  const registering = fixture(), add = registering.view.addEventListener;
  registering.view.addEventListener = function(name, listener) { if (name === 'did-frame-navigate') throw new Error('view detached'); add.call(this, name, listener); };
  assert.strictEqual((await registering.runtime.refreshGame(true)).success, false);
  registering.clean();

  const failedCall = fixture(); const failed = failedCall.runtime.refreshGame(true);
  failedCall.ports[0](null, 7462); await flush(); failedCall.view.rejectLoad(new Error('loadURL failed'));
  let rejected; failed.then(value => { rejected = value; }); await flush();
  assert(rejected && rejected.success === false, 'native asynchronous navigation failure must settle once'); failedCall.clean();

  const cleanup = fixture(), removeListener = cleanup.view.removeEventListener;
  cleanup.view.removeEventListener = function(name, listener) { removeListener.call(this, name, listener); throw new Error('host detached'); };
  const cleanResult = cleanup.runtime.refreshGame(true); cleanup.ports[0](null, 7462); await flush();
  assert.doesNotThrow(() => cleanup.window.emit('panel-close'));
  assert.strictEqual((await cleanResult).success, false); cleanup.clean();
  const disappeared = fixture(); const missing = disappeared.runtime.refreshGame(true);
  disappeared.ports[0](null, 7462); await flush(); disappeared.start(); disappeared.commit();
  disappeared.view.getURL = () => { throw new Error('guest disappeared'); };
  assert.doesNotThrow(() => disappeared.finish()); assert.strictEqual((await missing).success, false); disappeared.clean();

  const superseded = fixture(); const old = superseded.runtime.refreshGame(true);
  const next = superseded.runtime.refreshGame(true);
  assert.strictEqual((await old).success, false);
  superseded.ports[0](null, 7463); superseded.ports[1](null, 7462); await flush();
  superseded.start(); superseded.commit(); superseded.finish(); assert.strictEqual((await next).success, true);
  assert.deepStrictEqual(superseded.loads, ['http://localhost:7462']); superseded.clean();

  const panelRefresh = fixture(), filename = path.join(__dirname, '../dist/panel/index.js');
  const module = { exports: {} }, actual = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\n_refreshGameFn = __refreshGame;', {
    module, exports: module.exports, __dirname: path.dirname(filename), __refreshGame: panelRefresh.runtime.refreshGame,
    require: name => name === './store' ? { globalState: panelRefresh.state } : name.startsWith('./') ? {} : actual(name),
    Editor: { url: value => value, Panel: { extend: value => value } },
  }, { filename });
  let replies = 0;
  const ipc = new Promise(resolve => module.exports.messages['mcp-refresh-preview'].call({}, {
    reply(error, result) { replies++; resolve(result); },
  }));
  panelRefresh.ports[0](null, 7462); await flush();
  assert.strictEqual(replies, 0, 'real panel handler must opt in to navigation completion');
  panelRefresh.start(); panelRefresh.commit(); panelRefresh.finish();
  assert.strictEqual((await ipc).completionEvidence, 'navigation-finished'); assert.strictEqual(replies, 1); panelRefresh.clean();
  console.log('refresh-completion.test.js: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
