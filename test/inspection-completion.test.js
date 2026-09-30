const assert = require('assert');
class Component {}
class Node {}
class Asset {}
class Scene {}
class Button extends Component {}
const node = { uuid: 'node', name: 'Node', children: [], childrenCount: 0, isValid: true, _components: [], getComponent: () => null };
let scene = node;
const cc = { Component, Node, Asset, Scene, Button, director: { getScene: () => scene }, game: { groupList: [] },
  js: { getClassName: c => c.name || c.constructor.name, _getClassId: () => 'cc.Test' } };
global.window = { cc };
require('../dist/probe/crawler').initCrawler();
const crawler = window.__mcpCrawler;
function inspect(C, values, includeRuntime = false) {
  node._components = [Object.assign(new C(), values)];
  return crawler.getNodeDetail('node', { includeRuntime }).components[0].properties;
}
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
test('build metadata and visibility support both separators', () => {
  class Builtin extends Component {}
  Builtin.__props__ = ['name', 'enabled'];
  Builtin.__attrs__ = { 'score$_$type': 'Integer', '_visible$_$visible': true, 'hidden|visible': false };
  const props = inspect(Builtin, { score: 42, _visible: 3, hidden: 9 });
  assert(props.some(p => p.key === 'score' && p.value === 42));
  assert(props.some(p => p.key === '_visible'));
  assert(!props.some(p => p.key === 'hidden'));
});
test('Creator 2.4 omits visible true metadata on registered underscore fields', () => {
  class Custom extends Component {}
  Custom.__props__ = ['_visible', '_hidden'];
  Custom.__attrs__ = { '_visible$_$default': 7, '_hidden$_$visible': false };
  const props = inspect(Custom, { _visible: 7, _hidden: 9, _runtimePrivate: 11 }, true);
  assert(props.some(p => p.key === '_visible' && p.value === 7));
  assert(!props.some(p => p.key === '_hidden' || p.key === '_runtimePrivate'));
});
test('build inherits accessor metadata from base components', () => {
  class Derived extends Component { get inherited() { return 42; } }
  Derived.__props__ = ['configured'];
  Derived.__attrs__ = Object.assign(Object.create({ 'inherited$_$serializable': false }), { 'configured$_$default': 1 });
  assert(inspect(Derived, { configured: 1 }).some(p => p.key === 'inherited' && p.value === 42));
});
test('runtime properties are bounded and opt in', () => {
  class Custom extends Component {}
  Custom.__props__ = ['configured'];
  assert(!inspect(Custom, { configured: 1, runtimeCounter: 42 }).some(p => p.key === 'runtimeCounter'));
  assert(inspect(Custom, { configured: 1, runtimeCounter: 42 }, true).some(p => p.key === 'runtimeCounter'));
  assert(inspect(Custom, Object.fromEntries(Array.from({length: 500}, (_, i) => ['field' + i, i])), true).length <= 128);
});
test('typed null and undefined references survive JSON', () => {
  class Missing extends Component {}
  Missing.__props__ = ['target', 'asset', 'unset'];
  Missing.__attrs__ = { 'target$_$ctor': Node, 'asset|ctor': Asset };
  const props = JSON.parse(JSON.stringify(inspect(Missing, { target: null, asset: null })));
  assert.deepStrictEqual(props.find(p => p.key === 'target'), { key: 'target', type: 'null', value: null, declaredType: 'Node' });
  assert.strictEqual(props.find(p => p.key === 'asset').declaredType, 'Asset');
  assert.strictEqual(props.find(p => p.key === 'unset').type, 'undefined');
});
test('getter failure is explicit and does not leak error message', () => {
  class Broken extends Component { get broken() { throw new Error('secret'); } }
  Broken.__props__ = ['broken'];
  assert.deepStrictEqual(inspect(Broken, {})[0], { key: 'broken', type: 'read_error', value: null });
});
test('promise invocation waits and reports real completion', async () => {
  let finish;
  class Async extends Component { run() { return new Promise(resolve => { finish = resolve; }); } }
  node._components = [new Async()];
  let settled = false;
  const result = Promise.resolve(crawler.executeComponentMethod('node', 0, 'run')).then(r => { settled = true; return r; });
  await Promise.resolve();
  assert.strictEqual(settled, false);
  finish();
  assert.deepStrictEqual(await result, { success: true, status: 'completed', completionVerified: true, completionEvidence: 'method-promise-resolved' });
});
test('sync, rejection, invalid method and stale scene are truthful', async () => {
  class Methods extends Component { run() {} fail() { return Promise.reject(new Error('secret')); } changeScene() { scene = {}; } }
  node._components = [new Methods()];
  assert.strictEqual((await crawler.executeComponentMethod('node', 0, 'run')).completionEvidence, 'method-returned');
  assert.strictEqual((await crawler.executeComponentMethod('node', 0, 'fail')).success, false);
  assert.strictEqual((await crawler.executeComponentMethod('node', 0, '_private')).success, false);
  assert.strictEqual((await crawler.executeComponentMethod('node', 0, 'changeScene')).success, false);
  scene = node;
});
(async () => {
  let failures = 0;
  for (const [name, run] of cases) { try { await run(); console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e.message); } }
  process.exitCode = failures ? 1 : 0;
})();
