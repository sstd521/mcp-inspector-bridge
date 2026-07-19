const { nextTick, onUnmounted } = require('vue');
declare const Editor: any;

export function normalizeEditorUuid(uuid: unknown): string {
    if (typeof uuid !== 'string' || !uuid) return '';
    if (uuid.length !== 22 && uuid.length !== 23) return uuid;
    try {
        return Editor.Utils.UuidUtils.decompressUuid(uuid);
    } catch (_) {
        return uuid;
    }
}

export function toSerializableNodeDetail(detail: any) {
    const rawPath = detail && Array.isArray(detail.prefabChildIndexPath)
        ? detail.prefabChildIndexPath
        : [];
    return {
        id: detail && detail.id ? String(detail.id) : '',
        prefabUuid: detail && detail.prefabUuid ? String(detail.prefabUuid) : '',
        // Vue 的 reactive Array 是 Proxy，Electron 7 IPC 无法 structured-clone。
        prefabChildIndexPath: Array.from(rawPath, (index: any) => Number(index)),
    };
}

export function locateEditorAsset(uuid: string): boolean {
    const targetUuid = normalizeEditorUuid(uuid);
    if (!targetUuid || typeof Editor === 'undefined' || !Editor.Ipc) return false;
    Editor.Ipc.sendToAll('assets:clearSearch');
    Editor.Ipc.sendToAll('assets:hint', targetUuid);
    if (Editor.Selection && Editor.Selection.select) {
        Editor.Selection.select('asset', targetUuid);
    }
    return true;
}

export function openEditorScript(uuid: string): boolean {
    const targetUuid = normalizeEditorUuid(uuid);
    if (!targetUuid || typeof Editor === 'undefined' || !Editor.Ipc) return false;
    Editor.Ipc.sendToMain('assets:open-text-file', targetUuid);
    return true;
}

export function openEditorUuidLookup(uuid: string): boolean {
    const targetUuid = normalizeEditorUuid(uuid);
    if (!targetUuid || typeof Editor === 'undefined' || !Editor.Ipc) return false;
    let delay = 2000;
    try {
        if (Editor.Panel && Editor.Panel.findWindow && Editor.Panel.findWindow('uuid_lookup')) delay = 0;
    } catch (_) {}
    Editor.Ipc.sendToMain('uuid_lookup:open-panel');
    // uuid_lookup 首次创建面板约需 2 秒；过早发送查询会被直接丢弃。
    setTimeout(() => Editor.Ipc.sendToAll('uuid-lookup:query', targetUuid), delay);
    return true;
}

export function openEditorAsset(uuid: string): boolean {
    const targetUuid = normalizeEditorUuid(uuid);
    if (!targetUuid || typeof Editor === 'undefined' || !Editor.Ipc) return false;
    // Creator 2.4 的面板进程不保证暴露 Editor.Package，交给插件主进程按真实包名检测。
    Editor.Ipc.sendToMain('mcp-inspector-bridge:open-asset-with-uuid-lookup', targetUuid);
    return true;
}

