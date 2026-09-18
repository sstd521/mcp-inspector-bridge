'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function fixture(mobile = false) {
  let clock = 0, serial = 0, nonce = 0;
  const jobs = new Map(), listeners = new Map(), events = [], pointers = new Set();
  const scene = { uuid: 'scene-1', isValid: true };
  const canvas = { width: 800, height: 1200, getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 620, width: 400, height: 600 }),
    dispatchEvent(event) { events.push(event); if (event.type === this.failType) throw new Error('dispatch failed'); } };
  const window = { devicePixelRatio: 2, crypto: { getRandomValues(array) { array.fill(++nonce); return array; } },
    cc: { director: { getScene: () => scene }, sys: { isMobile: mobile, capabilities: { mouse: true, touches: true } },
    v2: (x, y) => ({ x, y }), view: { getFrameSize: () => ({ width: 800, height: 1200 }),
      getVisibleSize: () => ({ width: 800, height: 1200 }), getVisibleOrigin: () => ({ x: 0, y: 0 }) } },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); } };
  const document = { getElementById: id => id === 'GameCanvas' ? canvas : {}, querySelector: () => canvas,
    createElement: () => ({ style: {}, parentNode: null }), body: {
      appendChild(element) { pointers.add(element); element.parentNode = this; },
      removeChild(element) { pointers.delete(element); element.parentNode = null; },
    } };
  const filename = path.join(__dirname, '../dist/probe/crawler.js');
  const module = { exports: {} };
  const globals = { module, exports: module.exports, require: createRequire(filename), window, document, console,
    Date: { now: () => clock }, MouseEvent: class { constructor(type, data) { this.type = type; Object.assign(this, data); } },
    Touch: class { constructor(data) { Object.assign(this, data); } },
    TouchEvent: class { constructor(type, data) { this.type = type; Object.assign(this, data); } },
    setTimeout(callback, delay) { const id = ++serial; jobs.set(id, { callback, time: clock + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    requestAnimationFrame(callback) { const id = ++serial; jobs.set(id, { callback, time: clock + 16 }); return id; },
    cancelAnimationFrame(id) { jobs.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), globals, { filename });
  module.exports.initCrawler();
  return { window, canvas, events, jobs, listeners, pointers, globals,
    input: (args, wait = true, ownership) => window.__mcpCrawler.simulateInput(args, wait, ownership),
    emit(name) { for (const fn of [...(listeners.get(name) || [])]) fn(); },
    advance(ms) { const end = clock + ms;
      while (true) { const next = [...jobs].filter(([, job]) => job.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break; clock = next[1].time; jobs.delete(next[0]); next[1].callback(); }
      clock = end;
    },
    clean() { assert.strictEqual(jobs.size, 0); assert.strictEqual(pointers.size, 0);
      assert([...listeners.values()].every(set => set.size === 0), 'operation listeners must be removed'); },
  };
}

async function run() {
  const f = fixture();
  const pending = f.input({ x: 100, y: 200 });
  assert(pending && typeof pending.then === 'function', 'MCP opt-in must await input release');
  let settled = false; pending.then(() => { settled = true; });
  f.advance(49); await Promise.resolve(); assert.strictEqual(settled, false);
  assert.deepStrictEqual(f.events.map(e => e.type), ['mousedown'], 'dispatch one event family');
  f.advance(1);
  assert.strictEqual((await pending).completionEvidence, 'input-release-dispatched');
  assert.strictEqual((await pending).status, 'completed');
  assert.strictEqual((await pending).completionVerified, true);
  assert.deepStrictEqual(f.events.map(e => e.type), ['mousedown', 'mouseup']); f.clean();
  assert.strictEqual(f.events[0].clientX, 60); assert.strictEqual(f.events[0].clientY, 520);

  const legacy = fixture(); const receipt = legacy.input({ x: 1, y: 2 }, false);
  assert.strictEqual(receipt.success, true); assert.strictEqual(receipt.then, undefined);
  assert.strictEqual(receipt.completionVerified, undefined); legacy.advance(50); legacy.clean();

  for (const args of [{ x: NaN }, { x: '1' }, { x: 0, inputType: 'other' },
    { x: 0, duration: -1 }, { x: 0, duration: Infinity }, { x: 0, duration: 3001 }, { x: 0, swipeDeltaX: 'bad' }]) {
    const invalid = fixture(), result = await invalid.input(args); assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, undefined, 'preflight failure has no dispatched effects');
    assert.strictEqual(invalid.events.length, 0); invalid.clean();
  }
  const swipe = fixture(); const moving = swipe.input({ inputType: 'swipe', x: 100, y: 200, swipeDeltaX: 200, swipeDeltaY: 100, duration: 100 });
  swipe.advance(100); assert.strictEqual((await moving).success, true);
  const release = swipe.events[swipe.events.length - 1];
  assert.strictEqual(release.clientX, 160); assert.strictEqual(release.clientY, 470); swipe.clean();

  const touch = fixture(true); const tapped = touch.input({ x: 1, y: 2 }); touch.advance(50); await tapped;
  assert.deepStrictEqual(touch.events.map(e => e.type), ['touchstart', 'touchend']);
  assert.strictEqual(touch.events[1].touches.length, 0); assert.strictEqual(touch.events[1].targetTouches.length, 0);
  assert.strictEqual(touch.events[1].changedTouches.length, 1); touch.clean();

  for (const type of ['mousedown', 'mousemove', 'mouseup']) {
    const broken = fixture(); broken.canvas.failType = type;
    const result = broken.input({ inputType: 'swipe', x: 0, y: 0, duration: 100 });
    broken.advance(100); assert.strictEqual((await result).success, false);
    assert.strictEqual((await result).status, 'partial'); assert.strictEqual((await result).verified, false);
    assert.strictEqual((await result).retryable, false); broken.clean();
  }
  for (const event of ['pagehide', 'beforeunload']) {
    const canceled = fixture(); const result = canceled.input({ inputType: 'long_press', x: 0, duration: 3000 });
    canceled.emit(event); assert.strictEqual((await result).success, false);
    assert.strictEqual((await result).status, 'partial', 'cancellation cannot erase dispatched input');
    assert.strictEqual((await result).verified, false); assert.strictEqual((await result).retryable, false);
    assert.strictEqual(canceled.events[canceled.events.length - 1].type, 'mouseup'); canceled.clean();
    const count = canceled.events.length; canceled.advance(4000); assert.strictEqual(canceled.events.length, count);
  }
  const stalled = fixture(); stalled.globals.requestAnimationFrame = () => 999;
  const timeout = stalled.input({ inputType: 'swipe', x: 0, duration: 3000 });
  stalled.advance(3000); assert.strictEqual((await timeout).success, true, 'final release is bounded even if rAF stalls'); stalled.clean();
  for (const eventType of ['mousedown', 'mousemove']) {
    const reentrant = fixture(), dispatch = reentrant.canvas.dispatchEvent;
    reentrant.canvas.dispatchEvent = function(event) { dispatch.call(this, event); if (event.type === eventType) reentrant.emit('pagehide'); };
    const canceled = reentrant.input({ inputType: 'swipe', x: 0 });
    reentrant.advance(16); assert.strictEqual((await canceled).success, false); reentrant.clean();
  }
  const visual = fixture(), remove = visual.globals.document.body.removeChild;
  visual.globals.document.body.removeChild = function(element) { remove.call(this, element); throw new Error('visual detached'); };
  const visuallyRemoved = visual.input({ x: 0 }); let visualReceipt;
  visuallyRemoved.then(value => { visualReceipt = value; }); visual.advance(50); await Promise.resolve();
  assert(visualReceipt && visualReceipt.success, 'optional feedback removal must not strand the input receipt'); visual.clean();
  const cleanup = fixture(), removeListener = cleanup.window.removeEventListener;
  cleanup.window.removeEventListener = function(name, listener) { removeListener.call(this, name, listener); throw new Error('window detached'); };
  const cleanResult = cleanup.input({ x: 0 }); let cleanReceipt;
  cleanResult.then(value => { cleanReceipt = value; }); cleanup.advance(50); await Promise.resolve();
  assert(cleanReceipt && cleanReceipt.success, 'cleanup errors must not prevent release or settlement'); cleanup.clean();

  const panelInput = fixture();
  const filename = path.join(__dirname, '../dist/panel/index.js');
  const panelModule = { exports: {} }, actual = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: panelModule, exports: panelModule.exports,
    __dirname: path.dirname(filename), require: name => name.startsWith('./') && name !== './input-session' ? {} : actual(name),
    Editor: { url: value => value, Panel: { extend: value => value } },
  }, { filename });
  let replies = 0;
  const panelView = { getWebContentsId: () => 91, executeJavaScript: code => Promise.resolve(vm.runInNewContext(code, panelInput.globals)) };
  const panelPending = new Promise(resolve => panelModule.exports.messages['mcp-simulate-input'].call({
    shadowRoot: { querySelector: () => panelView },
  }, { reply(error, result) { replies++; resolve(result); } }, { x: 1, y: 2 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(replies, 0, 'real panel handler must await probe Promise before serializing');
  panelInput.advance(50); assert.strictEqual((await panelPending).completionEvidence, 'input-release-dispatched');
  assert.strictEqual(replies, 1); panelInput.clean();
  const interruptedView = { getWebContentsId: () => 91,
    executeJavaScript: code => code.startsWith('JSON.stringify') ? Promise.resolve(JSON.stringify({id:'a'.repeat(32)})) : Promise.reject(new Error('guest context disappeared after dispatch')) };
  const interruptedIpc = await new Promise(resolve => panelModule.exports.messages['mcp-simulate-input'].call({
    shadowRoot: { querySelector: () => interruptedView },
  }, { reply(error, result) { resolve(result); } }, { x: 1, y: 2 }));
  assert.strictEqual(interruptedIpc.status, 'partial', 'lost execution reply does not prove input had no effects');
  assert.strictEqual(interruptedIpc.verified, false); assert.strictEqual(interruptedIpc.retryable, false);

  const { EventEmitter } = require('events'); let server;
  const routerFile = path.join(__dirname, '../dist/ipc-router.js'), routerModule = { exports: {} };
  const timeouts = [], ipcTimeouts = [], responses = [];
  let ipcResult = { success: true }, ipcError = null;
  vm.runInNewContext(fs.readFileSync(routerFile, 'utf8'), { module: routerModule, exports: routerModule.exports,
    require: name => name === 'ws' ? { Server: class extends EventEmitter { constructor() { super(); server = this; } } } : createRequire(routerFile)(name),
    Editor: { Ipc: { sendToPanel(_panel, _channel, _args, callback, timeout) { if (callback) { ipcTimeouts.push(timeout); callback(ipcError, ipcResult); } } } },
    setTimeout(_fn, ms) { timeouts.push(ms); return 1; }, clearTimeout() {},
  }, { filename: routerFile });
  routerModule.exports.startMcpRouter(() => {});
  const socket = new EventEmitter(); socket.send = text => responses.push(JSON.parse(text)); server.emit('connection', socket);
  for (const [name, expected] of [['simulate_input', 4000], ['refresh_preview', 10000], ['get_node_tree', 3000]]) {
    await socket.listeners('message')[0](JSON.stringify({ id: name, method: 'tools/call', params: { name, args: {} } }));
    assert.strictEqual(timeouts[timeouts.length - 1], expected, `${name} needs an operation-specific outer deadline`);
    assert.strictEqual(ipcTimeouts[ipcTimeouts.length - 1], expected + 500);
  }
  for (const name of ['simulate_input', 'refresh_preview']) {
    const partial = { success: false, error: name === 'simulate_input' ? 'INPUT_CANCELED' : 'PREVIEW_REFRESH_INCOMPLETE',
      status: 'partial', verified: false, retryable: false };
    ipcResult = { ...partial, stack: 'private-stack', secret: 'must-not-leak', result: { forged: true } };
    await socket.listeners('message')[0](JSON.stringify({ id: name, method: 'tools/call', params: { name, args: {} } }));
    let result = responses.pop().result;
    assert.strictEqual(result.isError, true);
    assert.deepStrictEqual(JSON.parse(result.content[0].text), partial, 'direct router preserves only bounded partial fields');
    ipcResult = { success: false, error: 'INVALID_ARGS', stack: 'private-stack' };
    await socket.listeners('message')[0](JSON.stringify({ id: name, method: 'tools/call', params: { name, args: {} } }));
    assert.deepStrictEqual(JSON.parse(responses.pop().result.content[0].text), { success: false, error: 'INVALID_ARGS' });
    ipcResult = { success: false, error: 'secret-value '.repeat(100), status: 'partial', verified: false, retryable: false };
    await socket.listeners('message')[0](JSON.stringify({ id: name, method: 'tools/call', params: { name, args: {} } }));
    result = responses.pop().result;
    assert.strictEqual(JSON.parse(result.content[0].text).error, 'RUNTIME_OPERATION_FAILED', 'do not expose arbitrary plugin error text');
    ipcError = new Error('RPC_TIMEOUT: private detail');
    await socket.listeners('message')[0](JSON.stringify({ id: name, method: 'tools/call', params: { name, args: {} } }));
    result = responses.pop().result;
    assert.strictEqual(result.isError, true);
    assert.deepStrictEqual(JSON.parse(result.content[0].text), { success: false, error: 'RUNTIME_OPERATION_FAILED', status: 'partial', verified: false, retryable: false });
    ipcError = null;
  }
  console.log('input-completion.test.js: ok');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
