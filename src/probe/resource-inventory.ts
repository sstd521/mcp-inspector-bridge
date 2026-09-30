// @ts-nocheck
import { getCcEngine } from './engine-helper';

const SCAN_LIMIT = 20000, BUNDLE_LIMIT = 128, OUTPUT_LIMIT = 50;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const short = (value, limit = 128) => typeof value === 'string' ? value.slice(0, limit) : null;
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
// URL/path cache keys cannot be exposed as queryable UUIDs without leaking credentials.
const validIdentifier = value => validText(value) && !/[\/?#:\\]/.test(value);
const failure = error => ({ success: false, available: false, error });
function read(source, key, errors = []) {
    try { return source == null ? undefined : source[key]; }
    catch (_) { if (!errors.includes(key) && errors.length < 16) errors.push(key); return undefined; }
}
function lookup(cache, key) {
    try {
        const map = cache && cache._map;
        if (map && typeof map === 'object') {
            const present = own(map, key);
            try { return { present, value: present ? map[key] : undefined, error: false }; }
            catch (_) { return { present, error: true }; }
        }
        if (cache && typeof cache.get === 'function') {
            const value = cache.get(key);
            return { present: typeof cache.has === 'function' ? cache.has(key) : value !== undefined, value, error: false };
        }
    } catch (_) { return { present: null, error: true }; }
    return { present: null, error: true };
}
// ponytail: bounded synchronous scans; use a cursor protocol if projects exceed these budgets.
function scan(cache, limit, visit) {
    let count = 0, truncated = false, failed = false;
    const stop = {};
    const accept = (value, key, error = false) => {
        if (count >= limit) { truncated = true; throw stop; }
        count++; visit(value, key, error);
    };
    try {
        if (!cache) return { count, truncated, failed, available: false };
        const map = cache._map;
        if (map && typeof map === 'object') {
            for (const key in map) if (own(map, key)) {
                if (count >= limit) { truncated = true; break; }
                let value, error = false;
                try { value = map[key]; } catch (_) { error = true; }
                accept(value, key, error);
            }
        } else if (typeof cache.entries === 'function') {
            for (const [key, value] of cache.entries()) accept(value, key);
        } else if (typeof cache.forEach === 'function') cache.forEach(accept);
        else return { count, truncated, failed, available: false };
    } catch (error) { if (error !== stop) failed = true; }
    return { count, truncated, failed, available: true };
}
function className(engine, source, errors) {
    const direct = read(source, '__classname__', errors);
    if (typeof direct === 'string' && direct) return short(direct);
    try { return engine.js && typeof engine.js.getClassName === 'function' ? short(engine.js.getClassName(source)) || null : null; }
    catch (_) { if (!errors.includes('type')) errors.push('type'); return null; }
}
function cleanUrl(value, errors) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const base = typeof document !== 'undefined' && document.baseURI || window.location.href;
        const url = new URL(value, base);
        if (!['http:', 'https:', 'file:'].includes(url.protocol)) { errors.push('urlProtocol'); return null; }
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        const result = url.href;
        if (result.length > 512) { errors.push('urlLength'); return null; }
        return result;
    } catch (_) { errors.push('url'); return null; }
}
function membership(engine, bundle, info, errors) {
    const packs = read(info, 'packs', errors), ext = read(info, 'ext', errors);
    const ctor = read(info, 'ctor', errors), url = read(info, 'url', errors);
    return { bundle, path: short(read(info, 'path', errors), 256), type: ctor ? className(engine, ctor, errors) :
        typeof url === 'string' && url.endsWith('.fire') ? 'cc.SceneAsset' : null,
        packed: Array.isArray(packs) && packs.length > 0 && ext !== '.json',
        package: Array.isArray(packs) && ext === '.json', url: cleanUrl(url, errors) };
}
function collect(engine, target) {
    const manager = engine.assetManager;
    if (!manager || !manager.assets || !manager.bundles) return { error: 'RESOURCE_API_UNAVAILABLE' };
    const rows = new Map(), bundles = [], knownBundles = new Set();
    let scanTruncated = false, configScanned = 0, bundleListIncomplete = false, cacheIncomplete = false, skippedIdentifiers = 0;
    const rowFor = uuid => {
        if (!validIdentifier(uuid)) { skippedIdentifiers++; scanTruncated = true; return null; }
        if (!rows.has(uuid) && rows.size >= SCAN_LIMIT && uuid !== target) { scanTruncated = true; return null; }
        if (!rows.has(uuid)) rows.set(uuid, { uuid, bundles: [], errors: [], cached: false, asset: undefined });
        return rows.get(uuid);
    };
    const cached = scan(manager.assets, SCAN_LIMIT, (asset, key, error) => {
        const row = rowFor(key); if (!row) { cacheIncomplete = true; return; }
        row.cached = true; row.asset = asset;
        if (error) row.errors.push('cacheEntry');
    });
    if (!cached.available) return { error: 'RESOURCE_API_UNAVAILABLE' };
    scanTruncated = scanTruncated || cached.truncated || cached.failed;
    const bundleScan = scan(manager.bundles, BUNDLE_LIMIT, (bundle, key, error) => {
        const errors = [], name = read(bundle, 'name', errors) || key;
        if (!validText(name) || error || errors.length) { scanTruncated = true; bundleListIncomplete = true; return; }
        knownBundles.add(name);
        const config = read(bundle, '_config', errors), infos = read(config, 'assetInfos', errors);
        const summary = { name, assetCount: 0, cachedCount: 0, totalExact: true };
        const add = (info, uuid, failed) => {
            const row = rowFor(uuid); if (!row) { summary.totalExact = false; return; }
            if (row.cached !== true) {
                const hit = lookup(manager.assets, uuid);
                row.cached = hit.present; row.asset = hit.value;
                if (hit.error) { summary.totalExact = false; if (!row.errors.includes('cacheEntry')) row.errors.push('cacheEntry'); }
            }
            if (failed) { row.errors.push('assetInfo'); summary.totalExact = false; }
            row.bundles.push(membership(engine, name, info, row.errors));
            summary.assetCount++; if (row.cached === true) summary.cachedCount++;
        };
        if (target) {
            const hit = lookup(infos, target);
            if (hit.present) add(hit.value, target, hit.error);
            if (hit.error) { summary.totalExact = false; scanTruncated = true; }
        } else {
            const result = scan(infos, Math.max(0, SCAN_LIMIT - configScanned), add);
            configScanned += result.count;
            if (!result.available || result.truncated || result.failed) { summary.totalExact = false; scanTruncated = true; }
        }
        if (errors.length) { summary.totalExact = false; scanTruncated = true; }
        bundles.push(summary);
    });
    if (!bundleScan.available) return { error: 'RESOURCE_API_UNAVAILABLE' };
    scanTruncated = scanTruncated || bundleScan.truncated || bundleScan.failed;
    if (target && !rows.has(target)) {
        const hit = lookup(manager.assets, target);
        if (hit.error && !hit.present) return { error: 'RESOURCE_QUERY_FAILED' };
        if (hit.present) {
            const row = rowFor(target); row.cached = hit.present; row.asset = hit.value;
            if (hit.error) row.errors.push('cacheEntry');
        }
    }
    return { manager, rows, bundles: bundles.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        knownBundles, scanTruncated, skippedIdentifiers, cacheTruncated: cacheIncomplete || cached.truncated || cached.failed,
        bundleTruncated: bundleListIncomplete || bundleScan.truncated || bundleScan.failed, scanned: { cached: cached.count, config: configScanned, bundles: bundleScan.count } };
}
function describe(engine, row, scanTruncated) {
    const errors = row.errors.slice(0, 16), asset = row.asset;
    const memberships = row.bundles.slice().sort((a, b) => a.bundle < b.bundle ? -1 : a.bundle > b.bundle ? 1 : 0);
    const name = short(read(asset, 'name', errors), 256);
    const type = asset ? className(engine, asset, errors) : null;
    const loaded = read(asset, 'loaded', errors), refCount = read(asset, 'refCount', errors);
    const width = read(asset, 'width', errors), height = read(asset, 'height', errors);
    const url = read(asset, 'url', errors);
    return { uuid: row.uuid, name, type: type || (memberships.find(item => item.type) || {}).type || null,
        cached: row.cached, loaded: typeof loaded === 'boolean' ? loaded : null,
        refCount: typeof refCount === 'number' && Number.isFinite(refCount) ? refCount : null,
        membershipsTruncated: memberships.length > OUTPUT_LIMIT,
        membershipsExact: !scanTruncated && memberships.length <= OUTPUT_LIMIT,
        url: url ? cleanUrl(url, errors) : (memberships.find(item => item.url) || {}).url || null,
        dimensions: { ...(typeof width === 'number' && Number.isFinite(width) && width >= 0 ? { width } : {}),
            ...(typeof height === 'number' && Number.isFinite(height) && height >= 0 ? { height } : {}) },
        errors: Array.from(new Set(errors)).slice(0, 16), bundles: memberships.slice(0, OUTPUT_LIMIT) };
}
function dependencies(state, uuid) {
    const util = read(state.manager, 'dependUtil'), records = read(util, '_depends');
    const getDeps = read(util, 'getDeps');
    const unavailable = { available: false, total: 0, totalExact: false, truncated: false, reason: 'DEPENDENCY_API_UNAVAILABLE', uuids: [] };
    if (!records || typeof getDeps !== 'function') return { dependencies: unavailable,
        reverseDependencies: { ...unavailable, scope: 'cached-assets', complete: false, recordsMissing: 0 } };
    const budget = { left: SCAN_LIMIT };
    const list = key => {
        const hit = lookup(records, key);
        if (hit.error) return { ...unavailable, reason: 'DEPENDENCY_READ_FAILED' };
        if (!hit.present) return { ...unavailable, reason: 'DEPENDENCY_RECORD_MISSING' };
        try {
            const values = getDeps.call(util, key);
            if (!Array.isArray(values)) return { ...unavailable, reason: 'DEPENDENCY_READ_FAILED' };
            const found = new Set();
            const count = Math.min(values.length, budget.left);
            budget.left -= count;
            let invalidEntries = 0;
            for (let i = 0; i < count; i++) {
                const value = values[i];
                if (validIdentifier(value)) found.add(value); else invalidEntries++;
            }
            return { available: true, values: found, invalidEntries, complete: count === values.length && invalidEntries === 0 };
        } catch (_) { return { ...unavailable, reason: 'DEPENDENCY_READ_FAILED' }; }
    };
    const direct = list(uuid);
    let directResult = direct;
    if (direct.available) {
        const ids = Array.from(direct.values).sort();
        directResult = { available: true, total: ids.length, totalExact: direct.complete,
            truncated: !direct.complete || ids.length > OUTPUT_LIMIT, invalidEntries: direct.invalidEntries, uuids: ids.slice(0, OUTPUT_LIMIT) };
    }
    const reverse = new Set();
    let recordsMissing = 0, complete = !state.cacheTruncated;
    const cachedIds = Array.from(state.rows.values()).filter(row => row.cached === true).map(row => row.uuid).sort();
    for (const key of cachedIds) {
        if (budget.left <= 0) { complete = false; break; }
        const result = key === uuid ? direct : list(key);
        if (!result.available) { recordsMissing++; complete = false; continue; }
        if (!result.complete) complete = false;
        if (result.values.has(uuid)) reverse.add(key);
    }
    const ids = Array.from(reverse).sort();
    return { dependencies: directResult, reverseDependencies: { available: true, scope: 'cached-assets',
        total: ids.length, totalExact: complete,
        truncated: !complete || ids.length > OUTPUT_LIMIT, complete, recordsMissing, uuids: ids.slice(0, OUTPUT_LIMIT) } };
}
export function initResourceInventory() {
    const fallbackId = 'resource-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    function run(input, detail) {
        const allowed = detail ? ['uuid'] : ['bundle', 'type', 'cached', 'offset', 'limit'];
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) ||
            detail && !validIdentifier(input.uuid) || !detail && (
                ['bundle', 'type'].some(key => input[key] !== undefined && !validText(input[key])) ||
                input.cached !== undefined && typeof input.cached !== 'boolean' ||
                input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 20000) ||
                input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) return failure('INVALID_RESOURCE_QUERY');
        try {
            const engine = getCcEngine();
            if (!engine) return failure('ENGINE_UNAVAILABLE');
            const scene = engine.director && engine.director.getScene();
            if (!scene || scene.isValid === false) return failure('SCENE_UNAVAILABLE');
            let id = fallbackId;
            try { id = short(window.__mcpCrawler.getInputContext().id) || fallbackId; } catch (_) {}
            let frame = null;
            try { const value = engine.director.getTotalFrames(); if (Number.isFinite(value)) frame = value; } catch (_) {}
            const context = { id, sceneUuid: short(read(scene, 'uuid') || read(scene, 'id')),
                sceneName: short(read(scene, 'name')), engineVersion: short(read(engine, 'ENGINE_VERSION'), 64), capturedAt: Date.now(), frame };
            const state = collect(engine, detail ? input.uuid : null);
            if (state.error) return { ...failure(state.error), context };
            const base = { success: true, available: true, context, pagination: 'live', scanTruncated: state.scanTruncated,
                skippedIdentifiers: state.skippedIdentifiers, scanned: state.scanned, scanLimits: { union: SCAN_LIMIT, cached: SCAN_LIMIT, config: SCAN_LIMIT, bundles: BUNDLE_LIMIT, dependencies: SCAN_LIMIT } };
            if (detail) {
                const row = state.rows.get(input.uuid);
                return { ...base, uuid: input.uuid, found: !!row, foundExact: !!row || !state.scanTruncated,
                    ...dependencies(state, input.uuid), asset: row ? describe(engine, row, state.scanTruncated) : null };
            }
            if (input.bundle && !state.knownBundles.has(input.bundle)) return { ...failure(state.bundleTruncated ? 'RESOURCE_QUERY_FAILED' : 'BUNDLE_NOT_FOUND'), context };
            const offset = input.offset === undefined ? 0 : input.offset, limit = input.limit === undefined ? 25 : input.limit;
            const matching = []; let filterIncomplete = false;
            for (const row of state.rows.values()) {
                if (input.bundle && !row.bundles.some(item => item.bundle === input.bundle)) continue;
                if (input.cached !== undefined && row.cached !== input.cached) {
                    if (row.cached === null) filterIncomplete = true;
                    continue;
                }
                if (input.type) {
                    const type = row.asset ? className(engine, row.asset, row.errors) : null;
                    if (type !== input.type && !row.bundles.some(item => item.type === input.type)) {
                        if (!type && !row.bundles.some(item => item.type)) filterIncomplete = true;
                        continue;
                    }
                }
                matching.push(row);
            }
            matching.sort((a, b) => a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
            const assets = matching.slice(offset, offset + limit).map(row => describe(engine, row, state.scanTruncated)), next = offset + assets.length;
            return { ...base, total: matching.length, totalExact: !state.scanTruncated && !filterIncomplete, filterIncomplete, offset, limit,
                nextOffset: next < matching.length ? next : null, truncated: next < matching.length || state.scanTruncated || filterIncomplete,
                bundlesTruncated: state.bundleTruncated || state.bundles.length > OUTPUT_LIMIT,
                assets, bundles: state.bundles.slice(0, OUTPUT_LIMIT) };
        } catch (_) { return failure('RESOURCE_QUERY_FAILED'); }
    }
    window.__mcpResourceInventory = { inventory: (input = {}) => run(input, false), detail: input => run(input, true) };
}