export function useNodeSystem(globalState: any, gameView: any, nodeTreeRef: any, activeTab: any, devToolsSystem: any) {
    
    const syncNodeDetail = (oldObj: any, newObj: any) => {
        if (!oldObj || oldObj.id !== newObj.id) return newObj;
        for (let key in newObj) {
            if (key !== 'components') oldObj[key] = newObj[key];
        }
        if (oldObj.components && newObj.components && oldObj.components.length === newObj.components.length) {
            for (let i = 0; i < newObj.components.length; i++) {
                const oComp = oldObj.components[i];
                const nComp = newObj.components[i];
                oComp.enabled = nComp.enabled;
                oComp.name = nComp.name;
                oComp.realIndex = nComp.realIndex;
                oComp.scriptUuid = nComp.scriptUuid;
                oComp.buttonClickEvents = nComp.buttonClickEvents;
                oComp.methods = nComp.methods;
                if (oComp.properties && nComp.properties) {
                    const pMap: Record<string, any> = {};
                    oComp.properties.forEach((p: any) => pMap[p.key] = p);
                    nComp.properties.forEach((np: any) => {
                        if (pMap[np.key]) {
                            pMap[np.key].value = np.value;
                        } else {
                            oComp.properties.push(np); 
                        }
                    });
                }
            }
        } else {
            oldObj.components = newObj.components;
        }
        return oldObj;
    };

    const isWebViewReady = (wv: any): boolean => {
        if (!wv) return false;
        if (typeof wv.isConnected === 'boolean' && !wv.isConnected) return false;
        try {
            const id = wv.getWebContentsId();
            if (!id || id <= 0) return false;
            return true;
        } catch (e) {
            return false;
        }
    };

    const onNodeSelect = (node: any, isAutoRefresh: boolean = false) => {
        console.log(`[Vue Store Update] onNodeSelect triggered: id=${node ? node.id : 'null'}, autoRefresh=${isAutoRefresh}`);
        console.log(`[Selection-Debug] Trigger: Panel-onNodeSelect | NodeID: ${node ? node.id : 'null'} | AutoRefresh: ${isAutoRefresh} -> Sending setSelectionTarget to WebView`);
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            try {
                const selCode = `if(window.__mcpCrawler && window.__mcpCrawler.setSelectionTarget){ window.__mcpCrawler.setSelectionTarget(${node ? "'" + node.id + "'" : "null"}); }`;
                wv.executeJavaScript(selCode).catch(() => {});
            } catch (e) {}

            if (!node) {
                if (!isAutoRefresh) globalState.nodeDetail = null;
                return;
            }

            const code = `window.__mcpCrawler ? JSON.stringify(window.__mcpCrawler.getNodeDetail('${node.id}')) : null`;
            wv.executeJavaScript(code).then((res: string) => {
                if (res) {
                    const newObj = JSON.parse(res);
                    const updateState = (finalObj: any) => {
                        if (isAutoRefresh && globalState.nodeDetail && globalState.nodeDetail.id === finalObj.id) {
                            syncNodeDetail(globalState.nodeDetail, finalObj);
                        } else {
                            globalState.nodeDetail = Object.assign({}, finalObj);
                        }
                    };

                    if (!newObj.prefabUuid && typeof Editor !== 'undefined' && Editor.Ipc) {
                        try {
                            Editor.Ipc.sendToPanel('scene', 'scene:query-node', node.id, (err: any, dumpObj: any) => {
                                console.log('[Editor Fallback] scene:query-node result for ' + node.id, { err, dumpObj });
                                if (!err && dumpObj) {
                                    try {
                                        const parsedDump = typeof dumpObj === 'string' ? JSON.parse(dumpObj) : dumpObj;
                                        const v = parsedDump.value || parsedDump;
                                        
                                        // A reliable deep search function to locate the asset uuid within the prefab structure
                                        const findUuid = (obj: any, depth = 0): string | null => {
                                            if (!obj || typeof obj !== 'object' || depth > 6) return null;
                                            
                                            // 预制体引用通常存在 asset 节点下，提取其中的 uuid 值 (同时规避提取到当前节点的自身 uuid 或者是 fileId)
                                            if (obj.uuid && typeof obj.uuid === 'string' && obj.uuid.length > 10 && obj.uuid.indexOf('-') !== -1 && obj.uuid !== node.id) {
                                                return obj.uuid;
                                            }
                                            if (obj._uuid && typeof obj._uuid === 'string' && obj._uuid.length > 10 && obj._uuid.indexOf('-') !== -1 && obj._uuid !== node.id) {
                                                return obj._uuid;
                                            }
                                            
                                            // 遍历对象，特别是我们要往 .value, .asset 等深入
                                            for (let key in obj) {
                                                if (key === 'fileId' || key === 'root' || key === 'sync') continue; // 跳过不相关的
                                                const res = findUuid(obj[key], depth + 1);
                                                if (res) return res;
                                            }
                                            return null;
                                        };

                                        // Start looking in the prefab property of the node dump
                                        const prefabDump = v.__prefab__ || (v.prefab && v.prefab.value) || v._prefab;
                                        if (prefabDump) {
                                            const foundId = findUuid(prefabDump);
                                            if (foundId) {
                                                newObj.prefabUuid = foundId;
                                                console.log('[Editor Fallback] Successfully located true prefabUuid:', foundId);
                                            } else {
                                                console.warn('[Editor Fallback] Could not find a valid UUID inside the prefab dump object!', prefabDump);
                                            }
                                        }

                                    } catch (e) {
                                        console.error('[Editor Fallback] Error parsing dump:', e);
                                    }
                                }
                                updateState(newObj);
                            });
                        } catch (e) {
                            console.error('[Editor Fallback] sendToPanel error:', e);
                            updateState(newObj);
                        }
                    } else {
                        updateState(newObj);
                    }
                } else {
                    if (!isAutoRefresh) globalState.nodeDetail = null;
                }
            }).catch(() => {
                if (!isAutoRefresh) globalState.nodeDetail = null;
            });
        }
    };

    const onNodeHover = (node: any) => {
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            try {
                const hoverId = node ? node.id : '';
                const code = `if(window.__mcpCrawler && window.__mcpCrawler.setHoverTarget){ window.__mcpCrawler.setHoverTarget('${hoverId}'); }`;
                wv.executeJavaScript(code).catch(() => {});
            } catch (e) {}
        }
    };

    const onUpdateNodeProp = (payload: any) => {
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            const { uuid, compName, propKey, value, compIndex, arrayIndex } = payload;
            let valStr: string;
            if (typeof value === 'string') {
                valStr = JSON.stringify(value);
            } else if (typeof value === 'object' && value !== null) {
                valStr = JSON.stringify(value);
            } else {
                valStr = String(value);
            }
            const compStr = compName ? '"' + compName + '"' : 'null';
            const arrIdxStr = arrayIndex !== undefined ? arrayIndex : -1;
            
            const code = `
                if (window.__mcpCrawler && typeof window.__mcpCrawler.updateNodeProperty === 'function') {
                    window.__mcpCrawler.updateNodeProperty('${uuid}', ${compStr}, '${propKey}', ${valStr}, ${compIndex !== undefined ? compIndex : -1}, ${arrIdxStr});
                } else {
                    console.error("[MCP Bridge] 致命错误: window.__mcpCrawler.updateNodeProperty 未就绪或丢失。");
                }
            `;
            const __p1 = wv.executeJavaScript(code);
            if (__p1 && __p1.catch) __p1.catch(() => { });

            try {
                if (!globalState.isEditorSceneActive) {
                    console.warn('[Bridge] 场景未激活，拦截了向 Editor 的底层 IPC 调用以防报错');
                    return;
                }
                if (typeof Editor !== 'undefined' && Editor.Ipc) {
                    Editor.Ipc.sendToPanel('scene', 'scene:query-node', uuid, (err: any, dumpObj: any) => {
                        if (err) { return; }
                        try {
                            const dump = typeof dumpObj === 'string' ? JSON.parse(dumpObj) : dumpObj;
                            const comps = dump.value.__comps__ || dump.value.components || dump.__comps__ || dump.components || dump;
                            const fs = require('fs');
                            const p = require('path').join(__dirname, '../../../memory/dump.json');
                            fs.writeFileSync(p, JSON.stringify(comps, null, 2));
                        } catch (e: any) {}
                    });
                }
            } catch (e) {
                console.error('[Bridge Webview Error] Failed to query scene node info:', e);
            }
        }
    };

    const toggleNodePicker = () => {
        globalState.isNodePickerActive = !globalState.isNodePickerActive;
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            const method = globalState.isNodePickerActive ? 'enable' : 'disable';
            const code = `if(window.__mcpNodePicker) window.__mcpNodePicker.${method}();`;
            const p = wv.executeJavaScript(code);
            if (p && p.catch) p.catch(()=>{});
        }
    };

    const onRenderDebuggerToggle = (newVal: boolean) => {
        const wv: any = gameView.value;
        if (!isWebViewReady(wv)) return;
        wv.executeJavaScript(`
                var targetWin = window;
                var frm = document.getElementById('GameDiv');
                if (frm && frm.contentWindow && frm.contentWindow.__mcpRenderDebuggerHook) {
                    targetWin = frm.contentWindow;
                }
                if (targetWin.__mcpRenderDebuggerHook) {
                    if (${newVal}) {
                        targetWin.__mcpRenderDebuggerHook.injectHooks();
                    } else {
                        targetWin.__mcpRenderDebuggerHook.restoreHooks();
                    }
                }
            `).catch((err: any) => console.error("[RenderDebugger] executeJavaScript 抛出异常:", err));
    };

    const onRenderDebuggerLocate = (id: string) => {
        activeTab.value = 0;
        nextTick(() => {
            const nt: any = nodeTreeRef.value;
            if (nt && nt.expandToNode) {
                const success = nt.expandToNode(id);
                if (!success && typeof Editor !== 'undefined') {
                    Editor.warn(`[ RenderDebugger ] 跨视图定位失败：查找不到 UUID 为 ${id} 的节点。`);
                }
            }
        });
    };

    let locateResourceTimer: any = null;
    const locateResource = (res: any) => {
        if (!res || !res.id) return;
        const uuid: string = res.id;
        if (uuid.length < 5 || uuid.startsWith('default-') || uuid.indexOf('preview-') !== -1) return;

        if (locateResourceTimer) clearTimeout(locateResourceTimer);
        locateResourceTimer = setTimeout(() => {
            if (typeof Editor !== 'undefined' && Editor.Ipc) {
                Editor.Ipc.sendToAll('assets:hint', uuid);
            }
        }, 300);
    };

    const onLocateNode = (uuid: string) => {
        if (nodeTreeRef.value) {
            const targetId = uuid;
            const success = (nodeTreeRef.value as any).expandToNode(targetId);
            if (!success) console.warn(`[Bridge] 树组件未能展开节点：${targetId}`);
        }
    };

    const queryScriptAssetInfo = (scriptUuid: string): Promise<any> => new Promise((resolve) => {
        if (!scriptUuid || typeof Editor === 'undefined' || !Editor.Ipc) return resolve(null);
        let settled = false;
        const finish = (info: any) => {
            if (settled) return;
            settled = true;
            resolve(info || null);
        };
        const timer = setTimeout(() => finish(null), 500);
        try {
            Editor.Ipc.sendToMain('mcp-inspector-bridge:query-script-asset-info', scriptUuid, (_err: any, info: any) => {
                clearTimeout(timer);
                finish(info);
            });
        } catch (_) {
            clearTimeout(timer);
            finish(null);
        }
    });

    const onOpenComponentScript = (component: any) => {
        if (component && component.scriptUuid) openEditorScript(component.scriptUuid);
    };

    const onOpenComponentSource = async (component: any) => {
        if (!component || !component.scriptUuid) return;
        const info = await queryScriptAssetInfo(component.scriptUuid);
        const fileName = info && info.fileName ? info.fileName : component.name;
        await devToolsSystem.openSource(fileName);
    };

    const onLocateEditorNode = (detail: any) => {
        if (detail && typeof Editor !== 'undefined') {
            Editor.Ipc.sendToMain('mcp-inspector-bridge:locate-editor-node', toSerializableNodeDetail(detail));
        }
    };

    const onQueryUuidUsage = (uuid: string) => {
        openEditorUuidLookup(uuid);
    };

    const onOpenAsset = (uuid: string) => {
        if (openEditorAsset(uuid)) return;
        locateEditorAsset(uuid);
        if (typeof Editor !== 'undefined') Editor.warn('[Bridge] 无法调用 uuid_lookup，已改为在资源管理器中定位');
    };

    const onComponentMethod = async (component: any, methodName: string) => {
        if (!component || !methodName || !globalState.nodeDetail) return false;
        const wv: any = gameView.value;
        if (!isWebViewReady(wv)) return false;
        const success = await wv.executeJavaScript(
            `window.__mcpCrawler && window.__mcpCrawler.executeComponentMethod(${JSON.stringify(globalState.nodeDetail.id)}, ${Number(component.realIndex)}, ${JSON.stringify(methodName)})`,
        );
        if (!success && typeof Editor !== 'undefined') Editor.warn(`[Bridge] 组件方法调用失败: ${methodName}()`);
        return !!success;
    };

    const onButtonAction = async (action: string, component: any, eventInfo: any) => {
        if (!component || !globalState.nodeDetail) return;
        if (action === 'locate-target') {
            activeTab.value = 0;
            await nextTick();
            const ok = nodeTreeRef.value && (nodeTreeRef.value as any).flashNode(eventInfo.targetUuid);
            if (!ok && typeof Editor !== 'undefined') Editor.warn('[Bridge] Button Target 不在当前节点树中');
            return;
        }
        if (action === 'open-script') {
            if (eventInfo && eventInfo.componentId) openEditorScript(eventInfo.componentId);
            return;
        }

        const wv: any = gameView.value;
        if (!isWebViewReady(wv)) return;
        if (action === 'open-handler') {
            const info = await queryScriptAssetInfo(eventInfo.componentId);
            const fileName = info && info.fileName
                ? info.fileName
                : (eventInfo.scriptComponentName || eventInfo.componentName || '');
            await devToolsSystem.inspectButtonHandler(
                globalState.nodeDetail.id,
                component.realIndex,
                eventInfo.index,
                fileName,
                eventInfo.handlerName,
            );
            return;
        }

        const method = action === 'simulate' ? 'simulateButtonClick' : 'triggerButtonClickHandler';
        const args = action === 'simulate'
            ? `${JSON.stringify(globalState.nodeDetail.id)}, ${component.realIndex}`
            : `${JSON.stringify(globalState.nodeDetail.id)}, ${component.realIndex}, ${eventInfo.index}`;
        const success = await wv.executeJavaScript(`window.__mcpCrawler && window.__mcpCrawler.${method}(${args})`);
        if (!success && typeof Editor !== 'undefined') Editor.warn(`[Bridge] Button 操作失败: ${action}`);
    };

    const onLocateAsset = (uuid: string) => {
        if (!locateEditorAsset(uuid) && typeof Editor !== 'undefined') {
            Editor.warn('[Bridge] 无法在资源管理器中定位资源');
        }
    };

    const onPrintComp = (uuid: string, compIndex: number) => {
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            const code = `
                if (window.__mcpCrawler && typeof window.__mcpCrawler.printComponentData === 'function') {
                    window.__mcpCrawler.printComponentData('${uuid}', ${compIndex});
                }
            `;
            const __p = wv.executeJavaScript(code);
            if (__p && __p.catch) __p.catch(() => {});
        }
    };

    const onPrintNode = (uuid: string) => {
        const wv: any = gameView.value;
        if (isWebViewReady(wv)) {
            const code = `
                if (window.__mcpCrawler && typeof window.__mcpCrawler.printNodeData === 'function') {
                    window.__mcpCrawler.printNodeData('${uuid}');
                }
            `;
            const __p = wv.executeJavaScript(code);
            if (__p && __p.catch) __p.catch(() => {});
        }
    };

    // 自动刷新逻辑
    let autoRefreshTimer: any = null;
    let autoRefreshPaused = false;

    const startAutoRefresh = () => {
        if (autoRefreshTimer) return;
        autoRefreshTimer = setInterval(() => {
            if (autoRefreshPaused) return;
            // 前置拦截：如果在悬停 inspector 面板、未选中节点或者当前选项卡并非游戏视图场景，放弃请求
            if (globalState.isInspectorHovered) return;
            if (globalState.isInspectorFocused) return;
            if (!globalState.nodeDetail || !globalState.nodeDetail.id) return;
            if (activeTab && activeTab.value !== 0) return;

            onNodeSelect({ id: globalState.nodeDetail.id }, true);
        }, 500);
    };

    const stopAutoRefresh = () => {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    };

    startAutoRefresh();

    const _onPanelHide = () => { autoRefreshPaused = true; };
    const _onPanelShow = () => { autoRefreshPaused = false; };
    window.addEventListener('panel-hide', _onPanelHide);
    window.addEventListener('panel-show', _onPanelShow);

    onUnmounted(() => {
        stopAutoRefresh();
        window.removeEventListener('panel-hide', _onPanelHide);
        window.removeEventListener('panel-show', _onPanelShow);
    });

    return {
        onNodeSelect,
        onNodeHover,
        onUpdateNodeProp,
        toggleNodePicker,
        onRenderDebuggerToggle,
        onRenderDebuggerLocate,
        locateResource,
        onLocateNode,
        onLocateAsset,
        onLocateEditorNode,
        onQueryUuidUsage,
        onOpenAsset,
        onOpenComponentScript,
        onOpenComponentSource,
        onComponentMethod,
        onButtonAction,
        onPrintComp,
        onPrintNode
    };
}
