const assert = require('assert');
const Module = require('module');
const vm = require('vm');

const listeners = {};
const listenerAdds = {};
const debuggerListeners = {};
let debuggerAttached = 0;
let debuggerDetached = 0;
const executedScripts = [];
let injectionPollEntries = null;
let gameUrl = 'http://127.0.0.1:7456';
let webContents;
const editorLogs = [];
let onceError = null;
const removedListeners = [];
let fakeWebSocketEnabled = false;
let fakeServer;
class FakeWebSocketServer {
  constructor() { this.handlers = {}; fakeServer = this; }
  on(name, callback) { this.handlers[name] = callback; }
  close() {}
}
const game = {
  id: 7,
  type: 'browserview',
  getURL: () => gameUrl,
  getType() { return this.type; },
  isDestroyed: () => false,
  on(name, callback) {
    listenerAdds[name] = (listenerAdds[name] || 0) + 1;
    listeners[name] = callback;
  },
  once(name, callback) {
    if (onceError) throw onceError;
    listeners[name] = callback;
  },
  removeListener(name, callback) {
    removedListeners.push([name, callback]);
    if (listeners[name] === callback) delete listeners[name];
  },
  executeJavaScript: async code => {
    executedScripts.push(code);
    if (code.includes('window.__mcpLogBuffer.slice')) {
      const entries = injectionPollEntries || [];
      injectionPollEntries = [];
      return entries;
    }
    return [];
  },
  debugger: {
    attach() { debuggerAttached++; },
    detach() { debuggerDetached++; },
    on(name, callback) { debuggerListeners[name] = callback; },
    removeListener(name, callback) {
      removedListeners.push([`debugger:${name}`, callback]);
      if (debuggerListeners[name] === callback) delete debuggerListeners[name];
    },
    sendCommand: async () => ({}),
  },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return { webContents: { getAllWebContents: () => webContents } };
  if (request === 'ws' && fakeWebSocketEnabled) return { Server: FakeWebSocketServer };
  return originalLoad.call(this, request, parent, isMain);
};
global.Editor = {
  log(...args) { editorLogs.push(args.join(' ')); },
  error(...args) { editorLogs.push(args.join(' ')); },
  Project: { path: '' },
  Ipc: { sendToPanel() {} },
};
webContents = [game];

const logs = require('../dist/cdp-log-listener.js');
const main = require('../dist/main.js');

function emit(level, message, line = 1, url = 'https://preview.example/?token=very-secret-token') {
  listeners['console-message']({}, level, message, line, url);
}

async function query(args) {
  return new Promise(resolve => {
    main.messages['query-cdp-logs']({ reply: (_error, reply) => resolve(reply) }, args);
  });
}

