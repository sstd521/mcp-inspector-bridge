// 场景内真正负责修改编辑器状态的脚本
module.exports = {
    'resolve-prefab-node-by-index-path': function (event: any, args: { prefabUuid: string, childIndexPath: number[] }) {
        try {
            const scene = (window as any).cc.director.getScene();
            const findRoot = (node: any): any => {
                if (!node) return null;
                const prefab = node._prefab;
                const asset = prefab && prefab.root === node && prefab.asset;
                const assetUuid = asset && (asset._uuid || asset.uuid || asset.id);
                if (assetUuid === args.prefabUuid) return node;
                for (const child of node.children || []) {
                    const found = findRoot(child);
                    if (found) return found;
                }
                return null;
            };
            let current = findRoot(scene);
            for (const index of args.childIndexPath || []) {
                current = current && current.children && current.children[index];
                if (!current) break;
            }
            const uuid = current ? current.uuid : null;
            if (event.reply) event.reply(null, uuid);
            return uuid;
        } catch (error: any) {
            if (event.reply) event.reply(error);
            return null;
        }
    },
    'set-property': function (event: any, args: { uuid: string, compName: string | null, compIndex?: number, propKey: string, value: any }) {
        const eng = (window as any).cc;
        if (!eng || !eng.engine) {
            if (event.reply) event.reply(new Error("Engine not running in scene"));
            return;
        }

        const node = eng.engine.getInstanceById(args.uuid);
        if (!node) {
            if (event.reply) event.reply(new Error(`Node ${args.uuid} not found in scene`));
            return;
        }

        try {
            if (args.compIndex !== undefined) {
                const comp = node._components[args.compIndex];
                if (comp) {
                    comp[args.propKey] = args.value;
                    
                    if (comp.name === 'cc.Widget' || comp.name === 'Widget<cc.Widget>') {
                        const payload: any = {};
                        payload['alignMode'] = comp.alignMode;
                        payload['alignFlags'] = comp.alignFlags !== undefined ? comp.alignFlags : comp._alignFlags;
                        payload['left'] = comp.left !== undefined ? comp.left : comp._left;
                        payload['right'] = comp.right !== undefined ? comp.right : comp._right;
                        payload['top'] = comp.top !== undefined ? comp.top : comp._top;
                        payload['bottom'] = comp.bottom !== undefined ? comp.bottom : comp._bottom;
                        payload['verticalCenter'] = comp.verticalCenter !== undefined ? comp.verticalCenter : comp._verticalCenter;
                        payload['horizontalCenter'] = comp.horizontalCenter !== undefined ? comp.horizontalCenter : comp._horizontalCenter;
                        payload['isAbsoluteLeft'] = comp.isAbsoluteLeft !== undefined ? comp.isAbsoluteLeft : comp._isAbsLeft;
                        payload['isAbsoluteRight'] = comp.isAbsoluteRight !== undefined ? comp.isAbsoluteRight : comp._isAbsRight;
                        payload['isAbsoluteTop'] = comp.isAbsoluteTop !== undefined ? comp.isAbsoluteTop : comp._isAbsTop;
                        payload['isAbsoluteBottom'] = comp.isAbsoluteBottom !== undefined ? comp.isAbsoluteBottom : comp._isAbsBottom;
                        payload['isAbsoluteHorizontalCenter'] = comp.isAbsoluteHorizontalCenter !== undefined ? comp.isAbsoluteHorizontalCenter : comp._isAbsHorizontalCenter;
                        payload['isAbsoluteVerticalCenter'] = comp.isAbsoluteVerticalCenter !== undefined ? comp.isAbsoluteVerticalCenter : comp._isAbsVerticalCenter;
                        if (args.propKey === 'enabled') {
                            payload['enabled'] = args.value;
                        }
                        
                        // Force layout update for existing widget
                        if (typeof comp.updateAlignment === 'function') {
                            comp.updateAlignment();
                        }
                        
                        if (event.reply) event.reply(null, payload);
                        return;
                    }
                    
                    if (args.propKey === 'enabled') {
                        if (event.reply) event.reply(null, { 'enabled': args.value });
                        return;
                    }
                    
                } else {
                    if (event.reply) event.reply(new Error(`Component at index ${args.compIndex} not found`));
                    return;
                }
            } else if (args.compName) {
                const comp = node.getComponent(args.compName);
                if (comp) {
                    comp[args.propKey] = args.value;
                } else {
                    if (event.reply) event.reply(new Error(`Component ${args.compName} not found`));
                    return;
                }
            } else {
                if (args.propKey === 'rotation') {
                    if ('angle' in node) {
                        node.angle = -args.value;
                    } else {
                        node.rotation = args.value;
                    }
                } else if (args.propKey in node) {
                    node[args.propKey] = args.value;
                } else {
                    if (event.reply) event.reply(new Error(`Property ${args.propKey} not found in node`));
                    return;
                }
            }
            if (event.reply) event.reply(null, true);
        } catch (e: any) {
            if (event.reply) event.reply(new Error(e.message || String(e)));
        }
    }
};
