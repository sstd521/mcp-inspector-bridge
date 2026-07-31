# 设计规范：Webview 独立网络代理控制 (Webview Proxy Management)

## 1. 背景与目标
某些用户反馈在开启系统全局代理后，Cocos Creator 插件面板内的游戏 Webview 不走代理，导致远程 API 接口请求或 WebSocket 连接失败或被拦截。
本功能旨在此插件内部为 Webview 提供独立的网络代理接管能力，通过为其分配独立的 Electron Session Partition，使 Webview 的代理配置独立于 Cocos 编辑器本体及其他扩展。

---

## 2. 核心架构与原理

### 2.1 Webview Session 隔离
在 `src/panel/index.html` 中的 `<webview>` 节点挂载 `partition="persist:game-preview"` 属性。
主进程根据该 partition 获取独立 session 实例：
```typescript
const gameSession = session.fromPartition('persist:game-preview');
```

### 2.2 代理模式 (Proxy Modes)
支持以下三种模式：
1. **`system` (系统默认)**：恢复使用 Electron/Chromium 原生系统代理识别。
2. **`direct` (强制直连)**：绕过所有代理，直接建立 Socket 连接。
3. **`custom` (自定义代理)**：用户显式指定代理服务器，如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:1080`。

### 2.3 Localhost 避让规则 (Bypass Rules)
当使用 `custom` 模式时，代理策略的 `proxyBypassRules` 默认包含 `localhost;127.0.0.1;<loopback>`，保证本地游戏预览 HTML (`http://localhost:7456` 等) 始终直连，而 Webview 内发起的外网 HTTP/WebSocket 流量通过代理服务器。

---

## 3. 数据接口与 IPC 通信

### 3.1 配置数据结构
```typescript
export interface WebviewProxyConfig {
  mode: 'system' | 'direct' | 'custom';
  server?: string;         // 代理服务器地址，如 "http://127.0.0.1:7890" 或 "socks5://127.0.0.1:1080"
  bypassLocalhost: boolean; // 是否自动直连本地环回地址 (默认 true)
}
```

### 3.2 IPC 通信通道
* **`mcp-set-webview-proxy`**：面板向主进程发送新的 `WebviewProxyConfig`，主进程执行 `session.fromPartition('persist:game-preview').setProxy(...)` 应用配置。
* **`mcp-get-webview-proxy`**：面板向主进程查询当前生效的代理配置。

---

## 4. 模块划分与改动文件清单

1. **`[NEW] src/proxy-manager.ts`**
   * 封装 Electron session 代理控制逻辑。
   * 提供 `applyWebviewProxy(config: WebviewProxyConfig)` 函数。
2. **`[MODIFY] src/main.ts`**
   * 注册 `mcp-set-webview-proxy` 和 `mcp-get-webview-proxy` IPC 消息处理。
   * 插件加载时应用当前配置。
3. **`[MODIFY] src/panel/index.html`**
   * `<webview>` 增加 `partition="persist:game-preview"` 属性。
   * 工具栏新增 🌐 代理控制图标按钮及代理设置 Modal 弹窗 DOM / CSS。
4. **`[MODIFY] src/panel/index.ts`**
   * 添加代理配置 Vue 响应式状态与弹窗逻辑。
   * 支持 LocalStorage 持久化保存代理配置。

---

## 5. 验证与测试计划
1. **网络拦截验证**：分别在 `system` / `direct` / `custom` 模式下，验证 Webview 内发出的外网 fetch/XHR 是否准确通过代理软件（如 Clash / Charles）抓包或转发。
2. **本地服务连通性验证**：在开启 `custom` 代理模式下，验证 `http://localhost:7456` 本地预览依然正常加载，不会因为代理阻塞导致黑屏。
3. **隔离性验证**：确认 Webview 的代理变更不影响 Cocos 编辑器自身的网络操作。