(async () => {
  assert.strictEqual(await logs.initCdpLogListener(true), true);
  const nativeListenerAdds = listenerAdds['console-message'];
  assert.strictEqual(await logs.initCdpLogListener(true), true);
  assert.strictEqual(listenerAdds['console-message'], nativeListenerAdds);
  emit(1, 'Authorization: Bearer top-secret Cookie: sid=private password=hunter2');
  emit(2, 'error token=another-secret');
  emit(0, 'ordinary log');

  const first = await logs.getCdpLogs({ tail: 30, level: 'warn', sinceCursor: 0 });
  assert.deepStrictEqual(Object.keys(first).sort(), ['dropped', 'items', 'nextCursor', 'total', 'truncated']);
  assert.strictEqual(first.items.length, 2);
  assert(first.items.every(item => Number.isSafeInteger(item.cursor) && item.cursor > 0));
  assert(first.items[0].cursor < first.items[1].cursor);
  assert(!JSON.stringify(first.items).includes('top-secret'));
  assert(!JSON.stringify(first.items).includes('private'));
  assert(!JSON.stringify(first.items).includes('hunter2'));
  assert(!JSON.stringify(first.items).includes('another-secret'));
  assert(first.items.every(item => item.message.length <= 300 && (!item.url || item.url.length <= 300)));

  const credentialCases = [
    ['refresh_token=refresh-token-secret', 'refresh-token-secret'],
    ['client_secret=client-secret-value', 'client-secret-value'],
    ['x-api-key: api-key-secret', 'api-key-secret'],
    ['Cookie: session=cookie-value-secret', 'cookie-value-secret'],
    ['password=password-value-secret', 'password-value-secret'],
    ['password native-password-space-secret ordinary-tail', 'native-password-space-secret'],
    ['cookie sid=native-cookie-space-secret', 'native-cookie-space-secret'],
    ['fragment value', 'fragment-token-secret', 'https://preview.example/#token=fragment-token-secret'],
  ];
  for (const [message, _secret, url] of credentialCases) emit(0, message, 1, url);
  const credentials = await logs.getCdpLogs({ tail: 30, level: 'all', sinceCursor: first.nextCursor });
  for (const [_message, secret] of credentialCases) assert(!JSON.stringify(credentials.items).includes(secret));
  assert(credentials.items.some(item => item.message.includes('ordinary-tail')));
  const filtered = await logs.getCdpLogs({ tail: 1, level: 'error', sinceCursor: first.nextCursor });
  assert.strictEqual(filtered.items.length, 0);
  assert(filtered.nextCursor > first.nextCursor);

  emit(1, 'later warning');
  const incremental = await logs.getCdpLogs({ tail: 1, level: 'warn', sinceCursor: first.nextCursor });
  assert.deepStrictEqual(incremental.items.map(item => item.message), ['later warning']);
  assert(incremental.nextCursor > first.nextCursor);

  for (let i = 0; i < 505; i++) emit(1, `warning ${i}`);
  const bounded = await logs.getCdpLogs({ tail: 1000, level: 'all', sinceCursor: 0 });
  assert.strictEqual(bounded.total, 500);
  assert.strictEqual(bounded.items.length, 100);
  assert.strictEqual(bounded.dropped, 17);
  assert.strictEqual(bounded.truncated, true);

  const zeroTail = await logs.getCdpLogs({ tail: 0, level: 'all', sinceCursor: 0 });
  assert.strictEqual(zeroTail.items.length, 30);
  assert.strictEqual(zeroTail.truncated, true);

  const reset = await logs.getCdpLogs({ tail: 1, level: 'warn', sinceCursor: bounded.nextCursor + 1 });
  assert.strictEqual(reset.dropped, 0);
  assert.strictEqual(reset.truncated, true);
  assert.strictEqual(reset.nextCursor, bounded.nextCursor);
  assert.strictEqual(reset.items.length, 1);

  logs.detachCdpListener();
  assert(removedListeners.some(([name]) => name === 'console-message'));
  const cleared = await logs.getCdpLogs({ tail: 1, level: 'all', sinceCursor: 3 });
  assert.strictEqual(cleared.items.length, 0);
  assert.strictEqual(cleared.nextCursor, bounded.nextCursor);
  assert.strictEqual(cleared.dropped, 514);
  assert.strictEqual(cleared.truncated, true);
  for (const invalidArgs of [
    { tail: 1, level: 'warn', sinceCursor: 0, unexpected: 'raw-secret-value' },
    ['raw-secret-value'],
    { tail: '1', level: 'warn', sinceCursor: 0 },
  ]) {
    const invalid = await query(invalidArgs);
    assert.deepStrictEqual(Object.keys(invalid).sort(), ['error', 'ok', 'status']);
    assert.strictEqual(invalid.ok, false);
    assert.deepStrictEqual(invalid.error, {
      code: 'INVALID_RUNTIME_LOG_QUERY',
      message: 'Invalid runtime log query.',
    });
    assert.strictEqual(invalid.status.attached, false);
    assert(!JSON.stringify(invalid).includes('raw-secret-value'));
  }

  assert.strictEqual(await logs.initCdpLogListener(true), true);
  const reply = await query({ tail: 1, level: 'error', sinceCursor: first.nextCursor });
  assert.deepStrictEqual(Object.keys(reply).sort(), ['logs', 'ok', 'status']);
  assert.strictEqual(reply.ok, true);
  assert.deepStrictEqual(Object.keys(reply.logs).sort(), ['dropped', 'items', 'nextCursor', 'total', 'truncated']);
  assert.deepStrictEqual(Object.keys(reply.status).sort(), ['attached', 'cdp', 'eventCount', 'injection', 'method', 'size']);

  logs.detachCdpListener();
  game.type = 'webview';
  assert.strictEqual(await logs.initCdpLogListener(true), true);
  debuggerListeners.message({}, 'Runtime.consoleAPICalled', {
    type: 'warning',
    args: [{ type: 'string', value: 'password' }, { type: 'string', value: 'cdp-password-space-secret' }],
  });
  debuggerListeners.message({}, 'Runtime.consoleAPICalled', {
    type: 'warning',
    args: [{ type: 'string', value: 'cookie' }, { type: 'string', value: 'sid=cdp-cookie-space-secret' }],
  });
  const cdpJoined = await logs.getCdpLogs({ tail: 10, level: 'warn', sinceCursor: 0 });
  assert(!JSON.stringify(cdpJoined.items).includes('cdp-password-space-secret'));
  assert(!JSON.stringify(cdpJoined.items).includes('cdp-cookie-space-secret'));
  main.unload();
  assert.strictEqual(debuggerDetached, 1);
  assert(removedListeners.some(([name]) => name === 'debugger:message'));
  assert(removedListeners.some(([name]) => name === 'debugger:detach'));

  game.debugger.sendCommand = async () => { throw new Error('Runtime.enable failed'); };
  assert.strictEqual(await logs.initCdpLogListener(true), true);
  assert.strictEqual(debuggerDetached, debuggerAttached);
  injectionPollEntries = [{ t: 'warn', ts: Date.now(), m: 'injected status log' }];
  const injectionReply = await query({ tail: 1, level: 'warn', sinceCursor: 0 });
  assert.strictEqual(injectionReply.logs.items.length, 1);
  assert.strictEqual(injectionReply.status.size, 1);
  assert.strictEqual(injectionReply.status.eventCount, injectionReply.logs.nextCursor);
  const injection = executedScripts.find(script => script.includes('window.__mcpLogInjected'));
  assert(injection);
  const pageWindow = {};
  const pageConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  function PageError() {
    this.stack = `Error\n    at game (https://preview.example/?refresh_token=injection-refresh-secret#token=injection-hash-secret&${'x'.repeat(400)}:1:1)`;
  }
  vm.runInNewContext(injection, {
    window: pageWindow,
    console: pageConsole,
    Error: PageError,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout() {},
  });
  const injectionCredentialCases = [
    ['Authorization: Bearer injection-message-secret', 'injection-message-secret'],
    ['refresh_token=injection-refresh-value', 'injection-refresh-value'],
    ['client_secret=injection-client-value', 'injection-client-value'],
    ['x-api-key: injection-api-key-value', 'injection-api-key-value'],
    ['Cookie: session=injection-cookie-value', 'injection-cookie-value'],
    ['password=injection-password', 'injection-password'],
  ];
  for (const [message] of injectionCredentialCases) pageConsole.warn(`${message} ${'m'.repeat(400)}`);
  pageConsole.warn('password', 'injection-password-space-secret', 'injection-ordinary-tail');
  pageConsole.log('cookie', 'sid=injection-cookie-space-secret');
  const injected = pageWindow.__mcpLogBuffer;
  for (const [_message, secret] of injectionCredentialCases) assert(!JSON.stringify(injected).includes(secret));
  assert(!JSON.stringify(injected).includes('injection-password-space-secret'));
  assert(!JSON.stringify(injected).includes('injection-cookie-space-secret'));
  assert(injected.some(entry => entry.m.includes('injection-ordinary-tail')));
  assert(!JSON.stringify(injected).includes('injection-refresh-secret'));
  assert(!JSON.stringify(injected).includes('injection-hash-secret'));
  assert(injected.every(entry => entry.m.length <= 300 && (!entry.u || entry.u.length <= 300)));
  logs.detachCdpListener();

  game.debugger.sendCommand = async () => ({});
  onceError = new Error('destroyed listener registration failed');
  const attachedBeforeOuterFailure = debuggerAttached;
  const detachedBeforeOuterFailure = debuggerDetached;
  assert.strictEqual(await logs.initCdpLogListener(true), false);
  assert.strictEqual(debuggerAttached - attachedBeforeOuterFailure, 1);
  assert.strictEqual(debuggerDetached - detachedBeforeOuterFailure, 1);
  onceError = null;

  gameUrl = 'http://127.0.0.1:7456/?token=creator-query-secret#creator-fragment-secret';
  webContents = [game, {
    id: 8,
    getURL: () => 'http://creator-user-secret@localhost:7456/',
    getType: () => 'browserview',
    isDestroyed: () => false,
  }];
  editorLogs.length = 0;
  assert.strictEqual(await logs.initCdpLogListener(false), true);
  const diagnostics = editorLogs.join('\n');
  assert(!diagnostics.includes('creator-query-secret'));
  assert(!diagnostics.includes('creator-fragment-secret'));
  assert(!diagnostics.includes('creator-user-secret'));
  logs.detachCdpListener();
  gameUrl = 'http://127.0.0.1:7456';
  webContents = [game];

  fakeWebSocketEnabled = true;
  delete require.cache[require.resolve('../dist/ipc-router.js')];
  const { startMcpRouter } = require('../dist/ipc-router.js');
  const runtimeLogs = [{ type: 'warn', message: 'legacy runtime log' }];
  let mainCall;
  global.Editor.Ipc.sendToMain = (channel, args, callback) => {
    mainCall = { channel, args };
    callback(null, { ok: true, status: {}, logs: { items: runtimeLogs } });
  };
  const router = startMcpRouter(() => {});
  let sent;
  const ws = {
    on(name, callback) { this[name] = callback; },
    send(message) { sent = JSON.parse(message); },
  };
  fakeServer.handlers.connection(ws);
  async function requestLegacyLogs(args, expectedArgs) {
    mainCall = undefined;
    const params = { name: 'get_runtime_logs' };
    if (args !== undefined) params.args = args;
    ws.message(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 'legacy-logs',
      method: 'tools/call',
      params,
    })));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(mainCall, {
      channel: 'mcp-inspector-bridge:query-cdp-logs',
      args: expectedArgs,
    });
    assert.deepStrictEqual(JSON.parse(sent.result.content[0].text), runtimeLogs);
  }
  await requestLegacyLogs(undefined, { tail: 50, level: 'all' });
  await requestLegacyLogs({}, { tail: 50, level: 'all' });
  await requestLegacyLogs({ tail: 10 }, { tail: 10, level: 'all' });
  await requestLegacyLogs({ level: 'error' }, { tail: 50, level: 'error' });
  await requestLegacyLogs({ sinceCursor: 7 }, { tail: 50, level: 'all', sinceCursor: 7 });
  router.close();
  console.log('runtime-diagnostics.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
