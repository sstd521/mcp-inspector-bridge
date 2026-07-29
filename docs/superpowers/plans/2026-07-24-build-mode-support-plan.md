# 构建 (Build) 模式与多运行模式支持 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `mcp-inspector-bridge` 扩展多运行模式支持（预览模式、Build 模式、自定义页面模式），在 Build 模式下加载 `http://localhost:${previewPort}/build/` 且解耦编辑器场景依赖，提供未构建时的友好引导卡与连击防抖重置保护。

**Architecture:** 在 Vue 3 全局 Store 中引入 `runMode` 与 `customUrl` 响应式状态，在 `useGameView` 中实现动态 URL 计算、按模式条件判定场景就绪状态（`isEditorSceneActive`）、以及防抖清理逻辑。通过包主菜单（Main Menu）与面板顶栏 UI 提供统一的操作入口。

**Tech Stack:** TypeScript, Vue 3 (Composition API), Electron (<webview>), Cocos Creator Editor Package API.

## Global Constraints

- **语言标准**: 统一使用 TypeScript (`.ts`) 与 简体中文 注释。
- **架构规范**: 严禁破坏现有的 Cocos Creator IPC 传递逻辑和 MCP WebSocket 通讯能力。
- **构建命令**: `npm run build`

---

### Task 1: 全局 Store 状态与扩展数据结构

**Files:**
- Modify: `src/panel/store.ts`

**Interfaces:**
- Consumes: Existing `globalState` reactive object in `src/panel/store.ts`
- Produces: `runMode`: `'preview' | 'build' | 'custom'`, `customUrl`: `string`, `isSwitchingMode`: `boolean`, `isBuildPackageFound`: `boolean`

- [ ] **Step 1: 修改 store.ts 定义新增字段**

```typescript
// 在 src/panel/store.ts 的 globalState 对象中追加：
export const globalState = reactive({
    // ... 现有字段
    runMode: 'preview' as 'preview' | 'build' | 'custom',
    customUrl: '' as string,
    isSwitchingMode: false as boolean,
    isBuildPackageFound: true as boolean,
});
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/panel/store.ts
git commit -m "feat(store): add runMode, customUrl, and build status to globalState"
```

---

### Task 2: 主进程 IPC 消息与菜单配置

**Files:**
- Modify: `package.json:11-15`
- Modify: `src/main.ts:74-90`

**Interfaces:**
- Consumes: Editor.Ipc and `package.json` main-menu
- Produces: `mcp-inspector-bridge:switch-mode` IPC message handling

- [ ] **Step 1: 在 package.json 中配置主菜单**

修改 `package.json` 中的 `main-menu`:
```json
	"main-menu": {
		"MCP 桥接器/开启运行时面板": {
			"message": "mcp-inspector-bridge:open"
		},
		"MCP 桥接器/运行模式/预览模式 (Preview)": {
			"message": "mcp-inspector-bridge:mode-preview"
		},
		"MCP 桥接器/运行模式/Build 模式 (Build)": {
			"message": "mcp-inspector-bridge:mode-build"
		},
		"MCP 桥接器/运行模式/自定义页面 (Custom)": {
			"message": "mcp-inspector-bridge:mode-custom"
		}
	},
```

- [ ] **Step 2: 在 src/main.ts 中添加菜单消息侦听器**

在 `src/main.ts` 的 `messages` 对象中追加：
```typescript
        'mode-preview'() {
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'switch-run-mode', 'preview');
        },
        'mode-build'() {
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'switch-run-mode', 'build');
        },
        'mode-custom'() {
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'switch-run-mode', 'custom');
        },
```

- [ ] **Step 3: 运行 npm run build 验证构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json src/main.ts
git commit -m "feat(main): register mode switching menu items and IPC handlers"
```

---

### Task 3: GameView 多模式逻辑、探针检测与防抖重置

**Files:**
- Modify: `src/panel/composables/useGameView.ts`

**Interfaces:**
- Consumes: `globalState.runMode`, `globalState.customUrl`, `globalState.previewPort`
- Produces: `switchRunMode(mode)`, `checkBuildPackageAvailable()`, `refreshGame()` with mode-aware checks

- [ ] **Step 1: 修改 refreshGame() 的场景就绪拦截**

在 `src/panel/composables/useGameView.ts` 中找到 `refreshGame()`：
```typescript
    function refreshGame() {
        if (globalState.runMode === 'preview' && !globalState.isEditorSceneActive) {
            console.warn('[Bridge] 预览模式下场景未激活，刷新操作暂被拦截以防报错。');
            return;
        }

        const wv: any = gameView.value;
        if (wv && (wv.clientWidth === 0 || wv.clientHeight === 0)) {
            console.log('[Bridge] 面板处于后台或可见区域为零，刷新请求挂起...');
            pendingRefresh = true;
            return;
        }

        console.log(`[Bridge] 触发手动刷新重载游戏视图 (${globalState.runMode} 模式)...`);
        pendingRefresh = false;

        globalState.isGamePaused = false;
        globalState.nodeTree = null;
        globalState.lastTreeUpdate = 0;

        let targetUrl = `http://localhost:${globalState.previewPort}`;
        if (globalState.runMode === 'build') {
            targetUrl = `http://localhost:${globalState.previewPort}/build/`;
            checkBuildPackageAvailable();
        } else if (globalState.runMode === 'custom' && globalState.customUrl) {
            targetUrl = globalState.customUrl;
        }

        globalState.webviewSrc = targetUrl;
        if (wv && typeof wv.reload === 'function' && wv.src === targetUrl) {
            try { wv.reload(); } catch (e) { }
        }
    }
