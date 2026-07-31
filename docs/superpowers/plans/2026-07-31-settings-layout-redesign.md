# Settings Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the Settings tab (Tab 6) into a clean, compact two-column layout with a left sidebar navigation and right content area, while removing the top-bar proxy button and standalone proxy modal.

**Architecture:** Split Tab 6 in `src/panel/index.html` into a `.setting-container` flex box containing a `.setting-sidebar` (160px) navigation bar and `.setting-content` (flex: 1) content area. Add `activeSettingSubTab` reactive state in `src/panel/index.ts` to manage sub-tab switching (`appearance`, `network-mcp`, `media-res`, `logs-diag`). Remove `showProxyModal` DOM and top bar button.

**Tech Stack:** Vue 3 (Composition API), TypeScript, HTML5 / CSS3 (Extension panel styling).

## Global Constraints

- Preserve all existing functionality (proxy save, MCP client auto/manual config, UI scale, base font size, inspector layout, screen recording, custom resolutions, logs).
- Simplified Chinese (简体中文) for all UI labels, comments, and notifications.
- Follow existing Cocos Creator panel architecture in `src/panel/index.html` and `src/panel/index.ts`.

---

### Task 1: Add CSS Styles and Vue Reactive State for Settings Layout

**Files:**
- Modify: `src/panel/index.html:120-130`
- Modify: `src/panel/index.ts:50-60`, `src/panel/index.ts:834-850`

**Interfaces:**
- Consumes: Vue 3 `ref` from `'vue'`
- Produces: `activeSettingSubTab` reactive state accessible in template for sub-tab switching.

- [ ] **Step 1: Add `.setting-container`, `.setting-sidebar`, `.setting-menu-item`, `.setting-row` CSS styles to `src/panel/index.html`**

Add the following CSS rules to the `<style>` block in `src/panel/index.html`:

```css
    /* 偏好设置分栏与统一组件样式 */
    .setting-container {
        display: flex;
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        overflow: hidden;
    }
    .setting-sidebar {
        width: 160px;
        background: #222223;
        border-right: 1px solid #333;
        display: flex;
        flex-direction: column;
        padding: 10px 0;
        box-sizing: border-box;
        user-select: none;
        flex-shrink: 0;
    }
    .setting-menu-item {
        height: 36px;
        display: flex;
        align-items: center;
        padding: 0 14px;
        font-size: 13px;
        color: #aaa;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        border-left: 3px solid transparent;
        gap: 8px;
    }
    .setting-menu-item:hover {
        background: #2a2a2b;
        color: #eee;
    }
    .setting-menu-item.active {
        background: #2d2d30;
        color: #fff;
        font-weight: bold;
        border-left-color: #007acc;
    }
    .setting-content {
        flex: 1;
        padding: 16px 20px;
        box-sizing: border-box;
        overflow-y: auto;
        color: #ddd;
    }
    .setting-card {
        background: #252526;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 14px 16px;
        margin-bottom: 16px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .setting-card-title {
        font-size: 13px;
        font-weight: bold;
        color: #4fc3f7;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .setting-card-desc {
        font-size: 12px;
        color: #888;
        margin-bottom: 12px;
        line-height: 1.5;
    }
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px dashed #333;
        font-size: 13px;
    }
    .setting-row:last-child {
        border-bottom: none;
    }
    .setting-row-label {
        color: #ccc;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .setting-row-hint {
        font-size: 11px;
        color: #777;
    }
    .setting-segmented {
        display: inline-flex;
        background: #111;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 2px;
        gap: 2px;
    }
    .setting-segmented-btn {
        padding: 4px 12px;
        font-size: 12px;
        color: #aaa;
        background: transparent;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
    }
    .setting-segmented-btn.active {
        background: #007acc;
        color: #fff;
        font-weight: bold;
    }
```

- [ ] **Step 2: Add `activeSettingSubTab` ref to `src/panel/index.ts` setup and export it**

In `src/panel/index.ts`:
Line 50+:
```typescript
                    const activeTab = ref(0);
                    const activeSettingSubTab = ref<'appearance' | 'network-mcp' | 'media-res' | 'logs-diag'>('appearance');
```

