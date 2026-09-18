'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function load(filename, globals) {
  const resolved = path.join(__dirname, '..', 'dist', filename);
  const module = { exports: {} };
  const requireModule = createRequire(resolved);
  vm.runInNewContext(fs.readFileSync(resolved, 'utf8'), {
    module, exports: module.exports,
    require: name => name === './proxy-manager' ? {} : requireModule(name),
    console: { log() {}, warn() {}, error() {} },
    ...globals,
  }, { filename: resolved });
  return module.exports;
}

function fixture(mode = 'preview') {
  const calls = [];
  const fetches = [];
  const listeners = {};
  const state = {
    runMode: mode, isEditorSceneActive: true, previewPort: 7456,
    webviewSrc: '', customUrl: 'https://example.test/game', nodeTree: null,
  };
  const view = { src: '', clientWidth: 800, clientHeight: 600,
    addEventListener(name, listener) { listeners[name] = listener; } };
  const editor = { Ipc: { sendToMain(channel, callback) {
    calls.push({ channel, callback });
    if (channel === 'mcp-inspector-bridge:query-scene-active') callback(null, true);
  } } };
  const { useGameView } = load('panel/composables/useGameView.js', {
    Editor: editor, window: { addEventListener() {} },
    AbortController, setTimeout: () => 1, clearTimeout() {},
    fetch: async url => {
      fetches.push(url);
      return { status: 200, text: async () => '<canvas id="GameCanvas">' };
    },
  });
  const runtime = useGameView(state, { value: view }, { value: null }, { value: 300 }, { value: '' }, () => {});
  return { state, view, runtime, calls, fetches,
    portCalls: () => calls.filter(call => call.channel === 'mcp-inspector-bridge:query-preview-port') };
}

async function run() {
  // Creator 2.4.15 exposes its bound _previewPort through this public getter.
  let profileReads = 0;
  const editor = { PreviewServer: {
    _previewPort: 7462,
    get previewPort() { return this._previewPort; },
  }, Profile: {
    load() { profileReads++; return { data: { 'preview-port': 7461 } }; },
  } };
  const main = load('main.js', { Editor: editor });
  const queryPort = () => new Promise(resolve => main.messages['query-preview-port']({
    reply(error, port) { resolve({ error, port }); },
  }));
  assert.strictEqual((await queryPort()).port, 7462, 'use the actual public PreviewServer port');
  editor.PreviewServer._previewPort = 7456;
  assert.strictEqual((await queryPort()).port, 7456, 'a saved setting must not replace the actual default port');
  assert.strictEqual(profileReads, 0);
  for (const value of [undefined, null, 0, -1, 65536, 7456.5, '7456']) {
    editor.PreviewServer._previewPort = value;
    const result = await queryPort();
    assert(result.error && result.port === undefined, 'reject unavailable or invalid actual ports');
  }
  editor.PreviewServer = undefined;
  assert((await queryPort()).error, 'fail closed without a Preview server');

  const ready = fixture();
  const loading = ready.runtime.refreshGame();
  assert.strictEqual(ready.view.src, '', 'do not load the default port while querying');
  assert.strictEqual(ready.portCalls().length, 1);
  ready.portCalls()[0].callback(null, 7462);
  assert.strictEqual(await loading, true);
  assert.strictEqual(ready.view.src, 'http://localhost:7462');
  assert.strictEqual(ready.state.previewPort, 7462);
  assert.deepStrictEqual(ready.fetches, [], 'never scan neighboring servers');

  for (const [error, port] of [[new Error('not ready'), undefined], [null, 0], [null, '7462']]) {
    const denied = fixture();
    const loading = denied.runtime.refreshGame();
    denied.portCalls()[0].callback(error, port);
    assert.strictEqual(await loading, false);
    assert.strictEqual(denied.view.src, '');
    assert.deepStrictEqual(denied.fetches, []);
  }

  const switched = fixture();
  const oldLoad = switched.runtime.refreshGame();
  switched.state.runMode = 'custom';
  await switched.runtime.refreshGame();
  switched.portCalls()[0].callback(null, 7462);
  assert.strictEqual(await oldLoad, false);
  assert.strictEqual(switched.view.src, switched.state.customUrl, 'stale Preview reply cannot replace custom mode');

  const concurrent = fixture();
  const first = concurrent.runtime.refreshGame();
  const second = concurrent.runtime.refreshGame();
  concurrent.portCalls()[1].callback(null, 7463);
  assert.strictEqual(await second, true);
  concurrent.portCalls()[0].callback(null, 7462);
  assert.strictEqual(await first, false);
  assert.strictEqual(concurrent.view.src, 'http://localhost:7463');

  const inactive = fixture();
  const inactiveLoad = inactive.runtime.refreshGame();
  inactive.state.isEditorSceneActive = false;
  inactive.portCalls()[0].callback(null, 7462);
  assert.strictEqual(await inactiveLoad, false);
  assert.strictEqual(inactive.view.src, '', 'ignore a reply after the scene closes');

  const detached = fixture();
  const detachedLoad = detached.runtime.refreshGame();
  detached.view.isConnected = false;
  detached.portCalls()[0].callback(null, 7462);
  assert.strictEqual(await detachedLoad, false);
  assert.strictEqual(detached.view.src, '', 'ignore a reply after the panel detaches');

  const startup = fixture();
  startup.runtime.setupGameViewListeners();
  assert.strictEqual(startup.view.src, '');
  assert.strictEqual(startup.portCalls().length, 1);
  startup.portCalls()[0].callback(null, 7462);
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(startup.view.src, 'http://localhost:7462');
  assert.deepStrictEqual(startup.fetches, [], 'startup must not scan settings.js on other ports');

  for (const mode of ['build', 'custom']) {
    const other = fixture(mode);
    await other.runtime.refreshGame();
    assert.strictEqual(other.view.src, mode === 'build' ? 'http://localhost:7456/build/' : other.state.customUrl);
    assert.strictEqual(other.portCalls().length, 0);
  }
  console.log('preview-endpoint.test.js: ok');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
