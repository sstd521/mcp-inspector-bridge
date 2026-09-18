'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fixture } = require('./input-completion.test');
const owned = { owner: 'a'.repeat(48), requestId: 'b'.repeat(48) };
function trajectory(f, pointerType = 'touch') {
  return { inputType: 'trajectory', pointerType, coordinateSpace: 'cocos-bottom-left',
    expectedContext: f.window.__mcpCrawler.getInputContext().id,
    frames: [{ atMs: 0, points: [{ id: 0, x: 100, y: 200 }] },
      { atMs: 40, points: [{ id: 0, x: 200, y: 300 }] }, { atMs: 80, points: [] }] };
}
// Optional local integration: execute Creator's actual touch pool and coordinate converters.
const engineRoot = process.env.CREATOR24_ENGINE_ROOT || '/Volumes/feng/Creator/2.4.15n/CocosCreator.app/Contents/Resources/engine';
function engineFixture() {
  const f = fixture(), cc = f.window.cc, dispatched = [];
  delete cc.sys.capabilities.touches;
  delete f.globals.Touch; delete f.globals.TouchEvent;
  cc.internal = {}; cc.sys.now = () => f.globals.Date.now();
  cc.sys.browserType = 'chrome'; cc.sys.BROWSER_TYPE_FIREFOX = 'firefox';
  cc.v2 = (x = 0, y = 0) => typeof x === 'object' ? { x: x.x, y: x.y } : { x, y };
  cc.js = { mixin: Object.assign };
  const viewSource = fs.readFileSync(path.join(engineRoot, 'cocos2d/core/platform/CCView.js'), 'utf8');
  const viewStart = viewSource.indexOf('cc.js.mixin(View.prototype, {');
  const View = function () {};
  assert(viewStart > 0);
  vm.runInNewContext(viewSource.slice(viewStart, viewSource.indexOf('\n});', viewStart) + 4), { cc, View });
  for (const method of ['convertToLocationInView', '_convertPointWithScale', '_convertTouchesWithScale']) cc.view[method] = View.prototype[method];
  Object.assign(cc.view, { _scaleX: 0.75, _scaleY: 0.75, _devicePixelRatio: 1,
    _viewportRect: { x: 0, y: 0, width: 640, height: 480 },
    getVisibleSize: () => ({ width: 640 / 0.75, height: 640 }), getFrameSize: () => ({ width: 640, height: 480 }) });
  f.window.devicePixelRatio = 1;
  f.canvas.width = 640; f.canvas.height = 480;
  f.canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 640, height: 480 });
  cc.game = { canvas: f.canvas };
  vm.runInNewContext(fs.readFileSync(path.join(engineRoot, 'cocos2d/core/event-manager/CCTouch.js'), 'utf8'), { cc });
  cc.Event = { EventTouch: class { constructor(touches) { this.touches = touches; } } };
  Object.assign(cc.Event.EventTouch, { BEGAN: 0, MOVED: 1, ENDED: 2, CANCELED: 3 });
  const eventManager = { dispatchEvent(event) {
    dispatched.push({ code: event._eventCode, count: manager.getGlobalTouchCount(),
      touches: Array.from(event.touches, touch => ({ id: touch.getID(), x: touch.getLocationX(), y: touch.getLocationY(),
        previous: touch.getPreviousLocation() })) });
  } };
  vm.runInNewContext(fs.readFileSync(path.join(engineRoot, 'cocos2d/core/platform/CCInputManager.js'), 'utf8'), {
    cc, module: { exports: {} }, require(name) {
      if (name === './CCMacro') return { TOUCH_TIMEOUT: 5000 };
      if (name === './CCSys') return cc.sys;
      if (name === '../event-manager') return eventManager;
      throw new Error('Unexpected engine dependency: ' + name);
    },
  });
  const manager = cc.internal.inputManager;
  manager._glView = cc.view; manager._isRegisterEvent = true;
  return Object.assign(f, { manager, dispatched });
}
async function desktopEngineTrajectory() {
  const f = engineFixture(), args = trajectory(f);
  args.frames = [{ atMs: 0, points: [{ id: 0, x: 540, y: 410 }, { id: 1, x: 620, y: 410 }] },
    { atMs: 200, points: [{ id: 0, x: 520, y: 430 }, { id: 1, x: 640, y: 430 }] }, { atMs: 400, points: [] }];
  const pending = f.input(args, true, owned); f.advance(400);
  const result = await pending;
  assert.strictEqual(result.success, true, 'desktop touch trajectory must use the initialized Creator input manager');
  assert.strictEqual(result.framesDispatched, 3); assert.strictEqual(result.completionEvidence, 'input-release-dispatched');
  assert.deepStrictEqual(f.dispatched.map(event => [event.code, event.count, event.touches.length]), [[0, 2, 2], [1, 2, 2], [2, 0, 2]]);
  assert.deepStrictEqual(f.dispatched[1].touches.map(touch => [touch.x, touch.y, touch.previous.x, touch.previous.y]), [[520, 430, 540, 410], [640, 430, 620, 410]]);
  assert.notStrictEqual(f.dispatched[0].touches[0].id, f.dispatched[0].touches[1].id);
  assert.strictEqual(f.events.length, 0, 'engine and DOM input must never both dispatch');
  assert.strictEqual('touches' in f.window.cc.sys.capabilities, false); f.clean();

  const boxed = engineFixture(); Object.assign(boxed.window.cc.view, { _scaleX: 1.5, _scaleY: 1.5, _devicePixelRatio: 2,
    _viewportRect: { x: 40, y: 60, width: 1200, height: 840 } });
  const boxedInput = boxed.input(trajectory(boxed), true, owned); boxed.advance(80);
  assert.strictEqual((await boxedInput).success, true);
  assert.deepStrictEqual(boxed.dispatched[1].touches.map(touch => [touch.x, touch.y, touch.previous.x, touch.previous.y]), [[200, 300, 100, 200]]);
  boxed.clean();

  const canceled = engineFixture(), waiting = canceled.input(trajectory(canceled), true, owned);
  const external = new canceled.window.cc.Touch(10, 20, 900); external._setPrevPoint(10, 20);
  canceled.manager.handleTouchesBegin([external]);
  canceled.window.__mcpCrawler.cancelInput(owned.owner, 'c'.repeat(48));
  assert.strictEqual(canceled.manager.getGlobalTouchCount(), 2);
  canceled.window.__mcpCrawler.cancelInput(owned.owner, owned.requestId);
  assert.strictEqual((await waiting).status, 'partial');
  assert.strictEqual(canceled.dispatched.at(-1).code, 3);
  assert.strictEqual(canceled.manager.getGlobalTouchCount(), 1, 'cancel releases only this lease, not a concurrent real touch');
  assert.deepStrictEqual(Object.keys(canceled.manager.getGlobalTouches()), ['900']);
  canceled.manager.handleTouchesCancel([external]); canceled.clean();

  for (const explicitCancel of [false, true]) for (const invalidView of [null, {}]) {
    const stale = engineFixture(), request = trajectory(stale), pending = stale.input(request, true, owned);
    const other = new stale.window.cc.Touch(10, 20, 900); other._setPrevPoint(10, 20);
    stale.manager.handleTouchesBegin([other]);
    const ownedId = stale.dispatched[0].touches[0].id;
    stale.manager._glView = invalidView;
    let cancellation;
    if (explicitCancel) cancellation = stale.window.__mcpCrawler.cancelInput(owned.owner, owned.requestId);
    else stale.advance(80);
    const result = await pending;
    assert.strictEqual(result.status, 'partial'); assert.strictEqual(result.completionVerified, undefined);
    if (explicitCancel) assert.strictEqual(cancellation.released, false, 'an unavailable cancellation event must not claim a dispatched release');
    else assert.strictEqual(result.error, 'STALE_INPUT_CONTEXT');
    assert.strictEqual(stale.manager.getGlobalTouches()[ownedId], undefined, 'a lost view cannot strand an owned engine contact');
    assert.deepStrictEqual(Object.keys(stale.manager.getGlobalTouches()), ['900']);
    assert.strictEqual(stale.manager.getGlobalTouchCount(), 1);
    assert.strictEqual(stale.manager._glView, invalidView, 'cleanup never replaces the shared view');
    assert.deepStrictEqual(stale.dispatched.map(event => event.code), [0, 0], 'invalid view must not receive a new event');
    stale.manager._glView = stale.window.cc.view;
    stale.manager.handleTouchesCancel([other]);
    const next = stale.input(trajectory(stale), true, { ...owned, requestId: 'd'.repeat(48) }); stale.advance(80);
    assert.strictEqual((await next).success, true, 'a new request is not blocked by leaked owned touches'); stale.clean();
  }
  for (const change of [f => { f.window.cc.view._scaleX = 0.5; }, f => { f.window.cc.game.canvas = {}; },
    f => { f.window.cc.internal.inputManager = {}; }]) {
    const stale = engineFixture(), moving = stale.input(trajectory(stale), true, owned);
    change(stale); stale.advance(80);
    assert.strictEqual((await moving).status, 'partial'); assert.strictEqual(stale.dispatched.at(-1).code, 3);
    assert.strictEqual(stale.manager.getGlobalTouchCount(), 0); stale.clean();
  }
  for (const change of [f => { f.manager.handleTouchesCancel = undefined; }, f => { f.manager._glView = {}; },
    f => { f.manager._isRegisterEvent = false; }, f => { f.window.cc.game.canvas = {}; },
    f => { f.window.cc.view._convertTouchesWithScale = undefined; }, f => { f.window.cc.view._scaleX = NaN; }]) {
    const unavailable = engineFixture(); change(unavailable);
    const waiting = unavailable.input(trajectory(unavailable), true, owned); unavailable.advance(3000);
    const rejected = await waiting;
    assert.strictEqual(rejected.error, 'INPUT_UNAVAILABLE'); assert.strictEqual(unavailable.dispatched.length, 0); unavailable.clean();
  }
  const broken = engineFixture(), begin = broken.manager.handleTouchesBegin;
  broken.manager.handleTouchesBegin = function (touches) { begin.call(this, touches); throw new Error('listener failed'); };
  const failed = await broken.input(trajectory(broken), true, owned);
  assert.strictEqual(failed.status, 'partial'); assert.strictEqual(failed.retryable, false);
  assert.strictEqual(broken.manager.getGlobalTouchCount(), 0); broken.clean();
}
async function run() {
  if (fs.existsSync(path.join(engineRoot, 'cocos2d/core/platform/CCInputManager.js'))) await desktopEngineTrajectory();
  else console.log('Creator input-manager integration skipped: set CREATOR24_ENGINE_ROOT to a local Creator 2.4 engine');
  const f = fixture();
  assert.strictEqual(typeof f.window.__mcpCrawler.getInputContext, 'function', 'probe exposes bounded input context');
  const context = f.window.__mcpCrawler.getInputContext();
  assert.match(context.id, /^[a-f0-9]{32}$/); assert.strictEqual(context.sceneUuid, 'scene-1');
  assert.strictEqual(context.coordinateSpace, 'cocos-bottom-left'); assert.strictEqual(context.dpr, 2);
  assert.strictEqual(f.window.__mcpCrawler.getInputContext().id, context.id);
  const input = trajectory(f); input.frames[0].points.push({ id: 1, x: 300, y: 200 });
  input.frames[1].points.push({ id: 1, x: 350, y: 300 });
  const pending = f.input(input, true, owned); f.advance(79);
  assert.deepStrictEqual(f.events.map(event => event.type), ['touchstart', 'touchmove']);
  assert.strictEqual(f.events[0].changedTouches.length, 2);
  assert.notStrictEqual(f.events[0].changedTouches[0].identifier, f.events[0].changedTouches[1].identifier);
  assert.notStrictEqual(f.events[0].changedTouches[0].identifier, 0, 'logical touch IDs do not reuse engine mouse ID0');
  f.advance(1); const receipt = await pending;
  assert.strictEqual(receipt.completionEvidence, 'input-release-dispatched');
  assert.strictEqual(receipt.framesDispatched, 3); assert.strictEqual(receipt.totalFrames, 3);
  assert.strictEqual(f.events[2].touches.length, 0); assert.strictEqual(f.events[2].changedTouches.length, 2); f.clean();
  for (const change of [args => { args.frames[2].atMs = 3001; }, args => { args.frames[1].atMs = 0; },
    args => { args.frames[1].points.push({ ...args.frames[1].points[0] }); }, args => { args.frames[1].points[0].x = Infinity; },
    args => { args.frames[1].points[0].x = 9999; }, args => { args.frames[2].points = [{ id: 0, x: 1, y: 1 }]; },
    args => { args.frames[1].points[0].id = 5; }, args => { args.frames[1].bad = true; },
    args => { args.frames = Array.from({ length: 121 }, (_, i) => ({ atMs: i, points: i === 120 ? [] : [{ id: 0, x: 1, y: 1 }] })); },
    args => { args.coordinateSpace = 'css'; }, args => { args.expectedContext = '0'.repeat(32); }]) {
    const invalid = fixture(), args = trajectory(invalid); change(args);
    const result = await invalid.input(args, true, owned);
    assert.strictEqual(result.success, false); assert.strictEqual(result.status, undefined); assert.strictEqual(invalid.events.length, 0); invalid.clean();
  }
  const mouse = fixture(); const moved = mouse.input(trajectory(mouse, 'mouse'), true, owned); mouse.advance(80);
  assert.strictEqual((await moved).success, true); assert.deepStrictEqual(mouse.events.map(e => e.type), ['mousedown', 'mousemove', 'mouseup']); mouse.clean();
  const letterbox = fixture(); Object.assign(letterbox.window.cc.view, { _scaleX: 0.5, _scaleY: 0.5, _devicePixelRatio: 1,
    _viewportRect: { x: 40, y: 60, width: 400, height: 600 } });
  const boxed = letterbox.input(trajectory(letterbox, 'mouse'), true, owned); letterbox.advance(80); await boxed;
  assert.strictEqual(letterbox.events[0].clientX, 100); assert.strictEqual(letterbox.events[0].clientY, 460); letterbox.clean();
  const rotated = fixture(); rotated.window.cc.view._isRotated = true;
  const rotatedResult = await rotated.input({ inputType: 'click', x: 0, y: 0 }, true, owned);
  assert.strictEqual(rotatedResult.success, false); assert.strictEqual(rotated.events.length, 0);
  const canceled = fixture(), args = trajectory(canceled); const waiting = canceled.input(args, true, owned);
  assert.strictEqual((await canceled.input(args, true, { ...owned, requestId: 'c'.repeat(48) })).error, 'INPUT_BUSY');
  canceled.window.__mcpCrawler.cancelInput(owned.owner, 'c'.repeat(48)); assert.strictEqual(canceled.events.length, 1);
  const released = canceled.window.__mcpCrawler.cancelInput(owned.owner, owned.requestId);
  assert.strictEqual(released.released, true); assert.strictEqual((await waiting).status, 'partial');
  assert.strictEqual((await waiting).framesDispatched, 1); assert.strictEqual(canceled.events[1].type, 'touchcancel'); canceled.clean();
  assert.strictEqual((await canceled.input(args, true, owned)).success, false, 'duplicate request cannot replay');
  const early = fixture(); early.window.__mcpCrawler.cancelInput(owned.owner, owned.requestId);
  assert.strictEqual((await early.input(trajectory(early), true, owned)).success, false); assert.strictEqual(early.events.length, 0); early.clean();
  for (const change of [f => { f.window.devicePixelRatio = 3; }, f => { f.canvas.width = 999; },
    f => { f.window.cc.view._scaleX = 2; },
    f => { f.window.cc.director.getScene = () => ({ uuid: 'scene-2' }); }]) {
    const stale = fixture(); const pending = stale.input(trajectory(stale), true, owned); change(stale); stale.advance(40);
    assert.strictEqual((await pending).status, 'partial'); assert.strictEqual(stale.events[1].type, 'touchcancel'); stale.clean();
  }
  const occupied = fixture(); occupied.window.cc.internal = { inputManager: { getGlobalTouchCount: () => 1 } };
  assert.strictEqual((await occupied.input(trajectory(occupied), true, owned)).error, 'INPUT_BUSY'); assert.strictEqual(occupied.events.length, 0);
  const legacyTouch = fixture(true), legacyPending = legacyTouch.input({ x: 0, y: 0 }, true, owned);
  legacyTouch.window.__mcpCrawler.cancelInput(owned.owner, owned.requestId);
  assert.strictEqual((await legacyPending).status, 'partial');
  assert.strictEqual(legacyTouch.events[1].type, 'touchcancel'); legacyTouch.clean();
  assert.notStrictEqual(legacyTouch.events[0].changedTouches[0].identifier, 0);
  const failedRelease = fixture(); failedRelease.canvas.failType = 'touchend';
  const broken = failedRelease.input(trajectory(failedRelease), true, owned); failedRelease.advance(80);
  assert.strictEqual((await broken).status, 'partial');
  assert.strictEqual(failedRelease.events.at(-1).type, 'touchcancel', 'failed end keeps owned contacts available for cleanup'); failedRelease.clean();
  console.log('input-trajectory.test.js: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