In the return object of `setup()` (around line 834):
```typescript
                return {
                    activeSettingSubTab,
                    showProxyModal,
                    proxyForm,
                    saveProxySettings,
                    // ... rest of exports
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/panel/index.html src/panel/index.ts
git commit -m "feat(settings): add CSS styles and activeSettingSubTab state for two-column settings"
```

---

### Task 2: Reconstruct Tab 6 HTML Structure & Remove Top-Bar Proxy Button and Modal

**Files:**
- Modify: `src/panel/index.html:560-563` (Top bar proxy button)
- Modify: `src/panel/index.html:1190-1496` (Tab 6 Settings panel)
- Modify: `src/panel/index.html:1556-1600` (Proxy Settings Modal)

**Interfaces:**
- Consumes: `activeSettingSubTab`, `globalState`, `proxyForm`, `saveProxySettings`
- Produces: Clean settings UI split into 4 sub-tabs, no redundant proxy modal.

- [ ] **Step 1: Remove top-bar 🌐 proxy button from `src/panel/index.html`**

In `src/panel/index.html` around line 561:
Remove line:
```html
<button class="icon-btn" @click="activeTab = 6; showProxyModal = true" title="网络代理设置">🌐</button>
```

- [ ] **Step 2: Remove Proxy Settings Modal template from `src/panel/index.html`**

In `src/panel/index.html` around lines 1556-1600:
Delete the entire `<!-- Proxy Settings Modal -->` block `<div v-if="showProxyModal" ...>...</div>`.

- [ ] **Step 3: Replace Tab 6 template with the two-column sidebar + 4 sub-tabs structure**

Replace `<!-- Tab 6: 偏好设置 -->` block (`<div v-show="activeTab === 6" ...>`) with:

