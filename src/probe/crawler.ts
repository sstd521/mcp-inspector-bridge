// @ts-nocheck
import { Logger } from './logger';
import { syncNodeTree } from './crawler-serialize';

function initVisualFeedbackStyle() {
    if (document.getElementById('__mcp_simulate_style')) return;
    const style = document.createElement('style');
    style.id = '__mcp_simulate_style';
    style.textContent = `
    .mcp-visual-base {
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        transform: translate(-50%, -50%);
    }
    .mcp-visual-click {
        width: 20px; height: 20px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        border-radius: 50%;
        animation: mcp-ripple 0.5s ease-out forwards;
    }
    .mcp-visual-click::after, .mcp-visual-click::before {
        content: ""; position: absolute; background: rgba(255, 0, 0, 0.8);
    }
    .mcp-visual-click::before { top: 50%; left: -5px; right: -5px; height: 1px; }
    .mcp-visual-click::after { left: 50%; top: -5px; bottom: -5px; width: 1px; }
    
    .mcp-visual-long-press {
        width: 40px; height: 40px;
        border-radius: 50%;
        border: 4px solid rgba(255, 165, 0, 0.3);
        border-top-color: rgba(255, 165, 0, 1);
        animation: mcp-spin linear forwards;
    }
    .mcp-visual-swipe {
        width: 16px; height: 16px;
        background-color: rgba(0, 150, 255, 0.8);
        border-radius: 50%;
        box-shadow: 0 0 8px rgba(0, 150, 255, 1);
    }
    @keyframes mcp-ripple {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    @keyframes mcp-spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
    `;
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.body.appendChild(style);
    }
}

function getComponentClassName(comp) {
    if (!comp) return "UnknownComponent";
    let cname = "UnknownComponent";
    const ccEng = safeGetCcEngine();
    if (ccEng && ccEng.js && typeof ccEng.js.getClassName === 'function') {
        cname = ccEng.js.getClassName(comp);
    }
    if (!cname) {
        cname = comp.name || (comp.constructor ? comp.constructor.name : "UnknownComponent");
    }
    const match = cname.match(/<([^>]+)>/);
    return match ? match[1] : cname;
}

