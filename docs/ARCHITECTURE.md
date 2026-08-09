# 架构与协议参考 (ARCHITECTURE.md)

> 本文档从历史设计规范（原 `specs/` 与 `docs/superpowers/`）中抽离与项目维护密切相关的**架构决策、协议约定与关键常量**，作为后续开发的速查参考。
> 功能清单与用户指南见 `README.md`；版本变更记录见 `UPDATE_LOG.md`；MCP 脚本系统 cc 拦截设计见 `DESIGN.md`；用户脚本使用指南见 `docs/user-script-guide.md`。

---

## 1. 进程与通信拓扑

插件采用「主进程 (Main) — 面板 (Vue Renderer) — 游戏 Webview/探针」三层结构：

- **主进程**：MCP WebSocket 服务、CDP 日志监听、原生 Dialog、代理管理（`src/main.ts`、`src/ipc-router.ts`、`src/cdp-log-listener.ts`、`src/proxy-manager.ts`）。
- **面板**：Vue 3 双分栏 UI，通过 `Editor.Ipc` 与主进程通信，通过 `<webview>`/`BrowserView` 承载游戏预览（`src/panel/`）。
- **游戏侧探针**：由 `src/preload.ts` 无侵入注入 `window.__mcp*` 全局钩子（crawler / picker / render-debugger / profiler / memory / engine-helper），提供节点树、属性、拾取、渲染调试等运行时能力。

**固定端口/服务约定**：

| 服务 | 地址 |
|---|---|
| MCP WebSocket (JSON-RPC) | `ws://localhost:4456`（多实例时动态递增，见 §2） |
| Cocos 预览服务器 | `http://localhost:7456/`（Build 模式为 `http://localhost:7456/build/`） |

---

## 2. MCP 多实例动态端口协议

应对同时开启多个 Cocos Creator 编辑器实例时的 `EADDRINUSE` 冲突：

- **动态分配**：默认从 `4456` 起，绑定遇到 `EADDRINUSE` 自动 `port++` 重试（无硬阈值，直至系统上限 65535）。
- **前端探测**：MCP 客户端默认连接 `ws://localhost:4456`；当 `_activePort` 为 `null` 时，分片并发 ping 探测 **4456–4556**（100 端口）范围内的存活节点。
- **白名单展示**：面板状态区展示真实可用端口，推荐范围 **4456–4466**（超过该范围的实例不保证 UI 完整呈现）。
- **心跳元数据注入**：ping/pong 载荷除保活外夹带工程特征，供 AI 识别目标项目实例：
  ```json
  { "type": "pong", "port": 4458, "projectPath": "C:/games/demo", "projectName": "demo" }
  ```
  `projectPath` 来自 `Editor.Project.path`，取不到时用路径末两级目录兜底。
- **AI 寻址状态机**：内部变量 `_activePort`；探测仅 1 个存活节点时自动绑定并透明转发；探测到 >1 个节点时**阻断工具执行**并抛出警告，要求 AI 先调用 `set_active_instance(port)` 指定目标端口。
- **MCP 工具**：`get_active_instances`（扫描活跃端口）、`set_active_instance`（绑定指定端口）、`refresh_preview`（刷新游戏预览）。

---

## 3. 运行时日志采集架构（CDP 主方案 + 注入降级）

Webview 预览日志捕获经历过「注入 Proxy 包装」→「CDP 被动监听」的迁移，最终双轨并存：

### 3.1 CDP 主方案（`src/cdp-log-listener.ts`）
- 对 `<webview>` 调用 `debugger.attach('1.3')` → `sendCommand('Runtime.enable')` → 监听 `debugger.on('message')` 中的 **`Runtime.consoleAPICalled`** 事件，实时 push 到 buffer（无需轮询）。
- 从 `params.stackTrace.callFrames[0]` 提取**真实源文件** url / lineNumber / columnNumber，保留 DevTools 源归属。
- 事件格式：
  ```json
  {
    "method": "Runtime.consoleAPICalled",
    "params": {
      "type": "log" | "warning" | "error" | "info" | "debug",
      "args": [{ "type": "string", "value": "hello" }, { "type": "object", "description": "{...}" }],
      "stackTrace": { "callFrames": [{ "url": "http://localhost:7456/scripting/game.js", "lineNumber": 42, "columnNumber": 15, "functionName": "update" }] },
      "timestamp": 1714000000000
    }
  }
  ```
- 参数序列化：`normalizeType` / `serializeArgs` 将 RemoteObject 转为可读字符串。

