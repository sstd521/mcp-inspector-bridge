'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { EventEmitter } = require('events');
const { createRequire } = require('module');
async function run() {
  let server; const calls = [], waiting = [], module = { exports: {} };
  const filename = path.join(__dirname, '../dist/ipc-router.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: name => name === 'ws' ? { Server: class extends EventEmitter { constructor() { super(); server = this; } close() {} } } : createRequire(filename)(name),
    Editor: { Project: { path: '/project' }, Ipc: { sendToPanel(panel, channel, args, callback) {
      if (!callback) return; calls.push({ channel, args });
      if (channel === 'mcp-simulate-input') waiting.push(callback); else callback(null, { ok: true });
    } } }, setTimeout, clearTimeout,
  });
  const router = module.exports.startMcpRouter(() => {});
  const sockets = [new EventEmitter(), new EventEmitter()]; sockets.forEach(socket => { socket.send = () => {}; server.emit('connection', socket); });
  const pending = sockets.map(socket => socket.listeners('message')[0](JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'simulate_input', args: { inputType: 'click', x: 0, y: 0 } } })));
  const inputs = calls.filter(c => c.channel === 'mcp-simulate-input');
  assert.match(inputs[0].args.ownership.owner, /^[a-f0-9]{48}$/);
  assert.notStrictEqual(inputs[0].args.ownership.owner, inputs[1].args.ownership.owner);
  sockets[0].emit('close'); await Promise.resolve();
  const cancel = calls.filter(c => c.channel === 'mcp-cancel-input');
  assert.strictEqual(cancel.length, 1); assert.strictEqual(cancel[0].args.owner, inputs[0].args.ownership.owner);
  assert.strictEqual(cancel[0].args.requestId, inputs[0].args.ownership.requestId);
  waiting.forEach(callback => callback(null, { success: false, error: 'INPUT_CANCELED', status: 'partial', verified: false, retryable: false, framesDispatched: 1, totalFrames: 2 }));
  await Promise.all(pending); router.close();
  const before = calls.length;
  await sockets[1].listeners('message')[0](JSON.stringify({ id: 2, method: 'tools/call', params: { name: 'simulate_input', args: { x: 1, y: 1 } } }));
  assert.strictEqual(calls.length, before, 'disposed router cannot accept new input');
  console.log('input-router-ownership.test.js: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
