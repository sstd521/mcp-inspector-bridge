const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const source = path.join(__dirname, '../src/probe/resource-inventory.ts');
const code = fs.existsSync(source) ? ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS }
}).outputText : '';
class Cache {
  constructor(entries = []) { this._map = Object.create(null); entries.forEach(([k, v]) => { this._map[k] = v; }); }
  has(k) { return Object.prototype.hasOwnProperty.call(this._map, k); }
  get(k) { return this._map[k]; }
  forEach(fn) { for (const k in this._map) fn(this._map[k], k); }
}
function boot(manager) {
  let scene = { uuid: 'scene-a', name: 'Validation' };
  const engine = { ENGINE_VERSION: '2.4.7', director: { getScene: () => scene, getTotalFrames: () => 42 },
    js: { getClassName: value => value && (value.__classname__ || value.className) || '' }, assetManager: manager };
  const window = { cc: engine, location: { href: 'http://localhost:7456/game/index.html?token=SECRET' },
    __mcpCrawler: { getInputContext: () => ({ id: 'preview-context', sceneUuid: scene && scene.uuid }) } };
  const exports = {};
  vm.runInNewContext(code, { window, document: { baseURI: window.location.href }, URL, exports,
    require: name => { assert.strictEqual(name, './engine-helper'); return { getCcEngine: () => window.cc }; } });
  if (exports.initResourceInventory) exports.initResourceInventory();
  assert(window.__mcpResourceInventory, 'initResourceInventory must install the readonly resource hook');
  return { hook: window.__mcpResourceInventory, engine, window, setScene: value => { scene = value; } };
}
const ctor = { className: 'cc.Texture2D' };
const shared = { __classname__: 'cc.Texture2D', name: 'Shared', loaded: true, refCount: 3, width: 16, height: 8,
  url: 'https://alice:SECRET@cdn.example.com/path/texture.png?token=SECRET#private' };
const broken = { __classname__: 'cc.SpriteFrame', loaded: false, refCount: 0 };
Object.defineProperty(broken, 'name', { get() { throw new Error('SECRET getter'); } });
Object.defineProperty(broken, '_texture', { get() { throw new Error('do not inspect texture'); } });
const deps = new Cache([['a-shared', { deps: ['z-cache', 'u-packed', 'z-cache'] }], ['z-cache', { deps: ['a-shared'] }],
  ['b-broken', { deps: [] }]]);
const manager = { bundles: new Cache([
  ['beta', { name: 'beta', _config: { assetInfos: new Cache([['a-shared', { uuid: 'a-shared', path: 'shared', ctor }]]) } }],
  ['alpha', { name: 'alpha', _config: { assetInfos: new Cache([
    ['u-packed', { uuid: 'u-packed', path: 'unloaded', ctor, packs: [{ uuid: 'pack' }] }],
    ['pack', { uuid: 'pack', packs: ['u-packed'], ext: '.json' }],
    ['a-shared', { uuid: 'a-shared', path: 'shared', ctor }]]) } }]]),
  assets: new Cache([['z-cache', { __classname__: 'cc.Material', name: 'CacheOnly', url: '../res/a.bin?key=SECRET#frag' }],
    ['b-broken', broken], ['a-shared', shared]]),
  dependUtil: { _depends: deps, getDeps(uuid) { return this._depends.has(uuid) ? this._depends.get(uuid).deps : []; } },
  loadAny() { throw new Error('must never load'); }, releaseAsset() { throw new Error('must never release'); } };
