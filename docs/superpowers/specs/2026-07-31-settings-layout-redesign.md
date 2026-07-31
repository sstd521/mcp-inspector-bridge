# 设置面板布局重构与统一化设计规范 (Settings Layout Redesign Specification)

## 1. 概述与背景 (Overview & Background)

随着 MCP Inspector Bridge 功能的持续扩充，偏好设置（Tab 6）中的设置项逐渐增加（包含 Webview 代理设置、MCP AI 客户端配置、日志查看器、UI 界面缩放、基础字号、检查器排布方向、录屏参数设置、自定义预览分辨率管理等）。原有的单页垂直堆叠卡片布局导致滚动层级过深、查阅效率低下，且网络代理配置存在独立的 Modal 弹窗逻辑，形成了代码与 UI 的重复。

本设计旨在将偏好设置面板重构为**左侧导航分类栏 + 右侧自适应内容区**的经典分栏架构，收拢并废除独立网络代理弹窗与顶部代理按钮，规范所有设置项的 UI 控件尺寸与间距，提升设置面板的紧凑性与易用性。

---

## 2. 界面与交互设计 (UI & Interaction Design)

### 2.1 整体分栏布局 (Sidebar + Content Layout)

- **左侧导航栏 (`setting-sidebar`)**：
  - 固定宽度 `160px`，背景色 `#222223`，右侧 `1px solid #333` 分割线。
  - 分类菜单项高 `36px`，内边距 `0 14px`，具有 Hover 反馈。
  - 选中态菜单带有左侧 `3px` 宽 `#007acc` 主题色高亮指示条，文本高亮为 `#fff`。
  - 包含 4 个分类页签：
    1. 🎨 **外观与排版** (`appearance`)
    2. 🌐 **网络与 AI** (`network-mcp`)
    3. 🎥 **媒体与分辨率** (`media-res`)
    4. 📜 **日志与诊断** (`logs-diag`)

- **右侧内容区 (`setting-content`)**：
  - 自适应填充剩余宽度（`flex: 1`），独立纵向滚动（`overflow-y: auto`），背景 `#1e1e1e`。
  - 容器 Padding `16px 20px`。

### 2.2 顶部操作栏与 Modal 清理 (Top Bar & Modal Cleanup)

- **彻底移除**顶部操作栏 `btn-group` 中的 `🌐 网络代理设置` 图标按钮。
- **彻底移除** HTML 中的 `Proxy Settings Modal` 弹窗模板代码（`showProxyModal` 控制的浮层 DOM）及对应的状态变量。
- 网络代理相关配置统一由偏好设置内 `🌐 网络与 AI` 页面承载。

### 2.3 分类面板细节规范 (Category Detailed Layouts)

#### 分类 1：🎨 外观与排版 (`appearance`)
1. **界面缩放比例**：
   - 控件：Slider (0.5 - 1.5, step 0.05) + 当前百分比数值显示 + [重置] 按钮。
   - 说明：修改后实时更新全局 `uiScale` 状态并写入本地缓存。
2. **基础字号**：
   - 控件：Slider (5px - 20px, step 1) + 当前字号 px 显示 + [重置] 按钮。
   - 说明：修改后实时更新全局 `baseFontSize` 状态并写入本地缓存。
3. **检查器排布方向**：
   - 控件：分段选择按钮 (Segmented Control)：`[ █ 横向并排 (左右) ]` 和 `[ 纵向并排 (上下) ]`。
   - 说明：替代原来的 Radio 单选框，提高视觉精致感与点击区域。

#### 分类 2：🌐 网络与 AI (`network-mcp`)
1. **Webview 网络代理配置**：
   - 代理模式：下拉选择框 (`system` / `direct` / `custom`)。
   - 代理服务器：输入框（仅 `custom` 模式展开）。
   - 绕过本地：复选框（仅 `custom` 模式展开）。
   - 逻辑：配置变更时实时自动持久化，并触发应用逻辑更新代理。
2. **MCP 客户端集成配置**：
   - 宿主平台下拉框选择 + 状态徽章（已连通 🟢 / 未安装 🔴 / 配置损坏 🔴 / 需验证 🟡）。
   - 操作按钮：[一键配置] 与 [尝试向所有平台分发配置]。
   - 手动配置详情：使用 `<details>` 折叠面板展示配置文件路径与 JSON 载荷。

#### 分类 3：🎥 媒体与分辨率 (`media-res`)
1. **视频录制设置**：
   - 3 列网格组合（录制帧率 / 分辨率倍率 / 保存格式）。
   - 下拉框选择：FPS (15/24/30/60)，Scale (0.5x/1.0x/1.5x/2.0x)，Format (WebM/MP4)。
2. **自定义预览分辨率**：
   - 上部：紧凑新增栏（名称输入 + 宽 × 高输入 + [添加] 按钮）。
   - 下部：已有分辨率列表（标签展示，支持行内编辑与删除）。

#### 分类 4：📜 日志与诊断 (`logs-diag`)
1. **MCP 通信运行日志**：
   - 顶部：标题 + 右侧 [清空日志] [复制] 按钮。
   - 日志区域：全高填满，内置代码高亮（请求 `#8bc34a`，错误 `#f44336`，系统 `#aaa`），支持日志流实时滚动。

---

## 3. 技术实施与重构步骤 (Implementation Steps)

1. **HTML 模板重构 (`src/panel/index.html`)**：
   - 重构 Tab 6 内层结构为 `.setting-container` 包含 `.setting-sidebar` 与 `.setting-content`。
   - 在 `<style>` 中添加分栏及紧凑表单 CSS 类规范。
   - 彻底擦除 Proxy Modal DOM 及顶部 🌐 按钮。

2. **逻辑状态调整 (`src/panel/index.ts`)**：
   - 添加 `activeSettingSubTab` 响应式变量控制设置子页签切换（默认 `'appearance'`）。
   - 清理与 `showProxyModal` 相关的冗余逻辑。

3. **测试验证**：
   - 验证 4 大分类菜单点击切换逻辑。
   - 验证各项参数修改（缩放、字号、代理模式、MCP 分发）功能依然正常运作。
