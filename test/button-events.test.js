const assert = require('assert');
const { compile } = require('vue');

class Scene {}
class Button {}

let handlerCalls = 0;
let nodeClickCalls = 0;
let componentMethodCalls = 0;
const handlerComponent = {
  onTap(_button, data) {
    handlerCalls++;
    assert.strictEqual(data, 'payload');
  },
};
const target = {
  name: 'Target',
  uuid: 'target-uuid',
  getComponent() { return handlerComponent; },
};
const clickEvent = {
  target,
  component: 'TestHandler',
  _componentId: 'compressed-script-id',
  handler: 'onTap',
  customEventData: 'payload',
};
const button = Object.assign(new Button(), {
  name: 'cc.Button',
  enabled: true,
  enabledInHierarchy: true,
  interactable: true,
  clickEvents: [clickEvent, clickEvent],
  node: {
    activeInHierarchy: true,
    emit(type) { if (type === 'click') nodeClickCalls++; },
  },
  _emitClickEvents() { handlerCalls += this.clickEvents.length; },
});
class RuntimeComponent {
  constructor() {
    this.name = 'RuntimeComponent';
    this.enabled = true;
  }
  refresh() { componentMethodCalls++; }
  onLoad() {}
  _privateMethod() {}
  getDebugInfo() {}
  withArg(_value) {}
}
const runtimeComponent = new RuntimeComponent();
const node = {
  uuid: 'button-node',
  id: 'button-node',
  name: 'ButtonNode',
  active: true,
  isValid: true,
  children: [],
  childrenCount: 0,
  _components: [button, runtimeComponent],
  getComponent(Type) { return Type === Button ? button : null; },
};
const scene = Object.assign(new Scene(), {
  uuid: 'scene',
  children: [node],
  childrenCount: 1,
});

global.window = {
  cc: {
    Scene,
    Button,
    Component: {
      EventHandler: {
        emitEvents(events, sender) {
          for (const event of events) {
            event.target.getComponent(event.component)[event.handler](sender, event.customEventData);
          }
        },
      },
    },
    director: { getScene: () => scene },
    game: { groupList: [] },
    js: {
      _getClassById: () => function TestHandler() {},
      _getClassId: () => 'cc.Button',
      getClassName: () => 'TestHandler',
    },
  },
};

const { initCrawler } = require('../dist/probe/crawler.js');
initCrawler();
const crawler = window.__mcpCrawler;
const detail = crawler.getNodeDetail('button-node');

assert.strictEqual(detail.components[0].buttonClickEvents.length, 2);
assert.deepStrictEqual(detail.components[0].buttonClickEvents[0], {
  index: 0,
  targetName: 'Target',
  targetUuid: 'target-uuid',
  componentName: 'TestHandler',
  componentId: 'compressed-script-id',
  scriptComponentName: 'TestHandler',
  handlerName: 'onTap',
  customEventData: 'payload',
  hasHandler: true,
});
assert.strictEqual(crawler.prepareButtonClickHandlerInspect('button-node', 0, 1), true);
assert.strictEqual(window.__mcpButtonClickHandler, handlerComponent.onTap);
assert.strictEqual(crawler.triggerButtonClickHandler('button-node', 0, 1), true);
assert.strictEqual(handlerCalls, 1);
assert.strictEqual(crawler.simulateButtonClick('button-node', 0), true);
assert.strictEqual(handlerCalls, 3);
assert.strictEqual(nodeClickCalls, 1);
assert.deepStrictEqual(detail.components[1].methods, ['refresh']);
assert.strictEqual(crawler.executeComponentMethod('button-node', 1, 'refresh'), true);
assert.strictEqual(componentMethodCalls, 1);
assert.strictEqual(crawler.executeComponentMethod('button-node', 1, '_privateMethod'), false);
assert.strictEqual(crawler.executeComponentMethod('button-node', 1, 'withArg'), false);
assert.strictEqual(crawler.printComponentData('button-node', 1), true);
assert.strictEqual(window.$mcpComp, runtimeComponent);
assert.strictEqual(crawler.printNodeData('button-node'), true);
assert.strictEqual(window.$mcpNode, node);