```html
            <!-- Tab 6: 偏好设置 (Two-Column Sidebar Layout) -->
            <div v-show="activeTab === 6" class="setting-container">
                <!-- 左侧侧边栏导航 -->
                <div class="setting-sidebar">
                    <div :class="['setting-menu-item', activeSettingSubTab === 'appearance' ? 'active' : '']" @click="activeSettingSubTab = 'appearance'">
                        <span>🎨</span>
                        <span>外观与排版</span>
                    </div>
                    <div :class="['setting-menu-item', activeSettingSubTab === 'network-mcp' ? 'active' : '']" @click="activeSettingSubTab = 'network-mcp'">
                        <span>🌐</span>
                        <span>网络与 AI</span>
                    </div>
                    <div :class="['setting-menu-item', activeSettingSubTab === 'media-res' ? 'active' : '']" @click="activeSettingSubTab = 'media-res'">
                        <span>🎥</span>
                        <span>媒体与分辨率</span>
                    </div>
                    <div :class="['setting-menu-item', activeSettingSubTab === 'logs-diag' ? 'active' : '']" @click="activeSettingSubTab = 'logs-diag'">
                        <span>📜</span>
                        <span>日志与诊断</span>
                    </div>
                </div>

                <!-- 右侧内容区域 -->
                <div class="setting-content">
                    <!-- 1. 外观与排版 -->
                    <div v-show="activeSettingSubTab === 'appearance'">
                        <div class="setting-card">
                            <div class="setting-card-title">🎨 面板外观与查看器布局</div>
                            <div class="setting-card-desc">配置 MCP Inspector 面板整体渲染尺寸、文字大小与检查器工具排版方向。</div>

                            <div class="setting-row">
                                <div class="setting-row-label">
                                    <span>UI 界面缩放比例</span>
                                    <span class="setting-row-hint">适应不同 DPI 屏幕或高分辨率显示器</span>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <input type="range" v-model.number="globalState.uiScale" min="0.5" max="1.5" step="0.05" style="width: 140px;">
                                    <span style="font-family: monospace; font-size: 12px; background: #111; padding: 2px 6px; border-radius: 3px; min-width: 36px; text-align: center;">{{ (globalState.uiScale * 100).toFixed(0) }}%</span>
                                    <button class="icon-btn" style="padding: 2px 8px; width: auto;" @click="globalState.uiScale = 1.0" title="重置">重置</button>
                                </div>
                            </div>

                            <div class="setting-row">
                                <div class="setting-row-label">
                                    <span>全局基础字号</span>
                                    <span class="setting-row-hint">面板控制文本的基准字号大小</span>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <input type="range" v-model.number="globalState.baseFontSize" min="5" max="20" step="1" style="width: 140px;">
                                    <span style="font-family: monospace; font-size: 12px; background: #111; padding: 2px 6px; border-radius: 3px; min-width: 36px; text-align: center;">{{ globalState.baseFontSize }}px</span>
                                    <button class="icon-btn" style="padding: 2px 8px; width: auto;" @click="globalState.baseFontSize = 13" title="重置">重置</button>
                                </div>
                            </div>

                            <div class="setting-row">
                                <div class="setting-row-label">
                                    <span>检查器排布方向</span>
                                    <span class="setting-row-hint">控制节点树和右侧属性面板的平铺模式</span>
                                </div>
                                <div class="setting-segmented">
                                    <button :class="['setting-segmented-btn', globalState.inspectorLayout === 'horizontal' ? 'active' : '']" @click="globalState.inspectorLayout = 'horizontal'">横向并排 (左右)</button>
                                    <button :class="['setting-segmented-btn', globalState.inspectorLayout === 'vertical' ? 'active' : '']" @click="globalState.inspectorLayout = 'vertical'">纵向并排 (上下)</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 2. 网络与 AI -->
                    <div v-show="activeSettingSubTab === 'network-mcp'">
                        <!-- 游戏 Webview 代理卡片 -->
                        <div class="setting-card">
                            <div class="setting-card-title">🌐 游戏 Webview 网络代理设置</div>
                            <div class="setting-card-desc">配置底层 Webview (persist:game-preview) 独立 Session 代理，隔离并防止污染 Cocos 编辑器本体。</div>

                            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
                                <div style="display: flex; align-items: center; gap: 15px;">
                                    <span style="color: #aaa; width: 90px;">代理模式:</span>
                                    <select v-model="proxyForm.mode" @change="saveProxySettings" style="background:#111; color:#fff; padding:4px 8px; border-radius: 3px; border:1px solid #555; width: 220px; font-size: 12px;">
                                        <option value="system">跟随系统 (System Default)</option>
                                        <option value="direct">强制直连 (Direct - 绕过代理)</option>
                                        <option value="custom">自定义代理 (Custom Server)</option>
                                    </select>
                                </div>

                                <div v-if="proxyForm.mode === 'custom'" style="display: flex; align-items: center; gap: 15px;">
                                    <span style="color: #aaa; width: 90px;">代理服务器:</span>
                                    <input type="text" v-model="proxyForm.server" @blur="saveProxySettings" placeholder="例如: http://127.0.0.1:7890" style="flex: 1; max-width: 300px; background:#111; color:#fff; padding:4px 8px; border-radius: 3px; border:1px solid #555; font-size: 12px;" />
                                </div>

                                <div v-if="proxyForm.mode === 'custom'" style="display: flex; align-items: center; gap: 10px;">
                                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; color: #ccc; font-size: 12px;">
                                        <input type="checkbox" v-model="proxyForm.bypassLocalhost" @change="saveProxySettings" />
                                        自动对 localhost / 127.0.0.1 本地环回地址绕过代理
                                    </label>
                                </div>

                                <div style="display: flex; justify-content: flex-start; margin-top: 4px;">
                                    <button class="icon-btn" style="width: auto; padding: 5px 15px; font-size: 12px; background: #007acc; border-color: #007acc; color: #fff; font-weight: bold;" @click="saveProxySettings">
                                        保存并应用代理配置
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- MCP 客户端配置卡片 -->
                        <div class="setting-card">
                            <div class="setting-card-title">🛡️ MCP 宿主 AI 客户端配置</div>
                            <div class="setting-card-desc">自动检测与分发 MCP Inspector Bridge 工具链连接配置至宿主 AI 客户端。</div>

                            <div v-if="globalState.mcpScanning" style="color: #ffb74d; margin-bottom: 10px;">正在扫描系统 AI 客户端配置...</div>

                            <div v-if="!globalState.mcpScanning && globalState.mcpClientList.length > 0">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="color: #aaa; width: 65px; font-size: 12px;">宿主平台:</span>
                                        <select v-model="globalState.mcpSelectedClientId" style="background:#111; color:#fff; padding:4px; border-radius: 3px; border:1px solid #555; width: 160px; font-size: 12px;">
                                            <option v-for="client in globalState.mcpClientList" :key="client.id" :value="client.id">{{ client.name }}</option>
                                        </select>
                                    </div>
                                </div>

                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; background: #1b1b1c; padding: 8px 12px; border-radius: 4px; border: 1px solid #333;" v-if="globalState.mcpClientList[globalState.mcpSelectedClientId]">
                                    <div style="display: flex; align-items: center; gap: 6px; font-weight: bold; font-size: 12px;">
                                        <span v-if="globalState.mcpClientList[globalState.mcpSelectedClientId].isError" style="color: #f44336;">🔴 配置损坏</span>
                                        <template v-else>
                                            <span v-if="!globalState.mcpClientList[globalState.mcpSelectedClientId].isInstalled" style="color: #f44336;">🔴 未安装</span>
                                            <span v-else-if="globalState.mcpClientList[globalState.mcpSelectedClientId].isConfigured" style="color: #4caf50;">🟢 已连通</span>
                                            <span v-else style="color: #ff9800;">🟡 需验证配置</span>
                                        </template>
                                    </div>
                                    <button :disabled="!globalState.mcpClientList[globalState.mcpSelectedClientId].isInstalled"
                                        :style="{ padding: '4px 14px', background: globalState.mcpClientList[globalState.mcpSelectedClientId].isInstalled ? '#007acc' : '#555', color: 'white', border: 'none', borderRadius: '3px', cursor: globalState.mcpClientList[globalState.mcpSelectedClientId].isInstalled ? 'pointer' : 'not-allowed', fontWeight:'bold', fontSize: '12px' }"
                                        @click="configureMcpClient(globalState.mcpSelectedClientId)">
                                        一键配置
                                    </button>
                                </div>

                                <details style="margin-bottom: 12px; border-top: 1px dashed #333; padding-top: 8px;">
                                    <summary style="cursor: pointer; color: #aaa; user-select: none; margin-bottom: 8px; font-size: 12px; outline: none;">手动配置展开</summary>

                                    <div v-if="globalState.mcpClientList[globalState.mcpSelectedClientId] && globalState.mcpClientList[globalState.mcpSelectedClientId].path" style="margin-bottom: 10px;">
                                        <div style="color: #aaa; font-size: 11px; margin-bottom: 4px;">配置存储路径:</div>
                                        <div style="display: flex; gap: 5px;">
                                            <input type="text" v-model="globalState.mcpClientList[globalState.mcpSelectedClientId].path" style="flex:1; background:#111; color:#bbb; border:1px solid #333; border-radius: 3px; padding: 4px; font-size: 11px;" />
                                            <button style="padding: 2px 8px; background: #444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;" @click="copyMcpPath(globalState.mcpClientList[globalState.mcpSelectedClientId].path)">复制</button>
                                        </div>
                                    </div>

                                    <div style="margin-bottom: 10px;">
                                        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px;">
                                            <div style="color: #aaa; font-size: 11px;">数据载荷:</div>
                                            <button style="padding: 2px 8px; background: #444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;" @click="copyMcpPayload">复制 JSON</button>
                                        </div>
                                        <textarea v-model="globalState.mcpPayload" style="width: 100%; height: 140px; background: #000; color: #4caf50; border: 1px solid #444; border-radius: 4px; padding: 6px; font-family: monospace; font-size: 11px; box-sizing: border-box; resize: vertical;"></textarea>
                                    </div>
                                </details>

                                <button style="width: 100%; padding: 7px; background: #333; color: #ccc; border: 1px solid #444; border-radius: 3px; cursor: pointer; text-align: center; font-size: 12px;" @click="configureMcpClient(-1)">
                                    尝试向所有平台分发配置
                                </button>
                            </div>

                            <div v-if="globalState.mcpInjectLog" style="margin-top: 10px; color: #8bc34a; font-size: 11px; white-space: pre-wrap; background: #111; padding: 6px; border-radius: 3px; border-left: 3px solid #8bc34a;">
                                {{ globalState.mcpInjectLog }}
                            </div>
                        </div>
                    </div>

                    <!-- 3. 媒体与分辨率 -->
                    <div v-show="activeSettingSubTab === 'media-res'">
                        <!-- 🎥 录屏设置卡片 -->
                        <div class="setting-card">
                            <div class="setting-card-title">🎥 视频录屏参数</div>
                            <div class="setting-card-desc">配置视频录制帧率及导出分辨率倍率（以当前窗口分辨率计算）。</div>

                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div class="setting-row">
                                    <div class="setting-row-label">
                                        <span>录制帧率</span>
                                        <span class="setting-row-hint">较高帧率提高平滑度，但增大输出体积</span>
                                    </div>
                                    <select v-model.number="globalState.recordFps" style="background:#111; color:#fff; padding:4px; border-radius: 3px; border:1px solid #555; width: 120px; font-size: 12px;">
                                        <option :value="15">15 FPS</option>
                                        <option :value="24">24 FPS</option>
                                        <option :value="30">30 FPS (默认)</option>
                                        <option :value="60">60 FPS</option>
                                    </select>
                                </div>

                                <div class="setting-row">
                                    <div class="setting-row-label">
                                        <span>分辨率倍率</span>
                                        <span class="setting-row-hint">按视口尺寸按比例缩放渲染画质</span>
                                    </div>
                                    <select v-model.number="globalState.recordScale" style="background:#111; color:#fff; padding:4px; border-radius: 3px; border:1px solid #555; width: 120px; font-size: 12px;">
                                        <option :value="0.5">0.5x</option>
                                        <option :value="1.0">1.0x (原始)</option>
                                        <option :value="1.5">1.5x</option>
                                        <option :value="2.0">2.0x (高清)</option>
                                    </select>
                                </div>

                                <div class="setting-row">
                                    <div class="setting-row-label">
                                        <span>保存视频格式</span>
                                        <span class="setting-row-hint">选择 WebM 或 MP4 编码容器</span>
                                    </div>
                                    <select v-model="globalState.recordFormat" style="background:#111; color:#fff; padding:4px; border-radius: 3px; border:1px solid #555; width: 120px; font-size: 12px;">
                                        <option value="webm">WebM (.webm)</option>
                                        <option value="mp4">MP4 (.mp4)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- 📐 自定义预览分辨率卡片 -->
                        <div class="setting-card">
                            <div class="setting-card-title">📐 自定义预览分辨率管理</div>
                            <div class="setting-card-desc">添加自定义分辨率，将出现在顶部预览窗口下拉菜单中（全局生效，跨项目共享）。</div>

                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;">
                                <input v-model="newResName" placeholder="名称（选填）" style="background:#111; color:#fff; padding:4px 8px; border-radius:3px; border:1px solid #555; width:130px; font-size: 12px;">
                                <input v-model="newResWidth" placeholder="宽" type="number" min="1" style="background:#111; color:#fff; padding:4px 8px; border-radius:3px; border:1px solid #555; width:70px; font-size: 12px;">
                                <span style="color:#888;">×</span>
                                <input v-model="newResHeight" placeholder="高" type="number" min="1" style="background:#111; color:#fff; padding:4px 8px; border-radius:3px; border:1px solid #555; width:70px; font-size: 12px;">
                                <button class="icon-btn" style="padding: 4px 12px; width: auto; font-size: 12px;" @click="addCustomResolution">添加</button>
                            </div>

                            <div v-if="customResolutions.length > 0" style="display: flex; flex-direction: column; gap: 6px;">
                                <div v-for="res in customResolutions" :key="res.id" style="display: flex; align-items: center; gap: 8px; background: #1a1a1a; padding: 6px 10px; border-radius: 3px; border: 1px solid #333;">
                                    <template v-if="editingResId !== res.id">
                                        <span style="flex: 1; color: #ddd; font-size: 12px;">🏷️ {{ getResolutionDisplayName(res) }}</span>
                                        <button class="icon-btn" style="padding: 2px 8px; width: auto; font-size: 11px;" @click="startEditResolution(res)" title="编辑">✏️</button>
                                        <button class="icon-btn" style="padding: 2px 8px; width: auto; font-size: 11px;" @click="deleteCustomResolution(res.id)" title="删除">🗑️</button>
                                    </template>
                                    <template v-else>
                                        <input v-model="editResName" placeholder="名称（选填）" style="background:#111; color:#fff; padding:3px 6px; border-radius:3px; border:1px solid #555; width:110px; font-size: 11px;">
                                        <input v-model="editResWidth" type="number" min="1" style="background:#111; color:#fff; padding:3px 6px; border-radius:3px; border:1px solid #555; width:55px; font-size: 11px;">
                                        <span style="color:#888;">×</span>
                                        <input v-model="editResHeight" type="number" min="1" style="background:#111; color:#fff; padding:3px 6px; border-radius:3px; border:1px solid #555; width:55px; font-size: 11px;">
                                        <button class="icon-btn" style="padding: 3px 8px; width: auto; font-size: 11px; background: #4caf50; border-color: #4caf50;" @click="saveEditResolution">保存</button>
                                        <button class="icon-btn" style="padding: 3px 8px; width: auto; font-size: 11px;" @click="cancelEditResolution">取消</button>
                                    </template>
                                </div>
                            </div>
                            <div v-else style="color: #666; font-size: 11px; margin-top: 6px;">暂无自定义分辨率，可在上方新增。</div>
                        </div>
                    </div>

                    <!-- 4. 日志与诊断 -->
                    <div v-show="activeSettingSubTab === 'logs-diag'">
                        <div class="setting-card">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div class="setting-card-title" style="margin-bottom: 0;">📜 MCP 通信运行日志</div>
                                <div style="display: flex; gap: 5px;">
                                    <button class="icon-btn" style="width: auto; padding: 2px 8px;" @click="globalState.mcpLogs = []">清空日志</button>
                                    <button class="icon-btn" style="width: auto; padding: 2px 8px;" @click="copyMcpLogs">复制</button>
                                </div>
                            </div>
                            <div style="height: 420px; overflow-y: auto; background: #111; padding: 8px; font-family: monospace; font-size: 11px; border-radius: 3px; border: 1px solid #333;">
                                <div v-for="(log, i) in globalState.mcpLogs" :key="i" :style="{ color: log.type === 'err' ? '#f44336' : (log.type === 'req' ? '#8bc34a' : '#aaa'), marginBottom: '4px', borderBottom: '1px solid #222', paddingBottom: '4px' }">
                                    <span style="color:#666;">[{{log.time}}]</span>
                                    <span style="margin-left:5px; font-weight:bold;">[{{log.type.toUpperCase()}}]</span>
                                    <span style="margin-left:5px; white-space: pre-wrap; word-break: break-all;">{{log.content}}</span>
                                </div>
                                <div v-if="globalState.mcpLogs.length === 0" style="color: #666; text-align: center; margin-top: 20px;">暂无通信日志数据</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
```

- [ ] **Step 4: Commit**

```bash
git add src/panel/index.html
git commit -m "feat(settings): reconstruct settings tab into 2-column layout and remove top bar proxy button and modal"
```

---

### Task 3: Build & Verification

**Files:**
- Output: `dist/panel/index.js`, `dist/panel/index.html`

- [ ] **Step 1: Build the panel using npm script**

Run: `npm run build`
Expected: Build succeeds with zero errors, output written to `dist/`.

- [ ] **Step 2: Commit built bundle if required or verify git status**

Run: `git status`
Expected: Working tree clean or build output updated.

```bash
git add dist/
git commit -m "build: compile updated settings panel bundle"
```
