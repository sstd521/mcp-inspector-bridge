# mcp-inspector-bridge 构建 (Build) 模式与多运行模式支持设计规范

## 1. 概述 (Overview)

### 1.1 背景与目标
目前 `mcp-inspector-bridge` 插件仅支持在 Cocos Creator 编辑器的**预览状态 (Preview Mode)** 下运行，且强依赖编辑器的场景激活状态 (`isEditorSceneActive`)。
为了提升调试能力与兼容性，插件需要支持 **构建状态 (Build Mode)** 以及 **自定义 URL 模式 (Custom Page Mode)**，参考 [CocosInspector](file:///C:/Users/Firekula/.CocosCreator/packages/CocosInspector) 的多模式运行机制，使用户在预览、Build 导出的 Web 包、或任意本地 HTTP/Web 页面下均能享受完整的 MCP Inspector 探针与节点树调试功能。

---

## 2. 核心架构与运行模式 (Run Modes Architecture)

插件将支持三种运行模式，存入 `globalState.runMode` 及 Profile 配置中：

| 模式名称 | 标识符 (`runMode`) | 默认 URL 来源 | 场景激活依赖 (`isEditorSceneActive`) | 特性说明 |
| :--- | :--- | :--- | :--- | :--- |
| **预览模式** | `'preview'` | `http://localhost:${previewPort}` | **强校验** (需等待 `scene:ready`) | 编辑器实时预览模式，场景未初始化时暂停刷新 |
| **Build 模式** | `'build'` | `http://localhost:${previewPort}/build/` | **不校验** | 运行 Cocos 编辑器本地构建 Web 服务地址；若未构建则显示引导卡 |
| **自定义页面** | `'custom'` | 用户输入的 `customUrl` | **不校验** | 允许加载任意本地/远程 Web 页面并注入探针 |

---

## 3. 场景就绪状态防御策略 (Scene Readiness Strategy)

在 [useGameView.ts](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-inspector-bridge/src/panel/composables/useGameView.ts) 中重构 `refreshGame()` 的场景拦截逻辑：

```typescript
function refreshGame() {
    // 仅在预览模式下强制要求编辑器场景激活
    if (globalState.runMode === 'preview' && !globalState.isEditorSceneActive) {
        console.warn('[Bridge] 预览模式下场景未激活，刷新操作暂被拦截。');
        return;
    }
    
    // Build 模式与 Custom 模式直接允许刷新/加载
    performWebviewReload();
}
```

---

## 4. Build 模式产物检测与引导机制 (Build Detection & Empty State)

### 4.1 自动探测流程
在切换到 `build` 模式或手动刷新时：
1. 目标 URL 固定为 `http://localhost:${previewPort}/build/`（若本地不存在静态服务探针，则退回检查项目 `build/` 目录）。
2. 面板向 `http://localhost:${previewPort}/build/` 发送 HTTP HEAD/GET 探针请求检查 200/302 状态。
3. 若端口响应正常，设置 `globalState.webviewSrc = http://localhost:${previewPort}/build/` 并加载。

### 4.2 未构建引导卡片 (Empty State Guard)
若未检测到 Web 构建产物（例如编辑器重新启动后尚未进行构建）：
- 面板不加载空白页或抛出异常，而是在游戏视图层展示引导占位 UI：
  - 提示用户：“未检测到有效的 Web 构建产物。在编辑器重启后，请先在 Cocos Creator 菜单中打开 `项目 -> 构建发布` 并完成 Web 平台的构建。”
  - 提供 `[ 🔄 重新检测并加载 Build 包 ]` 交互按钮。

---

## 5. 模式切换生命周期与防抖重置 (State Reset & Rapid Switch Debounce)

为防止用户快速连续点击模式切换导致的竞态条件、重复探针注入和旧 IPC 消息干扰，引入以下防护机制：

### 5.1 原子同步清理 (Teardown Routine)
切换模式时立即同步执行：
- 清空当前节点树 `globalState.nodeTree = null`
- 清除节点选择与 Hover Overlay 遮罩
- 停止性能波形/Tick 轮询 (`stopTickPolling()`)
- 置位防抖与消息隔离标记 `globalState.isSwitchingMode = true`

### 5.2 300ms 防抖与异步任务取消
- 模式切换响应函数采用防抖函数 (Debounce)。
- 取消上一模式可能正在运行的端口嗅探 AbortController。
- 调用 `wv.stop()` 中断旧页面加载，再更新 `globalState.webviewSrc`。
- Webview 触发 `dom-ready` 或 `did-finish-load` 并重新注入探针后，解开 `isSwitchingMode` 标记，恢复数据流。

---

## 6. UI 与主菜单集成 (UI & Menu Integration)

### 6.1 主菜单 (main-menu)
在 [package.json](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-inspector-bridge/package.json) 中添加菜单条目：
- `MCP 桥接器 -> 运行模式 -> 预览模式 (Preview Mode)`
- `MCP 桥接器 -> 运行模式 -> Build 模式 (Build Mode)`
- `MCP 桥接器 -> 运行模式 -> 打开自定义页面 (Open Custom Page)`

### 6.2 面板工具栏 (Panel Header)
- 游戏视图上方工具栏增加模式切换 Dropdown 下拉框。
- 当处于 `custom` 模式时，显示 Custom URL 输入框。
- 当处于 `build` 模式且构建产物未找到时，自动显示引导卡片。

---

## 7. 验证计划 (Verification Plan)

1. **预览模式功能验证**：场景准备好前刷新被拦截，场景 ready 后能够正常同步节点树。
2. **Build 模式完整流程**：
   - 未构建状态下切换到 Build 模式，显示构建引导卡片。
   - 在 Cocos Creator 中构建 Web Desktop/Mobile 包后，点击重新检测，成功加载包并注入探针。
   - 关闭场景编辑窗口后，Build 模式下的游戏仍能正常运行与刷新。
3. **自定义 URL 页面验证**：输入外部 URL，页面加载成功且节点探针正常工作。
4. **防抖与连击测试**：快速连续切换模式，确认不发生状态紊乱、日志重叠或崩溃。
