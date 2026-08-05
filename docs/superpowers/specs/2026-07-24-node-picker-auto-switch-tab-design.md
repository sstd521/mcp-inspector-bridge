# 设计规范：节点拾取器自动切换节点树 Tab 并定位 (Node Picker Auto Switch Tab)

## 1. 概述 (Overview)
在使用 Cocos Inspector 场景节点拾取器（🎯 Node Picker）点击场景节点时，若面板当前激活的 Tab 并非“节点树”（`activeTab !== 0`），用户无法直观查看到选中节点在层级树中的位置。
本设计旨在提供统一的节点定位与 Tab 自动切换机制：在选取器选中节点后，自动切换至节点树 Tab，并触发层级展开与居中滚动高亮显示。

---

## 2. 需求与交互逻辑 (Requirements & Behavior)

1. **自动切换 Tab**：
   - 当收到选取器选中节点事件 (`node-picker-selected` 且 `uuid` 有效) 时，若当前 `activeTab !== 0`，自动将 `activeTab.value` 设为 `0` (切换至节点树 Tab)。
2. **DOM 渲染感知定位**：
   - 切换 Tab 后使用 Vue 的 `nextTick` 确保节点树 Tab 对应 DOM 变为可见状态。
   - 调用 `NodeTree` 组件的 `expandToNode(uuid)` 方法，自动展开所有长辈节点并聚焦高亮目标节点。
3. **滚动居中**：
   - 利用 `NodeTree` 中已有的 `scrollIntoView({ behavior: 'smooth', block: 'center' })` 实现平滑居中滚动。
4. **兜底与清洗**：
   - 若节点在树缓存中未找到 (`expandToNode` 返回 `false`)，自动触发 `onNodeSelectFallback` 并给场景端发送 `__mcpSyncNodeTree()` 请求。
   - 若选取器点击空白区域 (`uuid` 为空)，仅取消选取激活状态 (`isNodePickerActive = false`)，清空选中信息，不改变当前的 Tab 激活页。

---

## 3. 架构与组件改动 (Architecture & Implementation Details)

### 3.1 `src/panel/composables/useNodeSystem.ts`
- **新增导出方法 `locateAndExpandNode(uuid: string)`**：
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
  ```
- **复用该方法**：重构 `onRenderDebuggerLocate(id: string)` 使其直接调用 `locateAndExpandNode(id)`，保证全面板“跨视图定位节点”的逻辑完全统一。
- **导出 `locateAndExpandNode`**：在 `useNodeSystem` 返回对象中包含 `locateAndExpandNode`。

### 3.2 `src/panel/composables/useGameView.ts`
- **修改函数签名**：在 `useGameView` 入参中增加 `locateAndExpandNode?: (uuid: string) => void`。
- **修改 `node-picker-selected` 监听响应**：
  ```typescript
  } else if (event.channel === 'node-picker-selected') {
      const uuid = event.args[0];
      console.log(`[IPC Received] <- node-picker-selected: uuid=${uuid || 'null'}`);
      try {
          globalState.isNodePickerActive = false;
          if (uuid) {
              if (typeof locateAndExpandNode === 'function') {
                  locateAndExpandNode(uuid);
              } else {
                  // 兜底降级处理
                  onNodeSelectFallback({ id: uuid }, true);
              }
          } else {
              globalState.nodeDetail = null;
              const nt: any = nodeTreeRef.value;
              if (nt) nt.selectedId = '';
          }
      } catch (err) { }
  }
  ```

### 3.3 `src/panel/index.ts`
- **调整模块组装次序**：
  - `useNodeSystem` 实例化后解构出 `locateAndExpandNode`。
  - 将 `locateAndExpandNode` 作为参数传递给 `useGameView`。

---

## 4. 验证计划 (Verification Plan)

1. **自动切 Tab 验证**：
   - 切换到 DevTools 或 Profiler 标签页。
   - 点击 🎯 选取器图标并在 GameView/Canvas 中点击任意节点。
   - 验证 Tab 是否自动切回“节点树”，并且对应的节点是否展开并高亮居中。
2. **同 Tab 连续拾取验证**：
   - 在“节点树” Tab 下直接使用选取器点击不同层级的节点，验证高亮定位效果是否流畅正常。
3. **点空行为验证**：
   - 切换到 Profiler 标签页，激活选取器并点击无节点的背景区域，验证不会误切 Tab，仅退出选取状态。
4. **编译与类型验证**：
   - 运行 TypeScript 类型检查与构建流程，确保没有类型或打包错误。