const { hook, engine, window, setScene } = boot(manager);
let result = hook.inventory({});
assert.strictEqual(result.success, true);
assert.deepStrictEqual(Array.from(result.assets, a => a.uuid), ['a-shared', 'b-broken', 'pack', 'u-packed', 'z-cache']);
assert.strictEqual(result.total, 5); assert.strictEqual(result.totalExact, true);
assert.strictEqual(result.truncated, false); assert.strictEqual(result.nextOffset, null);
assert.strictEqual(result.pagination, 'live');
assert.strictEqual(result.context.id, 'preview-context');
assert.strictEqual(result.context.sceneUuid, 'scene-a'); assert.strictEqual(result.context.sceneName, 'Validation');
assert.strictEqual(result.context.engineVersion, '2.4.7'); assert.strictEqual(result.context.frame, 42);
assert.strictEqual(typeof result.context.capturedAt, 'number');
const byId = uuid => result.assets.find(a => a.uuid === uuid);
assert.deepStrictEqual(Array.from(byId('a-shared').bundles, b => b.bundle), ['alpha', 'beta']);
assert.strictEqual(byId('a-shared').url, 'https://cdn.example.com/path/texture.png');
assert.strictEqual(byId('z-cache').url, 'http://localhost:7456/res/a.bin');
assert.strictEqual(byId('u-packed').cached, false); assert.strictEqual(byId('u-packed').loaded, null);
assert.strictEqual(byId('u-packed').bundles[0].packed, true); assert.strictEqual(byId('pack').bundles[0].package, true);
assert.strictEqual(byId('z-cache').loaded, null); assert.strictEqual(byId('z-cache').refCount, null);
assert.strictEqual(byId('b-broken').loaded, false); assert.strictEqual(byId('b-broken').refCount, 0);
assert(byId('b-broken').errors.includes('name')); assert.strictEqual(byId('b-broken').name, null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(byId('a-shared').dimensions)), { width: 16, height: 8 });
assert(!JSON.stringify(result).includes('SECRET')); assert(!JSON.stringify(result).includes('memoryBytes'));
result = hook.inventory({ bundle: 'alpha', type: 'cc.Texture2D', cached: true, limit: 1 });
assert.strictEqual(result.total, 1); assert.strictEqual(result.assets[0].bundles.length, 2);
result = hook.inventory({ limit: 2 });
assert.strictEqual(result.nextOffset, 2); assert.strictEqual(result.truncated, true);
assert.deepStrictEqual(Array.from(hook.inventory({ offset: 2, limit: 2 }).assets, a => a.uuid), ['pack', 'u-packed']);
manager.assets._map['0-added'] = { name: 'Fresh' };
assert.strictEqual(hook.inventory({ limit: 1 }).assets[0].uuid, '0-added'); delete manager.assets._map['0-added'];
for (const args of [null, [], { limit: 0 }, { limit: 51 }, { offset: -1 }, { offset: 20001 }, { cached: 0 }, { bundle: '' },
  { type: 'a'.repeat(129) }, { unknown: true }]) assert.strictEqual(hook.inventory(args).error, 'INVALID_RESOURCE_QUERY');
