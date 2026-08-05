# 选取器选中节点自动切换节点树 Tab 并定位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户在场景视图中使用 🎯 节点拾取器选中节点时，如果当前面板标签页不在节点树，自动切换至节点树 Tab 并在 DOM 渲染完成后展开高亮居中显示该节点。

**Architecture:** 在 `useNodeSystem` 中建立并导出统一的节点跨 Tab 定位方法 `locateAndExpandNode(uuid)`。将其传递给 `useGameView`，在监听到 `node-picker-selected` 频道消息时调用。

**Tech Stack:** TypeScript, Vue 3 (Composition API - `ref`, `nextTick`), Cocos Creator Panel IPC.

## Global Constraints

- 必须使用简体中文进行所有代码注释 (JSDoc/inline comments)。
- 必须保持全 TS 文件开发，不引入新的 JS 文件。
- 遵循 Cocos Inspector 既有架构，不新增重构库。

---

### Task 1: 在 `useNodeSystem` 中实现并导出 `locateAndExpandNode`

**Files:**
- Modify: `c:\Users\Firekula\.CocosCreator\packages\mcp-inspector-bridge\src\panel\composables\useNodeSystem.ts`

**Interfaces:**
- Produces: `locateAndExpandNode(uuid: string): void`

- [ ] **Step 1: 编写 `locateAndExpandNode` 函数并重构 `onRenderDebuggerLocate`**

在 `useNodeSystem.ts` 中添加：
```typescript
    /**
     * 定位并展开指定 UUID 的节点（包含自动切换至节点树 Tab 逻辑）
     * @param uuid 目标节点 UUID
     */
    const locateAndExpandNode = (uuid: string) => {
        if (!uuid) return;
        activeTab.value = 0; // 自动切换至节点树 Tab
        nextTick(() => {
            const nt: any = nodeTreeRef.value;
            if (nt && typeof nt.expandToNode === 'function') {
                const success = nt.expandToNode(uuid);
                if (!success) {
                    console.warn(`[Bridge] 节点树缓存中未找到节点(UUID: ${uuid})，启用属性兜底同步`);
                    onNodeSelect({ id: uuid }, true);
                    try {
                        const syncCode = "if(window.__mcpSyncNodeTree) { window.__mcpSyncNodeTree(); }";
                        const wv: any = gameView.value;
                        if (wv && typeof wv.executeJavaScript === 'function') {
                            wv.executeJavaScript(syncCode).catch(() => {});
                        }
                    } catch(err) {}
                }
            } else {
                onNodeSelect({ id: uuid }, true);
            }
        });
    };

    const onRenderDebuggerLocate = (id: string) => {
        locateAndExpandNode(id);
    };
```

- [ ] **Step 2: 在 `useNodeSystem` 返回对象中导出 `locateAndExpandNode`**

```typescript
    return {
        onNodeSelect,
        onNodeHover,
        onUpdateNodeProp,
        toggleNodePicker,
        onRenderDebuggerToggle,
        onRenderDebuggerLocate,
        locateAndExpandNode,
        locateResource,
        onLocateNode,
        onLocateAsset,
        onPrintComp,
        onPrintNode,
        exportNodeAsPsd
    };
```

---

### Task 2: 更新 `useGameView` 参数并接入 `node-picker-selected` 事件处理

**Files:**
- Modify: `c:\Users\Firekula\.CocosCreator\packages\mcp-inspector-bridge\src\panel\composables\useGameView.ts`
- Modify: `c:\Users\Firekula\.CocosCreator\packages\mcp-inspector-bridge\src\panel\index.ts`

**Interfaces:**
- Consumes: `locateAndExpandNode: (uuid: string) => void` from `useNodeSystem`

- [ ] **Step 1: 在 `useGameView` 签名中增加 `locateAndExpandNode` 参数**

修改 `src/panel/composables/useGameView.ts` 的 `useGameView` 入参：
```typescript
export function useGameView(
    globalState: any,
    gameView: any,
    nodeTreeRef: any,
    rightPanelWidth: any,
    selectedResolution: any,
    onNodeSelectFallback: any,
    onStartPolling?: () => void,
    onStopPolling?: () => void,
    locateAndExpandNode?: (uuid: string) => void
)
```

- [ ] **Step 2: 修改 `useGameView.ts` 中的 `node-picker-selected` 处理**

```typescript
                } else if (event.channel === 'node-picker-selected') {
                    const uuid = event.args[0];
                    console.log(`[IPC Received] <- node-picker-selected: uuid=${uuid || 'null'}`);
                    console.log(`[Selection-Debug] Trigger: IPC-GameView-node-picker-selected | NodeID: ${uuid} | Proceeding to sync expandToNode...`);
                    try {
                        globalState.isNodePickerActive = false;
                        if (uuid) {
                            if (typeof locateAndExpandNode === 'function') {
                                locateAndExpandNode(uuid);
                            } else {
                                const nt: any = nodeTreeRef.value;
                                if (nt && typeof nt.expandToNode === 'function') {
                                    nt.expandToNode(uuid);
                                } else {
                                    onNodeSelectFallback({ id: uuid }, true);
                                }
                            }
                        } else {
                            globalState.nodeDetail = null;
                            const nt: any = nodeTreeRef.value;
                            if (nt) nt.selectedId = '';
                        }
                    } catch (err) { }
```

- [ ] **Step 3: 修改 `src/panel/index.ts` 传递 `locateAndExpandNode`**

修改 `index.ts` 中 `gameViewSystem` 实例化部分：
```typescript
                const gameViewSystem = useGameView(
                    globalState,
                    gameView,
                    nodeTreeRef,
                    layoutSystem.rightPanelWidth,
                    layoutSystem.selectedResolution,
                    (payload: any, auto: boolean) => nodeSystem.onNodeSelect(payload, auto),
                    () => profilerSystem.startTickPolling(),
                    () => profilerSystem.stopTickPolling(),
                    (uuid: string) => nodeSystem.locateAndExpandNode(uuid)
                );
```

---

### Task 3: 构建与类型/运行验证

**Files:**
- Target: `c:\Users\Firekula\.CocosCreator\packages\mcp-inspector-bridge`

- [ ] **Step 1: 运行 TypeScript 编译/打包验证**

在 PowerShell 命令行运行项目构建逻辑 (npm run build 或 equivalent tsc)，检查无编译语法与类型报错。
