'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function fixture() {
  class Scene { constructor() { this.name = 'Scene'; this.children = []; } }
  class Button {}
  const scene = new Scene();
  function node(id, groupIndex = 0) {
    const n = { uuid: id, name: id, parent: scene, children: [], groupIndex, width: 100, height: 100, anchorX: 0.5, anchorY: 0.5,
      _components: [new Button()], convertToNodeSpaceAR: p => ({ x: p.x - 50, y: p.y - 50 }) };
    scene.children.push(n); return n;
  }
  const cameras = [0, 10].map(depth => ({ depth, enabled: true, cullingMask: 1, node: { uuid: 'cam' + depth, name: 'cam' + depth }, getScreenToWorldPoint: p => p }));
  const eng = { Scene, Camera: { cameras }, director: { getScene: () => scene }, view: { getFrameSize: () => ({ width: 100, height: 100 }) },
    v2: (x, y) => ({ x, y }), rect: (x, y, width, height) => ({ contains: p => p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height }) };
  const window = { cc: eng, innerWidth: 100, innerHeight: 100 };
  const document = { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/probe/picker.js'), 'utf8'), { window, document, module, exports: module.exports,
    require: name => name === './engine-helper' ? { getCcEngine: () => eng } : { Logger: { log() {} } } });
  module.exports.initPicker();
  return { picker: window.__mcpNodePicker, scene, eng, node, cameras };
}
const f = fixture();
assert.strictEqual(typeof f.picker.getCandidates, 'function', 'overlap candidate query must exist');
const back = f.node('back'), front = f.node('front');
const result = JSON.parse(JSON.stringify(f.picker.getCandidates(50, 50)));
assert.deepStrictEqual(result.candidates.map(n => n.uuid), ['front', 'back']);
assert.strictEqual(result.geometryOnly, true);
assert.strictEqual(result.truncated, false);
assert.strictEqual(result.candidates[0].path, 'Scene/front');
assert.strictEqual(result.candidates[0].camera.uuid, 'cam10');
assert.deepStrictEqual(result.candidates[0].components, ['Button']);
assert.strictEqual(f.picker.hitTest(50, 50), front, 'existing input users still get the first raw node');
const bounded = f.picker.getCandidates(50, 50, 1);
assert.strictEqual(bounded.candidates.length, 1);
assert.strictEqual(bounded.truncated, true);
back.groupIndex = 1;
f.cameras[1].cullingMask = 2;
assert.deepStrictEqual(Array.from(f.picker.getCandidates(50, 50).candidates, n => n.uuid), ['back', 'front'], 'camera depth precedes sibling order');
back.groupIndex = 0;
f.cameras[1].cullingMask = 1;
front.active = false;
assert.strictEqual(f.picker.getCandidates(50, 50).candidates[0].uuid, 'back');
assert.strictEqual(f.picker.getCandidates(500, 50).candidates.length, 0, 'outside canvas produces no candidates');
for (const args of [[NaN, 0], [1, Infinity], [0, 0, 0], [0, 0, 65], [0, 0, 1.5]]) {
  assert.strictEqual(f.picker.getCandidates(...args).error, 'INVALID_ARGUMENTS');
}
f.scene.children = [];
for (let i = 0; i < 10010; i++) { const n = f.node('empty' + i); n._components = []; }
const budget = f.picker.getCandidates(50, 50);
assert.strictEqual(budget.truncated, true);
assert(budget.visitedNodes <= 10000);
console.log('PASS picker overlap order, camera deduplication, legacy hit, visibility and bounds');