for (const args of [{}, { uuid: '' }, { uuid: 'a', extra: true }, { uuid: 3 }]) assert.strictEqual(hook.detail(args).error, 'INVALID_RESOURCE_QUERY');
assert.strictEqual(hook.inventory({ bundle: 'missing' }).error, 'BUNDLE_NOT_FOUND');
const detail = hook.detail({ uuid: 'a-shared' });
assert.strictEqual(detail.found, true); assert.strictEqual(detail.asset.bundles.length, 2);
assert.strictEqual(detail.dependencies.available, true);
assert.deepStrictEqual(Array.from(detail.dependencies.uuids), ['u-packed', 'z-cache']);
assert.deepStrictEqual(Array.from(detail.reverseDependencies.uuids), ['z-cache']);
assert.strictEqual(detail.reverseDependencies.scope, 'cached-assets');
assert.strictEqual(detail.reverseDependencies.complete, true);
assert.strictEqual(hook.detail({ uuid: 'u-packed' }).dependencies.available, false);
assert.strictEqual(hook.detail({ uuid: 'u-packed' }).dependencies.reason, 'DEPENDENCY_RECORD_MISSING');
assert.strictEqual(hook.detail({ uuid: 'missing' }).found, false);
manager.assets._map['unknown-deps'] = {};
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).reverseDependencies.complete, false);
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).reverseDependencies.recordsMissing, 1);
delete manager.assets._map['unknown-deps'];
deps._map['a-shared'].deps = Array.from({ length: 60 }, (_, n) => `d${String(n).padStart(2, '0')}`);
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).dependencies.uuids.length, 50);
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).dependencies.truncated, true);
delete manager.dependUtil;
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).dependencies.available, false);
assert.strictEqual(hook.detail({ uuid: 'a-shared' }).reverseDependencies.available, false);
Object.defineProperty(manager.assets._map, 'bad-entry', { enumerable: true, configurable: true, get() { throw new Error('SECRET'); } });
assert.strictEqual(hook.inventory({}).success, true);
assert(hook.inventory({}).assets.find(a => a.uuid === 'bad-entry').errors.length > 0);
delete manager.assets._map['bad-entry'];
setScene(null); assert.strictEqual(hook.inventory({}).error, 'SCENE_UNAVAILABLE');
setScene({ uuid: 'scene-b', name: 'Next' }); assert.strictEqual(hook.inventory({}).context.sceneUuid, 'scene-b');
engine.assetManager = null; assert.strictEqual(hook.inventory({}).error, 'RESOURCE_API_UNAVAILABLE');
window.cc = null; assert.strictEqual(hook.inventory({}).error, 'ENGINE_UNAVAILABLE');
const large = boot({ bundles: new Cache(), assets: new Cache(Array.from({ length: 20002 }, (_, i) => [`x${String(i).padStart(5, '0')}`, {}])) }).hook;
result = large.inventory({ limit: 50 });
assert.strictEqual(result.assets.length, 50); assert.strictEqual(result.scanTruncated, true); assert.strictEqual(result.totalExact, false);
result = large.inventory({ type: 'nonexistent' });
assert.strictEqual(result.total, 0); assert.strictEqual(result.totalExact, false); assert.strictEqual(result.nextOffset, null);
const manyBundles = boot({ bundles: new Cache(Array.from({ length: 60 }, (_, i) => [`b${i}`, { name: `b${i}`,
  _config: { assetInfos: new Cache([['common', { uuid: 'common' }]]) } }])), assets: new Cache() }).hook;
result = manyBundles.inventory({});
assert.strictEqual(result.bundles.length, 50); assert.strictEqual(result.bundlesTruncated, true);
assert.strictEqual(result.assets[0].bundles.length, 50); assert.strictEqual(result.assets[0].membershipsTruncated, true);
assert.strictEqual(manyBundles.inventory({ bundle: 'b59' }).total, 1, 'filter must use all memberships, not just displayed ones');
let metadataReads = 0;
const boundedMetadata = boot({ bundles: new Cache(), assets: new Cache(Array.from({ length: 100 }, (_, i) => [String(i), {
  get loaded() { metadataReads++; return true; }
}])) }).hook;
boundedMetadata.inventory({ limit: 1 });
assert.strictEqual(metadataReads, 1, 'read expensive asset metadata only for the requested page');
const badDependencies = boot({ bundles: new Cache(), assets: new Cache([['known', {}]]), dependUtil: {
  _depends: new Cache([['known', { deps: ['ok', null, ''] }]]), getDeps() { return this._depends.get('known').deps; }
} }).hook.detail({ uuid: 'known' });
assert.strictEqual(badDependencies.dependencies.totalExact, false, 'malformed edges cannot claim complete dependency evidence');
assert.strictEqual(badDependencies.reverseDependencies.complete, false);
for (const url of ['data:text/plain,SECRET', 'blob:https://example.com/SECRET', 'javascript:SECRET']) {
  const unsafe = boot({ bundles: new Cache(), assets: new Cache([['opaque', { url }]]) }).hook.inventory({});
  assert.strictEqual(unsafe.assets[0].url, null); assert(!JSON.stringify(unsafe).includes('SECRET'));
}
assert.strictEqual(large.detail({ uuid: 'x20001' }).found, true, 'detail must look up a target beyond the inventory scan budget');
const noCollections = boot({ bundles: {}, assets: new Cache() }).hook.inventory({});
assert.strictEqual(noCollections.error, 'RESOURCE_API_UNAVAILABLE');
let dependencyReads = 0;
const throwingEdges = Array.from({ length: 20000 }, (_, i) => `edge${i}`);
for (let i = 0; i < throwingEdges.length; i++) Object.defineProperty(throwingEdges, i, { get() {
  dependencyReads++; if (i === 19999) throw new Error('getter failed'); return `edge${i}`;
} });
const throwingDependUtil = { _depends: new Cache(Array.from({ length: 4 }, (_, i) => [`a${i}`, {}])), getDeps: () => throwingEdges };
const throwingDetail = boot({ bundles: new Cache(), assets: new Cache(Array.from({ length: 4 }, (_, i) => [`a${i}`, {}])),
  dependUtil: throwingDependUtil }).hook.detail({ uuid: 'a0' });