### 3.2 注入降级方案
- CDP 附加失败（如用户已打开 DevTools 占用 debugger）时自动降级：`executeJavaScript(INJECTION_SCRIPT)` 用 Proxy 包装 `console.*` / `cc.*`，日志写入 `window.__mcpLogBuffer`，`getCdpLogs()` 轮询读取。
- 同时监听 `debugger.on('detach')`：debugger 被 DevTools 抢占时自动切回注入方案。
- 注入脚本以 `//# sourceURL=mcp-log-capture.js` 命名；buffer 上限 **500 条**防爆，单条消息截断 `MAX_MSG_LEN=300`。

### 3.3 已知环境结论（历史验证）
- 在此插件环境中，「零侵入」方案均不可用：`<webview>` 的 `debugger.attach → Runtime.enable` 事件**不派发**、`webContents.on('console-message')` **不触发** → 唯一可靠方式是页面内注入（BrowserView 场景则用原生 `console-message` 事件）。
- 对外接口：`initCdpLogListener(silent)` / `getCdpLogs(tail, level)` / `getCdpStatus()`（CDP 模式下 `method="cdp-debugger"`）/ `detachCdpListener()`。
- IPC 通道：`query-cdp-logs`（`main.ts` handler，`ipc-router.ts` 有快捷路径）。
- **日志来源追踪**：`parseCallerSource` 从 `Error.stack` 提取调用方 file / line / column，用于 MCP 日志面板展示来源归属。

---

## 4. Webview 独立网络代理

- **Session 隔离**：`<webview>` 挂载 `partition="persist:game-preview"`，主进程经 `session.fromPartition('persist:game-preview')` 获取独立 session，代理配置仅作用于游戏预览流量，不污染编辑器本体。
- **代理模式**：`system`（跟随系统）/ `direct`（强制直连）/ `custom`（自定义，如 `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080`）。
- **Localhost 避让**：`custom` 模式下 `proxyBypassRules` 默认 `localhost;127.0.0.1;<loopback>`，保证本地预览 HTML 直连。
- **配置结构**：
  ```typescript
  interface WebviewProxyConfig {
    mode: 'system' | 'direct' | 'custom';
    server?: string;          // 代理服务器地址
    bypassLocalhost: boolean; // 是否直连本地环回地址（默认 true）
  }
  ```
- **IPC 通道**：`mcp-set-webview-proxy`（应用配置）/ `mcp-get-webview-proxy`（查询当前配置）；模块为 `src/proxy-manager.ts` 的 `applyWebviewProxy(config)`。面板侧 LocalStorage 持久化。

---

## 5. 运行模式与预览加载

- **`globalState.runMode` 三态**：
  - `'preview'`：`http://localhost:${previewPort}`，场景未激活时刷新被拦截（`isEditorSceneActive` 校验）。
  - `'build'`：`http://localhost:${previewPort}/build/`，加载前用 HTTP 探针检测 `/build/` Web 服务路由是否已激活（识别 `GameCanvas` / `cocos2d-js` 等签名，排除 Express 404 与预览回退页伪 200）。
  - `'custom'`：直接加载 `customUrl`。
- **切换防抖**：300ms 防抖重置 + `isSwitchingMode` 完成保护（500ms）+ 切换前 `wv.stop()`。
- **历史 bug 根因（已验证）**：
  1. 静态 inline `position: relative` 与动态 `gameContainerStyle` 的 `position: absolute` CSS 碰撞，导致游戏容器被 `overflow: hidden` 裁剪隐藏 —— 需保持两处 position 语义一致。
  2. webview 首次 `loadURL` 必须等 `dom-ready`（`isWebviewDomReady`）后再触发，否则加载失败。

---

## 6. 节点 PSD 导出坐标转换

双端协同：游戏侧（探针）DFS 遍历节点树 + Canvas 栅格化 Sprite/Label → 面板侧 `ag-psd` 打包 → 主进程原生 Dialog 保存。

- **坐标系差异**：Cocos 左下角原点、Y 轴向上、有 Anchor 锚点；PSD 左上角原点、Y 轴向下、图层仅矩形边界（left/top/width/height）。
- **转换公式**（以选中根节点 Canvas 尺寸 `(rootWidth, rootHeight)` 与锚点 `(rootAnchorX, rootAnchorY)` 为基准面）：
  ```
  x_psd = x_local_to_root + rootAnchorX * rootWidth
  y_psd = rootHeight - (y_local_to_root + rootAnchorY * rootHeight)
  ```
- 取子节点世界包围盒 4 顶点映射后的 min/max 确定图层 AABB：`left = min(x)`、`top = min(y)`、宽高取差值。
- 主进程 IPC 保存 PSD 文件（`psd-save-file` 相关通道），`NodeInspector` 提供 📂 导出按钮，`useNodeSystem.exportNodeAsPsd` 编排全流程。