export function initCrawler() {
    window.__mcpCrawler = {
        findNodeByUuid: function (uuid, root) {
            const eng = safeGetCcEngine();
            if (!eng || !eng.director) return null;
            const startNode = root || eng.director.getScene();
            if (!startNode) return null;
            if (startNode.uuid === uuid || startNode.id === uuid) return startNode;
            for (let i = 0; i < startNode.childrenCount; i++) {
                const found = this.findNodeByUuid(uuid, startNode.children[i]);
                if (found) return found;
            }
            return null;
        },
        getNodeDetail: function (uuid) {
            const node = this.findNodeByUuid(uuid);
            if (!node) return null;

            const ccEng = safeGetCcEngine();
            if (ccEng && node instanceof ccEng.Scene) {
                return {
                    id: node.uuid || node.id,
                    name: node.name,
                    isScene: true,
                    active: true,
                    components: [],
                };
            }

            let isActive = true;
            try { isActive = node.active !== false; } catch(e) {}

            let prefabUuid = null;
            try {
                if (node._prefab) {
                    if (node._prefab.asset) {
                        prefabUuid = node._prefab.asset._uuid || node._prefab.asset.uuid || node._prefab.asset.id;
                    }
                    if (!prefabUuid && node._prefab.fileId) {
                        prefabUuid = node._prefab.fileId;
                    }
                    if (!prefabUuid && node._prefab._prefab) {
                        prefabUuid = node._prefab._prefab._uuid || node._prefab._prefab.uuid;
                    }
                    if (!prefabUuid) {
                        var cur = node;
                        while (cur) {
                            if (cur._prefab && cur._prefab.root === cur && cur._prefab.asset) {
                                prefabUuid = cur._prefab.asset._uuid || cur._prefab.asset.uuid || cur._prefab.asset.id;
                                break;
                            }
                            cur = cur.parent;
                        }
                    }
                }
            } catch (e) {}

            let sx = 1, sy = 1;
            if ('scale' in node && typeof node.scale === 'object' && 'x' in node.scale) {
                sx = node.scale.x !== undefined ? node.scale.x : 1;
                sy = node.scale.y !== undefined ? node.scale.y : 1;
            } else {
                sx = node.scaleX !== undefined ? node.scaleX : 1;
                sy = node.scaleY !== undefined ? node.scaleY : 1;
            }

            const detail = {
                id: node.uuid || node.id,
                name: node.name,
                isScene: false,
                prefabUuid: prefabUuid,
                active: isActive,
                x: node.x !== undefined ? node.x : 0,
                y: node.y !== undefined ? node.y : 0,
                worldPolygon: this.getNodeWorldPolygon(node),
                interactable: (window.cc && window.cc.Button && node.getComponent(window.cc.Button)) ? node.getComponent(window.cc.Button).interactable : null,
                hasAngle: ('angle' in node),
                rotation: ('angle' in node) ? -node.angle : (node.rotation !== undefined ? node.rotation : 0),
                scaleX: sx,
                scaleY: sy,
                width: node.width !== undefined ? node.width : 0,
                height: node.height !== undefined ? node.height : 0,
                anchorX: node.anchorX !== undefined ? node.anchorX : 0.5,
                anchorY: node.anchorY !== undefined ? node.anchorY : 0.5,
                color: node.color ? '#' + node.color.toHEX() : '#ffffff',
                opacity: node.opacity !== undefined ? node.opacity : 255,
                skewX: node.skewX || 0,
                skewY: node.skewY || 0,
                groupIndex: node.groupIndex !== undefined ? node.groupIndex : 0,
                groupList: window.cc && window.cc.game ? window.cc.game.groupList : null,
                components: [],
            };

            if (node._components) {
                for (let i = 0; i < node._components.length; i++) {
                    const comp = node._components[i];
                      const cname = getComponentClassName(comp);
                    const props = [];

                    let propKeys = [];
                    const registeredProps = new Set();
                    if (comp.constructor) {
                        if (Array.isArray(comp.constructor.__props__)) {
                            comp.constructor.__props__.forEach(p => registeredProps.add(p));
                        }
                        if (comp.constructor.__attrs__) {
                            Object.keys(comp.constructor.__attrs__).forEach(attrKey => {
                                const idx = attrKey.indexOf('|');
                                if (idx > 0) {
                                    registeredProps.add(attrKey.substring(0, idx));
                                }
                            });
                        }
                    }
                    
                    if (registeredProps.size > 0) {
                        propKeys = Array.from(registeredProps);
                    } else {
                        propKeys = Object.keys(comp);
                    }

                    const hiddenBuiltins = ["name", "uuid", "node", "enabled", "enabledInHierarchy", "_scriptAsset", "__scriptAsset", "_isOnLoadCalled", "_objFlags", "AnimList"];

                    for (let j = 0; j < propKeys.length; j++) {
                        const key = propKeys[j];
                        try {
                            if (hiddenBuiltins.indexOf(key) !== -1) continue;

                            let isVisible = true;
                            if (comp.constructor && comp.constructor.__attrs__) {
                                const visibleAttr = comp.constructor.__attrs__[key + "|visible"];
                                if (visibleAttr !== undefined) {
                                    isVisible = typeof visibleAttr === "function" ? !!visibleAttr.call(comp) : !!visibleAttr;
                                } else if (key.startsWith("_")) {
                                    isVisible = false;
                                }
                            } else if (key.startsWith("_")) {
                                isVisible = false;
                            }
                            if (!isVisible) continue;

                            const val = comp[key];
                            if (typeof val === "function") continue;

                            let type = "unsupported";
                            let exportValue = val;
                            if (val === null || val === undefined) type = "unsupported";
                            else if (typeof val === "number") type = "number";
                            else if (typeof val === "string") type = "string";
                            else if (typeof val === "boolean") type = "boolean";
                            else if (Array.isArray(val)) {
                                type = "array";
                                exportValue = val.map((item) => {
                                    if (item === null) return "null";
                                    if (item === undefined) return "undefined";
                                    if (typeof item === "number" || typeof item === "string" || typeof item === "boolean") return item;

                                    const eng = window.cc;
                                    if (eng && eng.Node && item instanceof eng.Node) {
                                        return { type: "node_ref", value: { uuid: item.uuid || item.id, name: item.name } };
                                    } else if (eng && eng.Component && item instanceof eng.Component) {
                                        let cname = item.name || item.__classname__ || "Component";
                                        const m = cname.match(/<([^>]+)>/);
                                        if (m) cname = m[1];
                                        return { type: "comp_ref", value: { uuid: item.node.uuid || item.node.id, name: item.node.name, className: cname } };
                                    } else if (eng && eng.Vec2 && item instanceof eng.Vec2) {
                                        return { type: "vec2", value: { x: item.x, y: item.y } };
                                    } else if (eng && eng.Vec3 && item instanceof eng.Vec3) {
                                        return { type: "vec3", value: { x: item.x, y: item.y, z: item.z } };
                                    } else if (eng && eng.Size && item instanceof eng.Size) {
                                        return { type: "size", value: { width: item.width, height: item.height } };
                                    } else if (eng && eng.Rect && item instanceof eng.Rect) {
                                        return { type: "rect", value: { x: item.x, y: item.y, width: item.width, height: item.height } };
                                    } else if (eng && eng.Color && item instanceof eng.Color) {
                                        return { type: "color", value: { r: item.r, g: item.g, b: item.b, a: item.a, hex: item.toHEX() } };
                                    } else if (eng && eng.Asset && item instanceof eng.Asset) {
                                        let clsName = "cc.Asset";
                                        if (item.__classname__) clsName = item.__classname__;
                                        else if (item.constructor && item.constructor.name) clsName = item.constructor.name;
                                        return { type: "asset_ref", value: { uuid: item._uuid || item.uuid || item.id || "unknown", name: item.name || "Unnamed Asset", className: clsName } };
                                    }

                                    if (item.__classname__ || item.name) return `[${item.__classname__ || "对象"}] ${item.name || ""}`;
                                    return "[复杂对象]";
                                });
                            }
                            else if (typeof val === "object") {
                                const eng = window.cc;
                                if (eng && eng.Node && val instanceof eng.Node) {
                                    type = "node_ref";
                                    exportValue = { uuid: val.uuid || val.id, name: val.name };
                                } else if (eng && eng.Component && val instanceof eng.Component) {
                                    type = "comp_ref";
                                    let cname = val.name || val.__classname__ || "Component";
                                    const m = cname.match(/<([^>]+)>/);
                                    if (m) cname = m[1];
                                    exportValue = { uuid: val.node.uuid || val.node.id, name: val.node.name, className: cname };
                                } else if (eng && eng.Vec2 && val instanceof eng.Vec2) {
                                    type = "vec2";
                                    exportValue = { x: val.x, y: val.y };
                                } else if (eng && eng.Vec3 && val instanceof eng.Vec3) {
                                    type = "vec3";
                                    exportValue = { x: val.x, y: val.y, z: val.z };
                                } else if (eng && eng.Size && val instanceof eng.Size) {
                                    type = "size";
                                    exportValue = { width: val.width, height: val.height };
                                } else if (eng && eng.Rect && val instanceof eng.Rect) {
                                    type = "rect";
                                    exportValue = { x: val.x, y: val.y, width: val.width, height: val.height };
                                } else if (eng && eng.Color && val instanceof eng.Color) {
                                    type = "color";
                                    exportValue = { r: val.r, g: val.g, b: val.b, a: val.a, hex: val.toHEX() };
                                } else if (eng && eng.Asset && val instanceof eng.Asset) {
                                    type = "asset_ref";
                                    let clsName = "cc.Asset";
                                    if (val.__classname__) clsName = val.__classname__;
                                    else if (val.constructor && val.constructor.name) clsName = val.constructor.name;
                                    exportValue = { uuid: val._uuid || val.uuid || val.id || "unknown", name: val.name || "Unnamed Asset", className: clsName };
                                }
                            }

                            if (type !== "unsupported") {
                                let enumList = null;
                                
                                // Test if component property relies on a Cocos Enum
                                let eList = null;
                                if (window.cc && window.cc.Class && typeof window.cc.Class.attr === 'function') {
                                    const attrObj = window.cc.Class.attr(comp.constructor, key);
                                    if (attrObj && attrObj.enumList) {
                                        eList = attrObj.enumList;
                                    }
                                }
                                if (!eList && comp.constructor && comp.constructor.__attrs__) {
                                    eList = comp.constructor.__attrs__[key + "|enumList"];
                                }
                                
                                if (eList && Array.isArray(eList)) {
                                    // Make sure it contains {name, value} or at least valid items
                                    if (eList.length > 0 && eList[0].name !== undefined && eList[0].value !== undefined) {
                                        enumList = eList;
                                        type = "Enum";
                                    } else {
                                        // Some EnumLists in CC are plain arrays? Convert to {name, value}
                                        enumList = eList.map(e => (typeof e === 'object' ? e : {name: e.toString(), value: e}));
                                        type = "Enum";
                                    }
                                }

                                if (cname === "sp.Skeleton" || cname === "Skeleton") {
                                    if ((key === "animation" || key === "defaultAnimation") && comp.skeletonData) {
                                        try {
                                            const rd = comp.skeletonData.getRuntimeData();
                                            if (rd && rd.animations) enumList = ["<None>"].concat(rd.animations.map((a) => a.name));
                                        } catch (e) { }
                                    } else if (key === "defaultSkin" && comp.skeletonData) {
                                        try {
                                            const rd = comp.skeletonData.getRuntimeData();
                                            if (rd && rd.skins) enumList = rd.skins.map((s) => s.name);
                                        } catch (e) { }
                                    }
                                } else if (cname === "dragonBones.ArmatureDisplay" || cname === "ArmatureDisplay") {
                                    if (key === "armatureName") {
                                        try {
                                            if (typeof comp.getArmatureNames === 'function') {
                                                enumList = ["<None>"].concat(comp.getArmatureNames() || []);
                                            }
                                        } catch (e) { }
                                    } else if (key === "animationName") {
                                        try {
                                            if (typeof comp.getAnimationNames === 'function') {
                                                enumList = ["<None>"].concat(comp.getAnimationNames(comp.armatureName) || []);
                                            }
                                        } catch (e) { }
                                    }
                                }
                                const propData = { key, value: exportValue, type };
                                if (enumList) propData.enumList = enumList;
                                props.push(propData);
                            }
                        } catch (e) { }
                    }
                    let scriptUuid = null;
                    if (comp.__scriptAsset) {
                        scriptUuid = comp.__scriptAsset._uuid || comp.__scriptAsset.uuid || comp.__scriptAsset.id;
                    }
                    if (!scriptUuid && window.cc && window.cc.js) {
                        const classId = window.cc.js._getClassId(comp.constructor);
                        if (classId && typeof classId === 'string' && classId.indexOf('cc.') !== 0 && classId.indexOf('sp.') !== 0 && classId !== 'Widget' && classId !== 'dragonBones.ArmatureDisplay') {
                            scriptUuid = classId;
                        }
                    }
                    detail.components.push({
                        name: cname,
                        realIndex: i,
                        enabled: comp.enabled !== false,
                        scriptUuid: scriptUuid,
                        properties: props,
                    });
                }
            }
            return detail;
        },
        updateNodeProperty: function (uuid, compName, propKey, value, compIndex, arrayIndex) {
            const node = this.findNodeByUuid(uuid);
            if (!node || !node.isValid) {
                Logger.warn("[MCP Crawler] Node " + uuid + " is invalid or already destroyed.");
                return false;
            }

            try {
                if (!compName || compName === 'null') {
                    // Update property on the node directly
                    if (propKey === 'rotation' && 'angle' in node) {
                        node.angle = -value;
                    } else if (propKey === 'color' && window.cc && window.cc.Color) {
                        let hex = String(value);
                        if (hex.startsWith('#')) hex = hex.slice(1);
                        let r = parseInt(hex.slice(0, 2), 16) || 0;
                        let g = parseInt(hex.slice(2, 4), 16) || 0;
                        let b = parseInt(hex.slice(4, 6), 16) || 0;
                        node.color = new window.cc.Color(r, g, b, node.color ? node.color.a : 255);
                    } else if (propKey === 'opacity') {
                        node.opacity = Math.max(0, Math.min(255, parseInt(value, 10) || 0));
                    } else if (propKey === 'scaleX' || propKey === 'scaleY') {
                        if ('scale' in node && typeof node.scale === 'object' && 'x' in node.scale) {
                            let vec = node.scale;
                            if (propKey === 'scaleX') vec.x = value;
                            if (propKey === 'scaleY') vec.y = value;
                            node.scale = vec;
                        } else {
                            node[propKey] = value;
                        }
                    } else {
                        node[propKey] = value;
                    }
                    return true;
                } else {
                    // Update property on a specific component
                    if (node._components) {
                        // Use compIndex if valid, otherwise fallback to name searching
                        let targetComp = null;
                        if (compIndex !== undefined && compIndex >= 0 && compIndex < node._components.length) {
                            targetComp = node._components[compIndex];
                        } else {
                            for (let i = 0; i < node._components.length; i++) {
                                const comp = node._components[i];
                                  const cname = getComponentClassName(comp);

                                if (cname === compName) {
                                    targetComp = comp;
                                    break;
                                }
                            }
                        }

                        if (targetComp) {
                            if (arrayIndex !== undefined && arrayIndex !== null && arrayIndex !== -1) {
                                const arr = targetComp[propKey];
                                if (Array.isArray(arr) && arr[arrayIndex] !== undefined) {
                                    if (typeof value === 'object' && value !== null) {
                                        Object.assign(arr[arrayIndex], value);
                                    } else {
                                        arr[arrayIndex] = value;
                                    }
                                }
                            } else {
                                if (typeof value === 'object' && value !== null && targetComp[propKey] && typeof targetComp[propKey] === 'object') {
                                    Object.assign(targetComp[propKey], value);
                                } else {
                                    targetComp[propKey] = value;
                                }
                            }
                            if (typeof targetComp.updateAlignment === 'function') {
                                targetComp.updateAlignment();
                            }
                            return true;
                        }
                        Logger.warn("[MCP Crawler] Component " + compName + " not found on node " + node.name);
                        return false;
                    }
                }
            } catch (e) {
                console.error("[MCP Crawler] Exception in updateNodeProperty: ", e);
            }
            return false;
        },

        printComponentData: function (uuid, compIndex) {
            const node = this.findNodeByUuid(uuid);
            if (!node || !node._components || compIndex < 0 || compIndex >= node._components.length) {
                Logger.warn("[MCP Crawler] Target node or component not found for printing.", uuid, compIndex);
                return;
            }

            const comp = node._components[compIndex];
            const eng = window.cc || {};

            function getNodePath(n) {
                try {
                    if (!n) return '';
                    let isValidStr = (n.isValid === false) ? ' (Destroyed)' : '';
                    let path = (n.name || 'Unnamed') + isValidStr;
                    let current = n.parent;
                    while (current) {
                        let curValidStr = (current.isValid === false) ? ' (Destroyed)' : '';
                        path = (current.name || 'Unnamed') + curValidStr + '/' + path;
                        current = current.parent;
                    }
                    return path;
                } catch (e) {
                    return '[Unknown Node Path]';
                }
            }

            const seen = new WeakSet();
            const replacer = function (key, value) {
                try {
                    if (value === null || value === undefined) return value;

                    // 避免序列化 DOM 元素或 window/document 等全局对象
                    if (value === window || value === document || (typeof value === 'object' && value.nodeType !== undefined)) {
                        return "[DOM Element]";
                    }

                    // 处理 cc.Node
                    if (eng.Node && (value instanceof eng.Node || (value.constructor && value.constructor.name === 'Node'))) {
                        return `[ cc.Node: ${getNodePath(value)} ]`;
                    }

                    // 处理 cc.Component
                    if (eng.Component && (value instanceof eng.Component || (value.constructor && value.constructor.prototype instanceof eng.Component))) {
                        let compName = value.name || value.__classname__ || (value.constructor ? value.constructor.name : "Component");
                        const match = compName.match(/<([^>]+)>/);
                        if (match) compName = match[1];
                        return `[ Component: ${compName} on Node: ${getNodePath(value.node)} ]`;
                    }

                    // 处理 cc.Asset
                    if (eng.Asset && (value instanceof eng.Asset || (value.constructor && value.constructor.prototype instanceof eng.Asset))) {
                        let clsName = "cc.Asset";
                        if (value.__classname__) clsName = value.__classname__;
                        else if (value.constructor && value.constructor.name) clsName = value.constructor.name;
                        return `[ ${clsName}: ${value.name || value._name || 'Unnamed'} ]`;
                    }

                    if (typeof value === 'object') {
                        if (seen.has(value)) {
                            return "[Circular]";
                        }
                        seen.add(value);
                    }

                    return value;
                } catch (e) {
                    return "[Error Serializing Property]";
                }
            };

            try {
                const jsonStr = JSON.stringify(comp, replacer, 4);
                const compName = getComponentClassName(comp);

                console.log(`%c[MCP] 组件 (${compName}) 数据导出成功 👇`, 'color: #00ff00; font-weight: bold;');
                console.log(jsonStr);
                console.log(`%c---------------------------------------`, 'color: #00ff00; font-weight: bold;');

                // 尝试写入剪贴板
                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(jsonStr).catch(function (err) { });
                }
            } catch (err) {
                console.error("[MCP Crawler] 序列化组件数据失败: ", err);
            }
        },

        printNodeData: function (uuid) {
            const node = this.findNodeByUuid(uuid);
            if (!node || !node.isValid) {
                console.warn("[MCP Crawler] Target node not found for printing.", uuid);
                return;
            }

            try {
                console.log('%c[MCP] 节点 (' + node.name + ') 数据已打印 👇', 'color: #00ff00; font-weight: bold;');
                console.dir(node);
            } catch (err) {
                console.error("[MCP Crawler] 打印节点数据时发生异常: ", err);
            }
        },

        getNodeWorldPolygon: function (target) {
            const eng = window.cc;
            if (!target || typeof target.convertToWorldSpaceAR !== 'function') return null;
            const width = target.width || 0;
            const height = target.height || 0;
            if (width === 0 && height === 0) return null;

            const ax = target.anchorX !== undefined ? target.anchorX : 0.5;
            const ay = target.anchorY !== undefined ? target.anchorY : 0.5;

            const ptLeft = -ax * width;
            const ptRight = (1 - ax) * width;
            const ptBottom = -ay * height;
            const ptTop = (1 - ay) * height;

            let bl = target.convertToWorldSpaceAR(eng.v2(ptLeft, ptBottom));
            let br = target.convertToWorldSpaceAR(eng.v2(ptRight, ptBottom));
            let tr = target.convertToWorldSpaceAR(eng.v2(ptRight, ptTop));
            let tl = target.convertToWorldSpaceAR(eng.v2(ptLeft, ptTop));

            return [bl, br, tr, tl];
        },

        setHoverTarget: function (uuid) {
            if (window.__mcpHighlightData) {
                window.__mcpHighlightData.hoverId = uuid;
            }
        },

        setSelectionTarget: function (uuid) {
            if (window.__mcpHighlightData) {
                Logger.log(`[Selection-Debug] Trigger: Probe-Crawler-setSelectionTarget | NodeID: ${uuid}`);
                window.__mcpHighlightData.selectId = uuid;
            }
        },
        getSimplifiedNode: function (uuid) {
            const node = this.findNodeByUuid(uuid);
            if (!node || !node.isValid) return null;
            let compNames = [];
            if (node._components) {
                compNames = node._components.map(function(c) {
                    let cname = c.name || c.__classname__ || "Unknown";
                    const m = cname.match(/<([^>]+)>/);
                    return m ? m[1] : cname;
                });
            }
            return {
                name: node.name,
                uuid: node.uuid || node.id,
                active: node.active !== false,
                position: { x: node.x || 0, y: node.y || 0 },
                size: { width: node.width || 0, height: node.height || 0 },
                components: compNames
            };
        },
        simulateInput: function (args) {
            const eng = window.cc;
            if (!eng || !eng.director) return { error: 'ENGINE_NOT_READY' };

            let screenPt = eng.v2(0, 0);
            let targetSource = '';

            if (args && args.uuid) {
                const node = this.findNodeByUuid(args.uuid);
                if (!node || !node.isValid) return { error: 'NODE_NOT_FOUND', msg: 'Node not found or destroyed.' };
                let worldPos = eng.v2(0, 0);
                if (typeof node.convertToWorldSpaceAR === 'function') {
                    worldPos = node.convertToWorldSpaceAR(eng.v2(0, 0));
                }
                
                let camera = null;
                if (eng.Camera && eng.Camera.cameras) {
                    camera = eng.Camera.cameras.sort(function(a, b){ return b.depth - a.depth; })[0];
                }
                screenPt = (camera && typeof camera.getWorldToScreenPoint === 'function') 
                               ? camera.getWorldToScreenPoint(worldPos) : worldPos;
                targetSource = 'UUID ' + args.uuid.substring(0,6) + ' (World ' + Math.round(worldPos.x) + ',' + Math.round(worldPos.y) + ')';
            } else if (args && (args.x !== undefined || args.y !== undefined)) {
                // If AI provides raw x,y, it is assumed strictly as Cocos Screen Coordinates (bottom-left = 0,0)
                screenPt.x = args.x || 0;
                screenPt.y = args.y || 0;
                targetSource = 'Raw ScreenPos (' + screenPt.x + ', ' + screenPt.y + ')';
            } else {
                return { error: 'INVALID_ARGS', msg: 'Please provide either uuid or x/y coordinates' };
            }

            const canvas = document.getElementById('GameCanvas') || document.querySelector('canvas');
            if (!canvas) return { error: 'CANVAS_NOT_FOUND' };
            const rect = canvas.getBoundingClientRect();
            const frameSize = eng.view.getFrameSize();
            const visibleOrigin = eng.view.getVisibleOrigin ? eng.view.getVisibleOrigin() : { x: 0, y: 0 };
            const visibleSize = eng.view.getVisibleSize ? eng.view.getVisibleSize() : { width: frameSize.width, height: frameSize.height };

            const clientX = rect.left + (screenPt.x - visibleOrigin.x) * (rect.width / visibleSize.width);
            const clientY = rect.bottom - (screenPt.y - visibleOrigin.y) * (rect.height / visibleSize.height);

            function dispatchNativeEvent(type, cx, cy) {
                let dispatched = false;
                try {
                    const evt = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 });
                    canvas.dispatchEvent(evt);
                    dispatched = true;
                } catch(e) {}

                try {
                    const touchMap = { 'mousedown': 'touchstart', 'mousemove': 'touchmove', 'mouseup': 'touchend' };
                    const tType = touchMap[type];
                    if (tType && typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
                        const touch = new Touch({ identifier: 0, target: canvas, clientX: cx, clientY: cy });
                        const touchEvt = new TouchEvent(tType, {
                            bubbles: true, cancelable: true, 
                            touches: [touch], targetTouches: [touch], changedTouches: [touch]
                        });
                        canvas.dispatchEvent(touchEvt);
                    }
                } catch(e) {}
            }

            const mode = (args && args.inputType) ? args.inputType : 'click';
            const duration = Math.min((args && args.duration) ? args.duration : 100, 3000);

            try { initVisualFeedbackStyle(); } catch(e) {}

            dispatchNativeEvent('mousedown', clientX, clientY);

            let visualPointer = document.createElement('div');
            visualPointer.className = 'mcp-visual-base';
            visualPointer.style.left = clientX + 'px';
            visualPointer.style.top = clientY + 'px';
            document.body.appendChild(visualPointer);

            if (mode === 'click') {
                visualPointer.className += ' mcp-visual-click';
                setTimeout(function() { dispatchNativeEvent('mouseup', clientX, clientY); }, 50);
                setTimeout(function() { 
                    if(visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer); 
                }, 500);
            } else if (mode === 'long_press') {
                visualPointer.className += ' mcp-visual-long-press';
                visualPointer.style.animationDuration = duration + 'ms';
                setTimeout(function() { 
                    dispatchNativeEvent('mouseup', clientX, clientY); 
                    if(visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer);
                }, duration);
            } else if (mode === 'swipe') {
                visualPointer.className += ' mcp-visual-swipe';
                const endX = clientX + ((args && args.swipeDeltaX) ? args.swipeDeltaX : 0);
                const endY = clientY - ((args && args.swipeDeltaY) ? args.swipeDeltaY : 0);
                
                let startTime = Date.now();
                function step() {
                    let progress = (Date.now() - startTime) / duration;
                    if (progress >= 1) {
                        visualPointer.style.left = endX + 'px';
                        visualPointer.style.top = endY + 'px';
                        dispatchNativeEvent('mousemove', endX, endY);
                        dispatchNativeEvent('mouseup', endX, endY);
                        if(visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer);
                    } else {
                        let curX = clientX + (endX - clientX) * progress;
                        let curY = clientY + (endY - clientY) * progress;
                        visualPointer.style.left = curX + 'px';
                        visualPointer.style.top = curY + 'px';
                        dispatchNativeEvent('mousemove', curX, curY);
                        requestAnimationFrame(step);
                    }
                }
                requestAnimationFrame(step);
            }

            return { success: true, msg: 'Simulated ' + mode + ' from ' + targetSource + ' -> Screen DOM (' + Math.round(clientX) + 'px, ' + Math.round(clientY) + 'px)' };
        },
        exportNodeAsPsdData: function(uuid) {
            const rootNode = this.findNodeByUuid(uuid);
            if (!rootNode) return null;
            
            const exportList = [];
            const rootWidth = rootNode.width;
            const rootHeight = rootNode.height;
            const rootAnchorX = rootNode.anchorX;
            const rootAnchorY = rootNode.anchorY;

            // 获取 Texture2D 的 HTML 元素或从 WebGL 读取像素生成 Canvas
            function getTextureCanvasOrImage(texture) {
                if (!texture) return null;
                const img = (texture.getHtmlElementObj && texture.getHtmlElementObj()) || 
                            (texture.getHtmlElement && texture.getHtmlElement()) ||
                            texture.image;
                if (img) {
                    // 验证 Image/Canvas 元素是否包含有效数据，且未被回收 (naturalWidth !== 0)
                    const isValid = img.width > 0 && img.height > 0 && img.naturalWidth !== 0;
                    if (isValid) {
                        return img;
                    }
                }

                try {
                    const eng = window.cc;
                    const gl = eng.game._renderContext;
                    if (!gl) return null;
                    const textureImpl = texture._texture || (texture.getHtmlElementObj && texture.getHtmlElementObj());
                    if (!textureImpl) return null;
                    const glID = textureImpl._glID || texture._glID;
                    if (!glID) return null;

                    const fbo = gl.createFramebuffer();
                    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glID, 0);
                    
                    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                    if (status !== gl.FRAMEBUFFER_COMPLETE) {
                        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                        gl.deleteFramebuffer(fbo);
                        return null;
                    }

                    const w = texture.width;
                    const h = texture.height;
                    const pixels = new Uint8Array(w * h * 4);
                    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.deleteFramebuffer(fbo);

                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return null;

                    const imgData = ctx.createImageData(w, h);
                    imgData.data.set(pixels);
                    ctx.putImageData(imgData, 0, 0);

                    // 注意：Cocos 中正常 Texture2D 在 GPU 里的存储方向使得 readPixels 读取后已经是正向，不需要再次垂直翻转
                    return canvas;
                } catch (e) {
                    return null;
                }
            }

            // 动态获取 Spine 骨骼动画顶点的真实世界 AABB 包围盒
            function getSpineWorldBounds(node) {
                const eng = window.cc;
                const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || 
                                  node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
                if (!spineComp) return null;

                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                try {
                    if (typeof spineComp._updateRenderData === 'function') {
                        spineComp._updateRenderData();
                    }
                    
                    const skel = spineComp._skeleton;
                    if (skel && skel.slots) {
                        for (let i = 0; i < skel.slots.length; i++) {
                            const slot = skel.slots[i];
                            if (!slot || (slot.bone && slot.bone.active === false)) continue;
                            const attachment = slot.getAttachment ? slot.getAttachment() : slot.attachment;
                            if (!attachment) continue;
                            
                            let verts = new Float32Array(8);
                            if (typeof attachment.computeWorldVertices === 'function') {
                                attachment.computeWorldVertices(slot, 0, 8, verts, 0, 2);
                                for (let j = 0; j < verts.length; j += 2) {
                                    const vx = verts[j];
                                    const vy = verts[j + 1];
                                    if (!isNaN(vx) && !isNaN(vy) && isFinite(vx) && isFinite(vy)) {
                                        minX = Math.min(minX, vx);
                                        maxX = Math.max(maxX, vx);
                                        minY = Math.min(minY, vy);
                                        maxY = Math.max(maxY, vy);
                                    }
                                }
                            }
                        }
                    }
                } catch(e) {}

                if (minX < maxX && minY < maxY && isFinite(minX) && isFinite(maxX)) {
                    const blWorld = node.convertToWorldSpaceAR(eng.v2(minX, minY));
                    const trWorld = node.convertToWorldSpaceAR(eng.v2(maxX, maxY));
                    const brWorld = node.convertToWorldSpaceAR(eng.v2(maxX, minY));
                    const tlWorld = node.convertToWorldSpaceAR(eng.v2(minX, maxY));
                    
                    const wx = Math.min(blWorld.x, trWorld.x, brWorld.x, tlWorld.x);
                    const wy = Math.min(blWorld.y, trWorld.y, brWorld.y, tlWorld.y);
                    const ww = Math.max(blWorld.x, trWorld.x, brWorld.x, tlWorld.x) - wx;
                    const wh = Math.max(blWorld.y, trWorld.y, brWorld.y, tlWorld.y) - wy;
                    return new eng.Rect(wx, wy, ww, wh);
                }

                if (typeof node.getBoundingBoxToWorld === 'function') {
                    try {
                        const box = node.getBoundingBoxToWorld();
                        if (box && box.width > 2 && box.height > 2) return box;
                    } catch(e) {}
                }
                return null;
            }

            // 1. 局部 AABB 包围盒计算（转换为 PSD 相对坐标系，支持相对角度和缩放提取）
            function getRelativeTransform(node) {
                const eng = window.cc;
                const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || 
                                  node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
                
                // 对 Spine 骨骼动画节点优先计算渲染世界包围盒，获取真正包含全身体态的宽高与坐标
                if (spineComp) {
                    const wBox = getSpineWorldBounds(node);
                    if (wBox && wBox.width > 2 && wBox.height > 2) {
                        const blWorld = eng.v2(wBox.x, wBox.y);
                        const trWorld = eng.v2(wBox.x + wBox.width, wBox.y + wBox.height);
                        const blLocal = rootNode.convertToNodeSpaceAR(blWorld);
                        const trLocal = rootNode.convertToNodeSpaceAR(trWorld);
                        const toPsd = (pt) => ({
                            x: pt.x + rootAnchorX * rootWidth,
                            y: rootHeight - (pt.y + rootAnchorY * rootHeight)
                        });
                        const blPsd = toPsd(blLocal);
                        const trPsd = toPsd(trLocal);
                        const left = Math.min(blPsd.x, trPsd.x);
                        const top = Math.min(blPsd.y, trPsd.y);
                        const right = Math.max(blPsd.x, trPsd.x);
                        const bottom = Math.max(blPsd.y, trPsd.y);

                        return {
                            box: {
                                left: Math.round(left),
                                top: Math.round(top),
                                width: Math.round(Math.max(1, right - left)),
                                height: Math.round(Math.max(1, bottom - top))
                            },
                            angle: 0,
                            scaleX: 1,
                            scaleY: 1
                        };
                    }
                }

                let width = node.width || 0;
                let height = node.height || 0;

                const ax = node.anchorX !== undefined ? node.anchorX : 0.5;
                const ay = node.anchorY !== undefined ? node.anchorY : 0.5;

                const ptLeft = -ax * width;
                const ptRight = (1 - ax) * width;
                const ptBottom = -ay * height;
                const ptTop = (1 - ay) * height;

                const bl = node.convertToWorldSpaceAR(eng.v2(ptLeft, ptBottom));
                const br = node.convertToWorldSpaceAR(eng.v2(ptRight, ptBottom));
                const tr = node.convertToWorldSpaceAR(eng.v2(ptRight, ptTop));
                const tl = node.convertToWorldSpaceAR(eng.v2(ptLeft, ptTop));

                const blLocal = rootNode.convertToNodeSpaceAR(bl);
                const brLocal = rootNode.convertToNodeSpaceAR(br);
                const trLocal = rootNode.convertToNodeSpaceAR(tr);
                const tlLocal = rootNode.convertToNodeSpaceAR(tl);

                const toPsd = (pt) => ({
                    x: pt.x + rootAnchorX * rootWidth,
                    y: rootHeight - (pt.y + rootAnchorY * rootHeight)
                });

                const blPsd = toPsd(blLocal);
                const brPsd = toPsd(brLocal);
                const trPsd = toPsd(trLocal);
                const tlPsd = toPsd(tlLocal);

                const left = Math.min(blPsd.x, brPsd.x, trPsd.x, tlPsd.x);
                const top = Math.min(blPsd.y, brPsd.y, trPsd.y, tlPsd.y);
                const right = Math.max(blPsd.x, brPsd.x, trPsd.x, tlPsd.x);
                const bottom = Math.max(blPsd.y, brPsd.y, trPsd.y, tlPsd.y);

                // 计算相对 rootNode 的旋转与缩放，考虑镜像翻转
                let localScaleX = 1;
                let localScaleY = 1;
                if ('scale' in node && typeof node.scale === 'object') {
                    localScaleX = node.scale.x;
                    localScaleY = node.scale.y;
                } else {
                    localScaleX = node.scaleX !== undefined ? node.scaleX : 1;
                    localScaleY = node.scaleY !== undefined ? node.scaleY : 1;
                }

                const signX = Math.sign(localScaleX) || 1;
                const signY = Math.sign(localScaleY) || 1;

                const dx = (brPsd.x - blPsd.x) * signX;
                const dy = (brPsd.y - blPsd.y) * signX;
                const angleRelative = Math.atan2(dy, dx);
                
                const lenX = Math.sqrt(dx * dx + dy * dy);
                const scaleXRelative = width > 0 ? (lenX / width) : 1;
                
                const dyY = (tlPsd.y - blPsd.y) * signY;
                const dxY = (tlPsd.x - blPsd.x) * signY;
                const lenY = Math.sqrt(dxY * dxY + dyY * dyY);
                const scaleYRelative = height > 0 ? (lenY / height) : 1;

                const sx = localScaleX < 0 ? -scaleXRelative : scaleXRelative;
                const sy = localScaleY < 0 ? -scaleYRelative : scaleYRelative;

                return {
                    box: {
                        left: Math.round(left),
                        top: Math.round(top),
                        width: Math.round(Math.max(1, right - left)),
                        height: Math.round(Math.max(1, bottom - top))
                    },
                    angle: angleRelative,
                    scaleX: sx,
                    scaleY: sy
                };
            }

            // 2. Sprite 纹理像素提取与缩放/旋转变换
            function rasterizeSprite(sprite, transform) {
                if (!sprite || !sprite.spriteFrame) return null;
                const spriteFrame = sprite.spriteFrame;
                const texture = spriteFrame.getTexture();
                if (!texture) return null;
                const img = getTextureCanvasOrImage(texture);
                if (!img) return null;

                const { box, angle, scaleX, scaleY } = transform;

                const canvas = document.createElement('canvas');
                canvas.width = box.width;
                canvas.height = box.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;

                const rect = spriteFrame.getRect();
                const rotated = spriteFrame.isRotated();
                const offset = spriteFrame.getOffset();
                const originalSize = spriteFrame.getOriginalSize();

                // 判断是否需要应用空白剔除的裁剪边距 (Trim)
                // Cocos Creator 在 trim 启用且不是九宫格(Type.SLICED)的情况下才会保留透明边距
                const useTrim = sprite.trim && sprite.type !== 1;

                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                if (!tempCtx) return null;

                if (useTrim) {
                    const origW = Math.max(2, originalSize.width) || 2;
                    const origH = Math.max(2, originalSize.height) || 2;
                    tempCanvas.width = origW;
                    tempCanvas.height = origH;

                    tempCtx.save();
                    if (rotated) {
                        const cx = origW / 2 + offset.x;
                        const cy = origH / 2 - offset.y;
                        tempCtx.translate(cx, cy);
                        tempCtx.rotate(-Math.PI / 2);
                        // 修正：无论旋转与否，在图集中裁剪的原始尺寸都是 rect.width 和 rect.height
                        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
                    } else {
                        const dx = origW / 2 - rect.width / 2 + offset.x;
                        const dy = origH / 2 - rect.height / 2 - offset.y;
                        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, dx, dy, rect.width, rect.height);
                    }
                    tempCtx.restore();
                } else {
                    // 如果不使用 trim，直接渲染原图切片本身，不补充 transparent 外边距
                    const unrotatedW = rotated ? rect.height : rect.width;
                    const unrotatedH = rotated ? rect.width : rect.height;
                    const rectW = Math.max(2, unrotatedW) || 2;
                    const rectH = Math.max(2, unrotatedH) || 2;
                    tempCanvas.width = rectW;
                    tempCanvas.height = rectH;

                    tempCtx.save();
                    if (rotated) {
                        tempCtx.translate(rectW / 2, rectH / 2);
                        tempCtx.rotate(-Math.PI / 2);
                        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
                    } else {
                        tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
                    }
                    tempCtx.restore();
                }

                const nodeWorldCenter = sprite.node.convertToWorldSpaceAR(window.cc.v2(0, 0));
                const nodeLocalCenter = rootNode.convertToNodeSpaceAR(nodeWorldCenter);
                const nodePsdCenter = {
                    x: nodeLocalCenter.x + rootAnchorX * rootWidth,
                    y: rootHeight - (nodeLocalCenter.y + rootAnchorY * rootHeight)
                };
                const rx = nodePsdCenter.x - box.left;
                const ry = nodePsdCenter.y - box.top;

                ctx.translate(rx, ry);
                ctx.rotate(angle);
                ctx.scale(scaleX, scaleY);

                const ax = sprite.node.anchorX;
                const ay = sprite.node.anchorY;
                ctx.globalAlpha = (sprite.node.opacity !== undefined ? sprite.node.opacity : 255) / 255;
                
                const drawW = sprite.node.width;
                const drawH = sprite.node.height;

                // 9宫格绘制辅助函数 (带 Trim 透明边距扣除与 1px 纯色采样)
                function drawNineSlice(targetCtx, srcCanvas, w, h, ax, ay, insetL, insetR, insetT, insetB) {
                    const imgW = srcCanvas.width;
                    const imgH = srcCanvas.height;
                    const x0 = -ax * w;
                    const y0 = -(1 - ay) * h;

                    // 计算因图集 Trim 产生的左/右/上/下透明偏移，修正物理切片 inset
                    const trimLeft = Math.max(0, originalSize.width / 2 - rect.width / 2 + offset.x);
                    const trimRight = Math.max(0, originalSize.width / 2 - rect.width / 2 - offset.x);
                    const trimTop = Math.max(0, originalSize.height / 2 - rect.height / 2 - offset.y);
                    const trimBottom = Math.max(0, originalSize.height / 2 - rect.height / 2 + offset.y);

                    const effectiveInsetL = Math.max(0, insetL - trimLeft);
                    const effectiveInsetR = Math.max(0, insetR - trimRight);
                    const effectiveInsetT = Math.max(0, insetT - trimTop);
                    const effectiveInsetB = Math.max(0, insetB - trimBottom);

                    let sL = effectiveInsetL;
                    let sR = effectiveInsetR;
                    if (sL + sR >= imgW && (sL + sR) > 0) {
                        const ratio = imgW / (sL + sR);
                        sL = Math.floor(sL * ratio);
                        sR = imgW - sL;
                    }
                    const srcX0 = 0;
                    const srcX1 = sL;
                    const srcX2 = Math.max(sL, imgW - sR);
                    const srcX3 = imgW;

                    let sT = effectiveInsetT;
                    let sB = effectiveInsetB;
                    if (sT + sB >= imgH && (sT + sB) > 0) {
                        const ratio = imgH / (sT + sB);
                        sT = Math.floor(sT * ratio);
                        sB = imgH - sT;
                    }
                    const srcY0 = 0;
                    const srcY1 = sT;
                    const srcY2 = Math.max(sT, imgH - sB);
                    const srcY3 = imgH;

                    let dL = insetL;
                    let dR = insetR;
                    if (dL + dR > w && (dL + dR) > 0) {
                        const ratio = w / (dL + dR);
                        dL = dL * ratio;
                        dR = w - dL;
                    }
                    const dstX0 = x0;
                    const dstX1 = x0 + dL;
                    const dstX2 = x0 + w - dR;
                    const dstX3 = x0 + w;

                    let dT = insetT;
                    let dB = insetB;
                    if (dT + dB > h && (dT + dB) > 0) {
                        const ratio = h / (dT + dB);
                        dT = dT * ratio;
                        dB = h - dT;
                    }
                    const dstY0 = y0;
                    const dstY1 = y0 + dT;
                    const dstY2 = y0 + h - dB;
                    const dstY3 = y0 + h;

                    const sXs = [[srcX0, srcX1], [srcX1, Math.max(srcX1 + 1, srcX2)], [srcX2, srcX3]];
                    const sYs = [[srcY0, srcY1], [srcY1, Math.max(srcY1 + 1, srcY2)], [srcY2, srcY3]];
                    const dXs = [[dstX0, dstX1], [dstX1, dstX2], [dstX2, dstX3]];
                    const dYs = [[dstY0, dstY1], [dstY1, dstY2], [dstY2, dstY3]];

                    for (let row = 0; row < 3; row++) {
                        const [sy1, sy2] = sYs[row];
                        const [dy1, dy2] = dYs[row];
                        const sh = sy2 - sy1;
                        const dh = dy2 - dy1;
                        if (sh <= 0 || dh <= 0) continue;

                        for (let col = 0; col < 3; col++) {
                            const [sx1, sx2] = sXs[col];
                            const [dx1, dx2] = dXs[col];
                            const sw = sx2 - sx1;
                            const dw = dx2 - dx1;

                            if (sw > 0 && dw > 0) {
                                targetCtx.drawImage(srcCanvas, sx1, sy1, sw, sh, dx1, dy1, dw, dh);
                            }
                        }
                    }
                }

                const isSliced = sprite.type === 1; // 1 为 cc.Sprite.Type.SLICED
                const hasInsets = (spriteFrame.insetLeft > 0 || spriteFrame.insetRight > 0 || spriteFrame.insetTop > 0 || spriteFrame.insetBottom > 0);

                if (isSliced && hasInsets) {
                    drawNineSlice(ctx, tempCanvas, drawW, drawH, ax, ay, 
                                  spriteFrame.insetLeft, spriteFrame.insetRight, 
                                  spriteFrame.insetTop, spriteFrame.insetBottom);
                } else {
                    ctx.drawImage(tempCanvas, -ax * drawW, -(1 - ay) * drawH, drawW, drawH);
                }

                const color = sprite.node.color;
                if (color && (color.r !== 255 || color.g !== 255 || color.b !== 255)) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
                    ctx.fillRect(-ax * drawW, -(1 - ay) * drawH, drawW, drawH);
                    ctx.restore();
                }

                return canvas.toDataURL('image/png');
            }

            // 3. Label 文字栅格化
            function rasterizeLabel(label, transform) {
                if (!label || !label.string) return null;
                const { box, angle, scaleX, scaleY } = transform;

                const canvas = document.createElement('canvas');
                canvas.width = box.width;
                canvas.height = box.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;

                const nodeWorldCenter = label.node.convertToWorldSpaceAR(window.cc.v2(0, 0));
                const nodeLocalCenter = rootNode.convertToNodeSpaceAR(nodeWorldCenter);
                const nodePsdCenter = {
                    x: nodeLocalCenter.x + rootAnchorX * rootWidth,
                    y: rootHeight - (nodeLocalCenter.y + rootAnchorY * rootHeight)
                };
                const rx = nodePsdCenter.x - box.left;
                const ry = nodePsdCenter.y - box.top;

                ctx.translate(rx, ry);
                ctx.rotate(angle);
                ctx.scale(scaleX, scaleY);

                const fontSize = label.fontSize || 20;
                let fontFamily = label.fontFamily || 'Arial';
                
                // 解决自定义 TTF 字体映射
                if (label.font && !label.useSystemFont) {
                    fontFamily = label.font._fontFamily || label.font.name || label.font._name || fontFamily;
                }
                
                ctx.font = `${fontSize}px ${fontFamily}`;

                let textX = 0;
                let textAlign = 'center';
                const ax = label.node.anchorX !== undefined ? label.node.anchorX : 0.5;
                const width = label.node.width || 0;

                // 核心算法修正：计算相对于 Canvas 边界盒的绝对 X 位置而非直接在 0 处绘制
                if (label.horizontalAlign === 0) {
                    textAlign = 'left';
                    textX = -ax * width;
                } else if (label.horizontalAlign === 2) {
                    textAlign = 'right';
                    textX = (1 - ax) * width;
                } else {
                    textAlign = 'center';
                    textX = (0.5 - ax) * width;
                }
                ctx.textAlign = textAlign;

                const ay = label.node.anchorY !== undefined ? label.node.anchorY : 0.5;
                const height = label.node.height || 0;

                // 换行拆分与自动包装算法
                const lines = [];
                if (label.enableWrapText && label.overflow !== 0 && width > 0) {
                    const rawString = label.string;
                    let currentLine = '';
                    for (let i = 0; i < rawString.length; i++) {
                        const char = rawString[i];
                        if (char === '\n') {
                            lines.push(currentLine);
                            currentLine = '';
                            continue;
                        }
                        const testLine = currentLine + char;
                        const metrics = ctx.measureText(testLine);
                        if (metrics.width > width && currentLine !== '') {
                            lines.push(currentLine);
                            currentLine = char;
                        } else {
                            currentLine = testLine;
                        }
                    }
                    if (currentLine !== '') {
                        lines.push(currentLine);
                    }
                } else {
                    lines.push(...label.string.split('\n'));
                }

                const lineHeight = label.lineHeight || fontSize * 1.25;
                const totalHeight = lines.length * lineHeight;

                let startY = 0;
                const verticalAlign = label.verticalAlign;
                if (verticalAlign === 0) {
                    startY = -(1 - ay) * height;
                } else if (verticalAlign === 2) {
                    startY = ay * height - totalHeight;
                } else {
                    startY = -(0.5 - ay) * height - totalHeight / 2;
                }

                ctx.textBaseline = 'top';

                const color = label.node.color || {r: 255, g: 255, b: 255};
                ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
                ctx.globalAlpha = (label.node.opacity !== undefined ? label.node.opacity : 255) / 255;

                const outline = label.node.getComponent(window.cc.LabelOutline);
                for (let i = 0; i < lines.length; i++) {
                    const lineY = startY + i * lineHeight;
                    if (outline && outline.enabled) {
                        ctx.strokeStyle = `rgb(${outline.color.r},${outline.color.g},${outline.color.b})`;
                        ctx.lineWidth = outline.width * 2;
                        ctx.strokeText(lines[i], textX, lineY);
                    }
                    ctx.fillText(lines[i], textX, lineY);
                }
                return canvas.toDataURL('image/png');
            }

            // 3.5 Skeletal 骨骼动画 (Spine/DragonBones) 节点相机截图
            function rasterizeSkeletal(node, transform) {
                const eng = window.cc;
                const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || 
                                  node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
                
                // 1. 强制更新骨骼姿态 RenderData
                if (spineComp) {
                    if (typeof spineComp._updateRenderData === 'function') {
                        try { spineComp._updateRenderData(); } catch(e) {}
                    }
                }

                // 2. 获取真实世界包围盒
                let wBox = null;
                if (typeof node.getBoundingBoxToWorld === 'function') {
                    try { wBox = node.getBoundingBoxToWorld(); } catch(e) {}
                }
                if (!wBox || wBox.width <= 2 || wBox.height <= 2) {
                    const w = Math.max(2, Math.round(node.width)) || 100;
                    const h = Math.max(2, Math.round(node.height)) || 100;
                    const worldPos = node.convertToWorldSpaceAR(eng.v2(0, 0));
                    wBox = new eng.Rect(worldPos.x - w / 2, worldPos.y - h / 2, w, h);
                }

                const width = Math.max(2, Math.round(wBox.width));
                const height = Math.max(2, Math.round(wBox.height));

                const scene = eng.director.getScene();
                if (!scene) return null;

                let cameraNode = null;
                let rt = null;
                try {
                    // 挂载在 scene 根节点下的独立世界坐标系相机，消除父节点 scale / anchor 偏移打乱
                    cameraNode = new eng.Node('__mcp_temp_spine_camera');
                    scene.addChild(cameraNode);

                    const worldCenterX = wBox.x + wBox.width / 2;
                    const worldCenterY = wBox.y + wBox.height / 2;
                    cameraNode.setPosition(worldCenterX, worldCenterY);

                    const camera = cameraNode.addComponent(eng.Camera);
                    camera.ortho = true;
                    camera.orthoSize = height / 2;
                    camera.cullingMask = 0xffffffff;
                    camera.clearFlags = eng.Camera.ClearFlags.COLOR;
                    camera.backgroundColor = new eng.Color(0, 0, 0, 0);

                    rt = new eng.RenderTexture();
                    rt.initWithSize(width, height);
                    camera.targetTexture = rt;

                    // 手动渲染该节点及其子树
                    camera.render(node);

                    const pixels = rt.readPixels();
                    if (!pixels || pixels.length === 0) return null;

                    // 检查像素数组是否全为透明全零
                    let hasAlpha = false;
                    for (let i = 3; i < pixels.length; i += 4) {
                        if (pixels[i] > 0) {
                            hasAlpha = true;
                            break;
                        }
                    }

                    if (!hasAlpha) {
                        return null;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return null;

                    const imgData = ctx.createImageData(width, height);
                    imgData.data.set(pixels);
                    ctx.putImageData(imgData, 0, 0);

                    const flipCanvas = document.createElement('canvas');
                    flipCanvas.width = width;
                    flipCanvas.height = height;
                    const flipCtx = flipCanvas.getContext('2d');
                    if (flipCtx) {
                        flipCtx.translate(0, height);
                        flipCtx.scale(1, -1);
                        flipCtx.drawImage(canvas, 0, 0);
                        return flipCanvas.toDataURL('image/png');
                    }
                    return canvas.toDataURL('image/png');
                } catch (e) {
                    return null;
                } finally {
                    if (cameraNode) {
                        cameraNode.removeFromParent();
                        cameraNode.destroy();
                    }
                    if (rt) {
                        rt.destroy();
                    }
                }
            }

            // 4. DFS 遍历生成
            function traverse(node, results) {
                if (!node || node.active === false) return;
                
                let hasChildren = node.childrenCount > 0;
                let sprite = node.getComponent(window.cc.Sprite);
                let label = node.getComponent(window.cc.Label);
                
                // 检测是否为骨骼动画节点
                let isSkeletal = false;
                const eng = window.cc;
                if (window.sp && window.sp.Skeleton && node.getComponent(window.sp.Skeleton)) {
                    isSkeletal = true;
                } else if (window.dragonBones && window.dragonBones.ArmatureDisplay && node.getComponent(window.dragonBones.ArmatureDisplay)) {
                    isSkeletal = true;
                } else {
                    const comps = node._components || [];
                    for (let i = 0; i < comps.length; i++) {
                        if (comps[i] && comps[i].constructor) {
                            const name = comps[i].constructor.name;
                            if (name === 'Skeleton' || name === 'ArmatureDisplay') {
                                isSkeletal = true;
                                break;
                            }
                        }
                    }
                }

                if (hasChildren && !isSkeletal) {
                    // 为容器节点创建组文件夹
                    results.push({
                        name: node.name,
                        type: 'group',
                        left: 0, top: 0, width: 0, height: 0,
                        opacity: node.opacity !== undefined ? node.opacity : 255,
                        visible: node.active !== false
                    });

                    // 如果容器节点自身带有 Sprite 或 Label，作为背景/内容图层插入到该组文件夹最底层
                    if (sprite || label) {
                        const transform = getRelativeTransform(node);
                        let imgBase64 = null;
                        if (sprite) {
                            try { imgBase64 = rasterizeSprite(sprite, transform); } catch(e) {}
                        } else if (label) {
                            try { imgBase64 = rasterizeLabel(label, transform); } catch(e) {}
                        }
                        if (imgBase64) {
                            results.push({
                                name: node.name + "_bg",
                                type: 'image',
                                left: transform.box.left,
                                top: transform.box.top,
                                width: transform.box.width,
                                height: transform.box.height,
                                opacity: node.opacity !== undefined ? node.opacity : 255,
                                visible: node.active !== false,
                                imageBase64: imgBase64
                            });
                        }
                    }

                    // 遍历子节点
                    for (let i = 0; i < node.childrenCount; i++) {
                        traverse(node.children[i], results);
                    }

                    // 闭合文件夹
                    results.push({
                        name: node.name,
                        type: 'group_end',
                        left: 0, top: 0, width: 0, height: 0,
                        opacity: 0, visible: false
                    });
                } else {
                    // 叶子节点直接导出图片/文字/骨骼图层
                    if (sprite || label || isSkeletal) {
                        const transform = getRelativeTransform(node);
                        let imgBase64 = null;
                        if (isSkeletal) {
                            try { imgBase64 = rasterizeSkeletal(node, transform); } catch(e) {}
                        } else if (sprite) {
                            try { imgBase64 = rasterizeSprite(sprite, transform); } catch(e) {}
                        } else if (label) {
                            try { imgBase64 = rasterizeLabel(label, transform); } catch(e) {}
                        }
                        if (imgBase64) {
                            results.push({
                                name: node.name,
                                type: 'image',
                                left: transform.box.left,
                                top: transform.box.top,
                                width: transform.box.width,
                                height: transform.box.height,
                                opacity: node.opacity !== undefined ? node.opacity : 255,
                                visible: node.active !== false,
                                imageBase64: imgBase64
                            });
                        }
                    }
                }
            }

            traverse(rootNode, exportList);
            return JSON.stringify({
                width: Math.round(rootWidth),
                height: Math.round(rootHeight),
                layers: exportList
            });
        }
    };
}

export { syncNodeTree };