assert.strictEqual(throwingDetail.dependencies.available, false);
assert(dependencyReads <= 20000, 'failed dependency reads must consume the scan budget');
console.log('resource-inventory: readonly union, memberships, pagination, dependency provenance, redaction and bounds passed');
// Native loadRemote keys are URLs; identifiers must not bypass URL redaction.
const remoteKey='https://alice:SECRET@cdn.example.com/a.png?signature=SECRET#private';
const unsafeDeps=new Cache([['known',{deps:[remoteKey]}],[remoteKey,{deps:['known']}]]);
const unsafe=boot({bundles:new Cache(),assets:new Cache([['known',{}],[remoteKey,{}]]),dependUtil:{_depends:unsafeDeps,getDeps(id){return this._depends.get(id).deps;}}}).hook;
const unsafeInventory=unsafe.inventory({});
assert(!JSON.stringify(unsafeInventory).includes('SECRET'));
assert.strictEqual(unsafeInventory.skippedIdentifiers,1);assert.strictEqual(unsafeInventory.totalExact,false);
const unsafeDetail=unsafe.detail({uuid:'known'});
assert(!JSON.stringify(unsafeDetail).includes('SECRET'));assert.strictEqual(unsafeDetail.reverseDependencies.complete,false);
assert.strictEqual(unsafeDetail.dependencies.totalExact,false);
assert.strictEqual(unsafe.detail({uuid:remoteKey}).error,'INVALID_RESOURCE_QUERY');
const failedLookup=boot({bundles:new Cache(),assets:{forEach(){throw Error('unavailable');},get(){throw Error('unavailable');}}}).hook;
assert.strictEqual(failedLookup.detail({uuid:'absent'}).error,'RESOURCE_QUERY_FAILED');
const unknownType={};Object.defineProperty(unknownType,'__classname__',{get(){throw Error('unavailable');}});
const unknownResult=boot({bundles:new Cache(),assets:new Cache([['unknown',unknownType]])}).hook.inventory({type:'cc.Texture2D'});
assert.strictEqual(unknownResult.total,0);assert.strictEqual(unknownResult.totalExact,false);assert.strictEqual(unknownResult.filterIncomplete,true);
const badConfig=boot({bundles:new Cache([['b',{name:'b',_config:{assetInfos:new Cache([['good',{}],['x'.repeat(129),{}]])}}]]),assets:new Cache()}).hook.inventory({});
assert.strictEqual(badConfig.bundles[0].totalExact,false);
const union=boot({bundles:new Cache([['b',{name:'b',_config:{assetInfos:new Cache(Array.from({length:20000},(_,i)=>['u'+i,{}]))}}]]),assets:new Cache(Array.from({length:20000},(_,i)=>['c'+i,{}]))}).hook;
const unionPage=union.inventory({offset:19950,limit:50});assert.strictEqual(unionPage.total,20000);assert.strictEqual(unionPage.totalExact,false);assert.strictEqual(unionPage.nextOffset,null);
console.log('resource-inventory: identifier privacy, truthful incompleteness and reachable cursors passed');