```

- [ ] **Step 2: 实现 checkBuildPackageAvailable() 探针检测**

```typescript
    const checkBuildPackageAvailable = async () => {
        const buildUrl = `http://localhost:${globalState.previewPort}/build/`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            const resp = await fetch(buildUrl, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            globalState.isBuildPackageFound = resp.status !== 404;
        } catch (e) {
            globalState.isBuildPackageFound = false;
        }
    };
```

- [ ] **Step 3: 实现 switchRunMode() 带防抖重置逻辑**

```typescript
    let modeSwitchTimer: any = null;
    const switchRunMode = (newMode: 'preview' | 'build' | 'custom') => {
        if (globalState.runMode === newMode && !globalState.isSwitchingMode) return;
        
        globalState.isSwitchingMode = true;
        globalState.runMode = newMode;
        globalState.nodeTree = null;
        globalState.nodeDetail = null;

        const wv: any = gameView.value;
        if (wv && typeof wv.stop === 'function') {
            try { wv.stop(); } catch(e) {}
        }

        if (modeSwitchTimer) clearTimeout(modeSwitchTimer);
        modeSwitchTimer = setTimeout(() => {
            refreshGame();
            setTimeout(() => { globalState.isSwitchingMode = false; }, 500);
        }, 300);
    };
```

- [ ] **Step 4: 导出 switchRunMode 与 checkBuildPackageAvailable**

在 `useGameView` 返回的对象中导出新增的方法。

- [ ] **Step 5: 编译验证**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/panel/composables/useGameView.ts
git commit -m "feat(gameView): implement mode-aware refresh, build probing, and switch debounce"
```

---

### Task 4: 面板 UI 工具栏与 Build 未构建指引卡片

**Files:**
- Modify: `src/panel/index.html`
- Modify: `src/panel/index.ts`

**Interfaces:**
- Consumes: `globalState.runMode`, `globalState.isBuildPackageFound`, `switchRunMode`, `checkBuildPackageAvailable`
- Produces: Top toolbar mode selector and empty state overlay UI

- [ ] **Step 1: 在 index.html 中更新顶栏工具与未构建提示卡**

在 `src/panel/index.html` 的顶栏工具按钮区域增加模式选择器与 Custom URL 输入框；
在 `#game-view` 区域中增加无包占位卡：
```html
<div v-if="globalState.runMode === 'build' && !globalState.isBuildPackageFound" class="build-empty-card">
    <div class="empty-icon">⚠️</div>
    <div class="empty-title">未检测到 Web 构建产物</div>
    <div class="empty-desc">
        编辑器重启后，需先进行 Web 平台构建。<br>
        请在 Cocos Creator 菜单中打开 <b>项目 -> 构建发布</b> 并完成构建。
    </div>
    <button class="btn-primary" @click="checkBuildPackageAvailable">🔄 重新检测 Build 包</button>
</div>
```

- [ ] **Step 2: 在 index.ts 中注册 IPC 面板切换侦听器**

在 `src/panel/index.ts` 的 `Editor.Panel.extend` 消息接收部分注册 `switch-run-mode`:
```typescript
        'switch-run-mode'(event: any, mode: 'preview' | 'build' | 'custom') {
            if (_gameViewSystem && typeof _gameViewSystem.switchRunMode === 'function') {
                _gameViewSystem.switchRunMode(mode);
            }
        }
```

- [ ] **Step 3: 执行打包编译**

Run: `npm run build`
Expected: PASS with no errors

- [ ] **Step 4: Commit**

```bash
git add src/panel/index.html src/panel/index.ts
git commit -m "feat(ui): add mode selector, custom url input, and build empty state overlay"
```

---

## Verification Plan

### Automated Build Verification
- 运行 `npm run build` 确保 TypeScript 代码及 ESBuild 打包零报错。

### Manual Functional Verification
1. **预览模式测试**:
   - 切换到“预览模式”，验证在编辑场景开启时成功加载 `http://localhost:${previewPort}`。
2. **Build 模式未构建测试**:
   - 切换到“Build 模式”，未进行 Web 构建时，确认显示未构建引导占位卡，且不会抛出控制台报错。
3. **Build 模式正常运行测试**:
   - 在 Cocos Creator 中构建一次 Web 平台（Web Mobile / Web Desktop）。
   - 点击“重新检测 Build 包”，验证 Webview 成功加载 `http://localhost:${previewPort}/build/` 并注入探针。
4. **防抖与连击测试**:
   - 在“预览” / “Build” / “自定义”模式间快速连续切换，确认界面不卡死、探针不重复注入、无乱序数据包。