const pickerMessages = [];
const pickerElements = {};
global.document = {
  documentElement: {
    addEventListener() {},
    removeEventListener() {},
  },
  body: {
    appendChild(element) { element.parentNode = this; pickerElements[element.id] = element; },
    removeChild(element) { delete pickerElements[element.id]; element.parentNode = null; },
  },
  createElement() { return { id: '', style: {}, parentNode: null }; },
  getElementById(id) { return pickerElements[id] || null; },
};
window.__mcpInspector = {
  sendNodeSelected(...args) { pickerMessages.push(args); },
};
const { initPicker } = require('../dist/probe/picker.js');
initPicker();
const picker = window.__mcpNodePicker;
picker.hitTest = () => ({ uuid: 'picked-node', id: 'picked-node', name: 'PickedNode' });
const pickerEvent = { type: 'mouseup', clientX: 10, clientY: 20, stopPropagation() {}, preventDefault() {}, stopImmediatePropagation() {} };
picker.setContinuous(true);
picker.enable();
picker._onClick(pickerEvent);
assert.strictEqual(picker.isActive, true);
assert.deepStrictEqual(pickerMessages.pop(), ['picked-node']);
picker._onClick({ ...pickerEvent, type: 'click' });
assert.strictEqual(pickerMessages.length, 0);
picker.setContinuous(false);
picker._onClick(pickerEvent);
assert.strictEqual(picker.isActive, false);
picker.setContinuous(true);
picker.enable();
picker._onKeyDown({ key: 'Escape' });
assert.strictEqual(picker.isActive, false);
assert.deepStrictEqual(pickerMessages.pop(), ['', true]);

const { NodeInspector } = require('../dist/panel/components/NodeInspector.js');
const { NodeTree } = require('../dist/panel/components/NodeTree.js');
assert.doesNotThrow(() => compile(NodeInspector.template));
assert.doesNotThrow(() => compile(NodeTree.template));

const ipcCalls = [];
const selectionCalls = [];
global.Editor = {
  Utils: { UuidUtils: { decompressUuid: value => `expanded:${value}` } },
  Ipc: {
    sendToAll: (...args) => ipcCalls.push(['all', ...args]),
    sendToMain: (...args) => ipcCalls.push(['main', ...args]),
  },
  Selection: { select: (...args) => selectionCalls.push(args) },
};
const {
  locateEditorAsset,
  normalizeEditorUuid,
  openEditorAsset,
  openEditorScript,
  openEditorUuidLookup,
  toSerializableNodeDetail,
} = require('../dist/panel/composables/useNodeSystem.js');

const reactivePath = new Proxy([2, '3'], {});
const ipcDetail = toSerializableNodeDetail({
  id: 'runtime-node',
  prefabUuid: 'prefab-uuid',
  prefabChildIndexPath: reactivePath,
});
assert.deepStrictEqual(ipcDetail, {
  id: 'runtime-node',
  prefabUuid: 'prefab-uuid',
  prefabChildIndexPath: [2, 3],
});
assert.notStrictEqual(ipcDetail.prefabChildIndexPath, reactivePath);
if (typeof structuredClone === 'function') assert.doesNotThrow(() => structuredClone(ipcDetail));

const compressedUuid = '1234567890123456789012';
assert.strictEqual(normalizeEditorUuid(compressedUuid), `expanded:${compressedUuid}`);
assert.strictEqual(locateEditorAsset('full-asset-uuid'), true);
assert.deepStrictEqual(ipcCalls.slice(-2), [
  ['all', 'assets:clearSearch'],
  ['all', 'assets:hint', 'full-asset-uuid'],
]);
assert.deepStrictEqual(selectionCalls.pop(), ['asset', 'full-asset-uuid']);
assert.strictEqual(openEditorScript('full-script-uuid'), true);
assert.deepStrictEqual(ipcCalls.pop(), ['main', 'assets:open-text-file', 'full-script-uuid']);
assert.strictEqual(openEditorAsset('full-prefab-uuid'), true);
assert.deepStrictEqual(ipcCalls.pop(), ['main', 'mcp-inspector-bridge:open-asset-with-uuid-lookup', 'full-prefab-uuid']);
const originalSetTimeout = global.setTimeout;
global.setTimeout = callback => { callback(); return 0; };
try {
  assert.strictEqual(openEditorUuidLookup('full-prefab-uuid'), true);
} finally {
  global.setTimeout = originalSetTimeout;
}
assert.deepStrictEqual(ipcCalls.slice(-2), [
  ['main', 'uuid_lookup:open-panel'],
  ['all', 'uuid-lookup:query', 'full-prefab-uuid'],
]);

const { UUID_LOOKUP_TOOL_MAP } = require('../dist/ipc-router.js');
assert.strictEqual(UUID_LOOKUP_TOOL_MAP.search_editor_assets.channel, 'uuid_lookup:query-resource');
assert.strictEqual(UUID_LOOKUP_TOOL_MAP.get_asset_references.timeout, 30000);
assert.strictEqual(UUID_LOOKUP_TOOL_MAP.scan_missing_asset_references.timeout, 60000);
assert.strictEqual(UUID_LOOKUP_TOOL_MAP.open_asset_by_uuid.channel, 'uuid_lookup:open-asset-by-main');

console.log('button-events.test.js: ok');
