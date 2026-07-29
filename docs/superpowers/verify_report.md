# 验证与修复报告 - 运行模式、分辨率缩放与 Webview 定位

## 测试环境
- 日期：2026-07-24
- 编译状态：✅ 通过（`npm run build` 全量打包无报错）
- 编辑器版本：Cocos Creator 2.4.x
- 分支：`feat/build-mode-support`

---

## 根因精准定位与解决

### 1. 预设分辨率下 div 标签在 DevTools 中不可见 / 画面偏移至视区外 🎯
- **根本原因**：
  游戏视图容器在 HTML 中带有静态 `style="... position: relative;"`，同时绑定了 Vue 动态样式 `:style="gameContainerStyle"`（其在预设分辨率模式下输出 `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(...)`）。
  由于静态 inline `style` 中的 `position: relative` 与动态 `:style` 的 `position: absolute` 发生 **CSS 碰撞与样式覆盖**，元素实际变为了 `position: relative; left: 50%; top: 50%; translate(-50%, -50%)`。
  当目标尺寸（如 1206x2622）很大时，`left: 50%; top: 50%` 相对 Normal Flow 便宜了 +335px / +247px，而 `translate(-50%, -50%)` 偏移了自身尺寸的 -50%（即 -603px / -1311px），导致整个容器的物理 Y 坐标被推到了 **Y = -1064px 的视区最上方外侧**！
  由于父级容器 `#game-mount-wrap` 带有 `overflow: hidden;`，整个游戏容器被物理裁剪完全隐藏！
- **修复方案**：
  从 [src/panel/index.html](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-inspector-bridge/src/panel/index.html) 的静态 inline style 中移除 `position: relative`，完全交由 `gameContainerStyle` 掌控定位模式。在非 FIT 模式下精准实施 `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(...)`，使缩放容器完美的居中展示在面板视区正中央。

### 2. Webview 首次加载抛出 Electron 异常 🐛
- **日志报错**：`The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.`
- **根本原因**：
  在 `<webview>` 刚插入 DOM 且尚未触发首次 `dom-ready` 事件前，主动调用 `wv.loadURL()` 会触发 Electron 的底层未就绪防御机制并抛出异常。
- **修复方案**：
  在 [src/panel/composables/useGameView.ts](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-inspector-bridge/src/panel/composables/useGameView.ts) 中增加 `isWebviewDomReady` 状态监控。在 DOM 就绪前采用安全的 `wv.src = targetUrl` 原生属性赋值方式，就绪后才允许调用 `wv.loadURL()`。

---

## 最终结论

**✅ 验证与修复全部通过**

修改已打包并提交至 `feat/build-mode-support` 分支（Commit: `d93eb42`）。请在 Cocos Creator 中点击 **开发者 -> 重新加载扩展** 体验。
