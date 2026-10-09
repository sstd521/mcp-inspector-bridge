const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../dist/panel/index.js'), 'utf8');
for (const state of ['detached', 'main', 'unknown', 'missing', 'no-panel', 'no-remote']) {
    const titles = [];
    const host = { nativeWin: { setTitle: title => titles.push(title) } };
    if (state === 'detached') host.isMainWindow = false;
    if (state === 'main') host.isMainWindow = true;
    const Editor = { Panel: { extend: panel => panel }, url: value => value };
    if (state !== 'no-remote') Editor.remote = {};
    if (state !== 'no-remote' && state !== 'no-panel') Editor.remote.Panel = {
        findWindow(id) {
            assert.strictEqual(id, 'mcp-inspector-bridge');
            return state === 'missing' ? null : host;
        }
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        Editor, module, exports: module.exports, __dirname: path.join(__dirname, '../dist/panel'),
        require: name => name === 'fs' ? { readFileSync: () => '' }
            : name === 'path' ? path
            : name === '../runtime-diagnostic-contract' ? { DIAGNOSTIC_TOOLS: [] } : {}
    });
    module.exports.ready.call({ id: 'mcp-inspector-bridge' });
    assert.deepStrictEqual(titles, state === 'detached' ? ['mcp-inspctor'] : [], state);
}
console.log('panel-title: detached/main/unknown/missing host checks passed');
