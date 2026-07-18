# inspector → mcp-inspector-bridge 迁移审计

审计基线：`/Users/feng/.CocosCreator/packages/inspector` 的 `beautify` 分支（`6ac5b9a`），目标为当前插件 `feng` 分支。

## 已迁移

| inspector 能力 / 提交 | 当前实现 |
| --- | --- |
| `9f138d3`、`7ddce34` 编辑器节点定位与 Prefab 子节点安全还原 | 运行时采集 Prefab UUID + 子索引路径；编辑器只在还原成功后选中节点 |
| `7f289ff` Button 绑定脚本直开 | Button 事件与任意自定义组件都可直接用代码编辑器打开 |
| `76ea7b8` Sources 的 JS/TS 识别 | AssetDB 返回真实文件名与扩展名，再交给 DevTools Quick Open |
| `5e309c1` Button Target 高亮优化 | 节点树响应式临时高亮；不改变原选中节点，重复调用会取消旧定时器 |
| `05f2b84` 点击 Component 打开脚本 | Button 事件 Component 名称与“打开脚本”按钮均可点击 |
| `91fe436` Handler 可点击 | 点击 Handler 进入 DevTools Sources，并通过 CDP inspect 定位函数 |
| `6ac5b9a` 多 Handler 模拟点击 | 展示全部 Click Events；支持单 Handler 触发与完整 Button 点击 |
| `830f602`、`e124b03` uuidLookup 联动 | Prefab、组件脚本、资源引用提供可选的使用情况查询 |

## 当前插件已覆盖或更强

- 节点树搜索、屏幕拾取、悬停/选中高亮：当前插件已有多关键词组件穿透搜索、多摄像机拾取和多边形高亮。
- 内嵌 DevTools：当前插件使用独立 BrowserView，规避旧插件内嵌 DevTools 挂起问题。
- 日志：当前插件使用 CDP 被动监听，保留真实源码位置，并提供 MCP 日志查询。
- 属性检查：当前插件已有复合类型、数组、枚举、Widget、资源/节点引用、自动刷新与输入保护。
- 预览控制：当前插件已有暂停、单帧、静音、性能叠加框、截图、设备分辨率和自定义分辨率。
- 动态图集、物理/碰撞、内存与 DrawCall：当前插件已有独立可视化与诊断面板。

## 不直接迁移

- 旧插件的授权/订单校验、商店跳转：与当前开源插件无关。
- 独立窗口、build/custom URL 模式：当前插件以编辑器预览桥接和 MCP 为核心，直接移植会形成第二套生命周期。
- HTTP 代理和网络限速：会修改 Electron 全局 session；现阶段保留 DevTools Network 原生能力，避免影响编辑器其他请求。
- 删除/复制节点、删除/重排组件、保存 Prefab：这些是破坏性编辑能力，与当前“运行时修改、不脏化 Scene”的安全边界冲突。
- 旧版内置代码执行器、LocalStorage/全局变量面板：已由内嵌 DevTools Console/Application/Sources 覆盖。
- `aa_low_version.js` / `app_low_electron.js` 双份实现：当前 TypeScript 单实现已有 Electron 跨代降级，不复制双份维护成本。

验证命令：`npm test`。
