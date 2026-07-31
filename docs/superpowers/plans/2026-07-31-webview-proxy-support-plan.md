# Webview 网络代理支持 (Webview Proxy Management) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Cocos Creator 插件内的游戏 Webview 提供独立的网络代理配置支持，通过独立 Electron Session Partition (persist:game-preview) 接管代理，且不影响 Cocos 编辑器本体网络请求。

**Architecture:** 主进程使用 `proxy-manager.ts` 处理 `session.fromPartition('persist:game-preview').setProxy()`，渲染进程在 `src/panel/index.html` 和 `index.ts` 中提供代理控制界面并通过 IPC 实时同步配置。

**Tech Stack:** TypeScript, Electron Session API, Vue 3 (Composition API), esbuild / tsc.

## Global Constraints

- 任何新新建脚本必须使用 TypeScript (`.ts`) 规范。
- 采用 JSDoc/TSDoc 注释说明函数与逻辑目的。
- 不影响 Cocos Creator 编辑器主进程 (`session.defaultSession`) 的默认网络代理。

---

### Task 1: 主进程 Webview Proxy 模块逻辑

**Files:**
- Create: `src/proxy-manager.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `applyWebviewProxy(config: WebviewProxyConfig): Promise<void>`
- Produces: `getWebviewProxyConfig(): WebviewProxyConfig`

- [ ] **Step 1: 创建 `src/proxy-manager.ts` 模块**

```typescript
/**
 * src/proxy-manager.ts
 * 管理 Webview 独立 Session (persist:game-preview) 的网络代理设置
 */
import { session } from 'electron';

export interface WebviewProxyConfig {
  mode: 'system' | 'direct' | 'custom';
  server?: string;
  bypassLocalhost: boolean;
}

const PARTITION_NAME = 'persist:game-preview';

let currentConfig: WebviewProxyConfig = {
  mode: 'system',
  server: '',
  bypassLocalhost: true,
};

/**
 * 将代理配置应用至 Webview Session
 */
export async function applyWebviewProxy(config: WebviewProxyConfig): Promise<void> {
  currentConfig = { ...config };
  const targetSession = session.fromPartition(PARTITION_NAME);

  if (config.mode === 'direct') {
    await targetSession.setProxy({ proxyRules: '' });
  } else if (config.mode === 'system') {
    await targetSession.setProxy({ mode: 'system' });
  } else if (config.mode === 'custom') {
    const bypassRules = config.bypassLocalhost ? 'localhost;127.0.0.1;<loopback>' : '';
    await targetSession.setProxy({
      proxyRules: config.server || '',
      proxyBypassRules: bypassRules,
    });
  }
}

/**
 * 获取当前已保存的代理配置
 */
export function getWebviewProxyConfig(): WebviewProxyConfig {
  return currentConfig;
}
```

- [ ] **Step 2: 在 `src/main.ts` 中集成 proxy-manager 与 IPC 响应通道**

修改 `src/main.ts` 消息处理与 `load()` 函数：
```typescript
const { applyWebviewProxy, getWebviewProxyConfig } = require('./proxy-manager');

// 在 messages 中添加 IPC 响应
messages: {
  'set-webview-proxy'(event: any, config: any) {
    applyWebviewProxy(config).then(() => {
      if (event.reply) event.reply(null, { success: true });
    }).catch((err: any) => {
      if (event.reply) event.reply(err.message);
    });
  },
  'get-webview-proxy'(event: any) {
    if (event.reply) event.reply(null, getWebviewProxyConfig());
  }
}
```

- [ ] **Step 3: 执行类型检查与构建测试**

Run: `npx tsc --noEmit`
Expected: 编译通过，无类型错误。

- [ ] **Step 4: Commit 提交**

```bash
git add src/proxy-manager.ts src/main.ts
git commit -m "feat(proxy): add main process proxy manager with electron session isolation"
```

---

### Task 2: 面板 Webview Partition 设置与前端 UI 组件集成

**Files:**
- Modify: `src/panel/index.html`
- Modify: `src/panel/index.ts`

- [ ] **Step 1: 在 `src/panel/index.html` 为 `<webview>` 添加 partition 属性并构建设置 Modal DOM**

为 `<webview id="game-view" ...>` 添加 `partition="persist:game-preview"` 属性。

在顶部工具栏操作区添加代理设置小图标：
```html
<button class="icon-btn" @click="showProxyModal = true" title="网络代理设置">🌐</button>
```

添加代理设置弹窗 HTML/CSS:
```html
<div class="modal-overlay" v-if="showProxyModal" @click.self="showProxyModal = false">
    <div class="modal-card">
        <h3>🌐 Webview 网络代理设置</h3>
        <div class="form-group">
            <label>代理模式：</label>

            <select v-model="proxyForm.mode">
                <option value="system">跟随系统 (System Default)</option>
                <option value="direct">强制直连 (Direct - 绕过代理)</option>
                <option value="custom">自定义代理 (Custom Server)</option>
            </select>
        </div>
        <div class="form-group" v-if="proxyForm.mode === 'custom'">
            <label>代理服务器地址：</label>

            <input type="text" v-model="proxyForm.server" placeholder="例如: http://127.0.0.1:7890" />
        </div>
        <div class="form-group" v-if="proxyForm.mode === 'custom'">
            <label>
                <input type="checkbox" v-model="proxyForm.bypassLocalhost" />

                自动对 localhost / 127.0.0.1 本地环回地址绕过代理
            </label>
        </div>
        <div class="modal-actions">
            <button class="btn btn-primary" @click="saveProxySettings">应用代理配置</button>
            <button class="btn" @click="showProxyModal = false">取消</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: 在 `src/panel/index.ts` 中实现代理配置数据绑定与 LocalStorage 持久化**

定义响应式状态与 saveProxySettings 方法：
```typescript
const showProxyModal = ref(false);
const proxyForm = reactive({
  mode: 'system',
  server: '',
  bypassLocalhost: true,
});

// 从 LocalStorage 恢复代理设置
try {
  const saved = localStorage.getItem('mcp_webview_proxy_config');
  if (saved) {
    Object.assign(proxyForm, JSON.parse(saved));
    Editor.Ipc.sendToMain('mcp-inspector-bridge:set-webview-proxy', { ...proxyForm });
  }
} catch (e) {}

const saveProxySettings = async () => {
  localStorage.setItem('mcp_webview_proxy_config', JSON.stringify({ ...proxyForm }));
  Editor.Ipc.sendToMain('mcp-inspector-bridge:set-webview-proxy', { ...proxyForm });
  showProxyModal.value = false;
  // 重新刷新 webview 以应用新代理
  if (typeof performWebviewReload === 'function') {
    performWebviewReload();
  }
};
```

- [ ] **Step 3: 运行 TypeScript 与打包逻辑**

Run: `npm run build`
Expected: esbuild & tsc 顺利编译输出至 `dist/` 目录。

- [ ] **Step 4: Commit 提交**

```bash
git add src/panel/index.html src/panel/index.ts
git commit -m "feat(proxy): add webview proxy config UI and local storage persistence"
```

---

### Task 3: 构建与集成测试

- [ ] **Step 1: 执行完整打包构建**

Run: `npm run build`
Expected: 输出了 `dist/main.js`, `dist/panel/index.js`, `dist/probe.js` 等产物且未报错。

- [ ] **Step 2: Commit 提交构建产物**

```bash
git add dist/
git commit -m "build: compile webview proxy support assets"
```
