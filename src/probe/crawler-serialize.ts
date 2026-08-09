// @ts-nocheck
import { getCcEngine, safeGetCcEngine } from './engine-helper';

export function syncNodeTree() {
    const ccEng = safeGetCcEngine();
    const scene = ccEng ? ccEng.director.getScene() : null;
    if (!scene) return;

    const treeData = serializeNode(scene, 0);
    const pauseStatus = (ccEng && typeof ccEng.game !== 'undefined' && ccEng.game.isPaused) ? ccEng.game.isPaused() : false;
    
    let atlasCount = undefined;
    try {
        if (ccEng && ccEng.dynamicAtlasManager) {
            atlasCount = ccEng.dynamicAtlasManager.atlasCount;
        }
    } catch(e) {}

    if (window.__mcpInspector && window.__mcpInspector.updateTree) {
        window.__mcpInspector.updateTree(JSON.stringify({ tree: treeData, isPaused: pauseStatus, atlasCount: atlasCount }));
    }
}

export function serializeNode(node, currentPrefabDepth = 0) {
    if (!node) return null;
    if (node.name === '__mcp_hover_overlay__' || node.name === '__mcp_select_overlay__' || node.name === 'McpInspectorRoot' || node.name === 'InspectorCamera') return null; // 排除内部创建的高亮渲染层
    
    let isActive = true;
    let isActiveInHierarchy = true;
    let isScene = false;

    const ccEng = safeGetCcEngine();

    // 彻底规避 cc.Scene 会在 getter 内部直接用 cc.error 打印日志的问题
    if (ccEng && node instanceof ccEng.Scene) {
        isActive = true;
        isActiveInHierarchy = true;
        isScene = true;
    } else {
        try {
            isActive = node.active !== false;
            isActiveInHierarchy = node.activeInHierarchy !== false;
        } catch (e) { }
    }

    let isPrefab = !!node._prefab;
    let prefabRoot = isPrefab && node._prefab.root === node;
    let nextPrefabDepth = currentPrefabDepth;
    if (prefabRoot) {
        nextPrefabDepth++;
    }

    const componentNames = [];
    if (node._components) {
        for (let k = 0; k < node._components.length; k++) {
            const comp = node._components[k];
            let cClass = comp.name || (comp.constructor ? comp.constructor.name : '');
            if (typeof window.cc !== 'undefined' && window.cc.js && typeof window.cc.js.getClassName === 'function') {
                const cName = window.cc.js.getClassName(comp);
                if (cName) cClass = cName;
            }
            if (cClass) {
                const m = cClass.match(/<(.+)>/);
                componentNames.push(m ? m[1] : cClass);
            }
        }
    }

    const data = {
        id: node.uuid || node.id,
        name: node.name,
        active: isActive,
        activeInHierarchy: isActiveInHierarchy,
        childrenCount: node.childrenCount || 0,
        components: node._components ? node._components.length : 0,
        componentNames: componentNames,
        children: [],
        isScene: isScene,
        isPrefab: isPrefab,
        prefabRoot: prefabRoot,
        prefabDepth: nextPrefabDepth
    };

    if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
            const childData = serializeNode(node.children[i], nextPrefabDepth);
            if (childData) {
                data.children.push(childData);
            }
        }
    }
    return data;
}