---

## 7. 录屏数据流

- 面板点击 📹 → `webview.send('record-command', { action: 'start', fps, scale })`；再次点击 → `webview.send('record-command', 'stop')`。
- 探针侧：检查 GameCanvas → 创建 **OffscreenCanvas 双缓冲缩放**（按 scale 拉伸帧）→ `MediaRecorder` 录制流。
- 停止后：`mediaRecorder.stop()` → FileReader 读取为 `ArrayBuffer` → `ipcRenderer.sendToHost('record-complete', arrayBuffer)`。
- 面板侧：`Editor.Ipc.sendToMain('show-save-video-dialog')` → 主进程 `dialog.showSaveDialog`（默认 `video-<timestamp>.webm`）→ 返回 filePath → 面板 `fs.writeFileSync(filePath, Buffer.from(arrayBuffer))`。
- 录制状态机与帧率/分辨率缩放设置由 `useGameView.ts` 与 `index.html` 录制按钮区管理。

---

## 8. 用户脚本系统协议

- **元数据块**：脚本以 `// ==McpScript==` / `// ==/McpScript==` 包裹头部声明：

  | 字段 | 必填 | 说明 |
  |---|---|---|
  | `@name` | 是 | 脚本显示名称 |
  | `@version` | 是 | 语义化版本号 |
  | `@description` | 否 | 功能简述 |
  | `@author` | 否 | 作者 |
  | `@grant` | 否 | 所需权限，可多个；无 grant 的脚本仅能使用 `mcp.log / warn / error` |

- **grant 权限示例**：`input_simulation`（输入模拟）、`cc_api`（引擎 API）、`persistent`（持久化存储）。
- **运行 API**：`mcp.*`（log / warn / error / runInGame 等）；游戏侧执行通过 `fn.toString()` 序列化后注入 Webview 重新解析，自动绑定全局 `cc`。
- **cc 安全拦截**：面板侧外层作用域将 `cc` 形参绑定为拦截 Proxy，直接调用即抛出友好报错（详见 `DESIGN.md`）。
- **文件与持久化**：脚本文件 `extensions/<name>.user.js`（插件目录内）；状态持久化 `profile://project/mcp-scripts.json`。
- **调试定位**：执行尾部注入 `//# sourceURL=mcp-script:///<fileName>`，支持 DevTools 源码映射与断点。
- 相关 IPC：`mcp-inspector-bridge:script-register-tool` / `script-unregister-tool` / `script-save-file` / `script-import-dialog` / `script-export-file` / `script-delete-file`。

---

## 9. 关键常量与全局钩子速查

| 类别 | 名称/值 | 说明 |
|---|---|---|
| 端口 | `4456` | MCP WebSocket 起始端口 |
| 端口 | `4456–4556` | 前端探测范围（100 端口） |
| 端口 | `4456–4466` | 面板白名单展示范围 |
| 端口 | `7456` | Cocos 预览服务器 |
| 日志 | `window.__mcpLogBuffer` | 注入降级方案的缓冲全局数组 |
| 日志 | `MAX_BUFFER = 500` | 日志缓冲上限（防爆） |
| 日志 | `MAX_MSG_LEN = 300` | 单条日志截断长度 |
| 日志 | `mcp-log-capture.js` | 注入脚本 sourceURL 命名 |
| 性能 | `FRAME_TIME_WINDOW = 600` | 性能叠加框帧时间环形缓冲区 |
| 性能 | `__mcpCountNodes` | 场景节点计数全局钩子 |
| 拾取 | `__mcpNodePicker` | 节点拾取器开关钩子（`enable`/`disable`） |
| 渲染调试 | `__mcpRenderDebuggerHook` | 渲染调试器 AOP 钩子（`injectHooks`/`restoreHooks`） |
| 模拟点击 | `pointer-events: none; z-index: 2147483647` | 视觉动效层样式（不拦截交互、置顶） |
| MCP 日志 | `mcp-inspector-bridge:mcp-log` | 面板 MCP 操作日志 IPC |
| 刷新预览 | `mcp-refresh-preview` | `refresh_preview` 工具对应的 IPC 路由（`TOOL_IPC_MAP` 机制） |
| 代理 | `mcp-set-webview-proxy` / `mcp-get-webview-proxy` | 代理配置 IPC |
| 代理 | `persist:game-preview` | Webview 独立 Session Partition |
| 录屏 | `record-command` / `record-complete` | 录屏控制/完成 IPC channel |
| 录屏 | `show-save-video-dialog` | 主进程保存对话框 IPC |
