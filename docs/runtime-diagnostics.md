# Game Agent 运行时诊断

使用已安装的 `/Users/mac/.CocosCreator/packages/game_agent`，先通过认证 CLI 确认项目、Creator 版本和 PID：

```sh
node /Users/mac/.CocosCreator/packages/game_agent/creator2x/mcp-sidecar/cli.mjs editors
node /Users/mac/.CocosCreator/packages/game_agent/creator2x/mcp-sidecar/cli.mjs help runtime_environment --project /absolute/project/path
node /Users/mac/.CocosCreator/packages/game_agent/creator2x/mcp-sidecar/cli.mjs call runtime_environment --project /absolute/project/path --args '{}'
```

| 工具 | 参数 | 返回及边界 |
|---|---|---|
| `runtime_trace_node` | uuid；durationMs 50–1500（默认500）；maxEvents 1–64（默认32）；includeStack（默认false） | 短时监听原生位置、尺寸、缩放、旋转、颜色、激活、子节点等事件；返回前后值、帧、可选同步发射栈。节点销毁保留记录并标记 terminalReason。 |
| `runtime_hit_candidates` | x、y：Preview 视口 CSS client 坐标；limit 1–32 | 按现有相机/节点顺序返回有界、去重的重叠候选，含 UUID、路径、组件与相机。geometryOnly=true，不等于真正输入接收者。 |
| `runtime_render_summary` | durationMs 50–1000（默认200）；limit 1–64（默认32） | 临时复用已有渲染 hook，返回拆批双方、原因、帧/场景、framesObserved；采集后恢复状态，保留用户原已开启或中途接管的调试器。 |
| `runtime_environment` | 无 | 引擎版本、设备与平台、分辨率、物理/碰撞、动态图集及下载并发等白名单。 |
| `runtime_storage` | 可选 keys（1–8个指定键）、prefix、limit 1–64 | 默认只列键及 UTF-16 字符长度 size；仅显式指定 keys 时读取值。敏感键和值遮蔽；每值最多2048字符；Game Agent 输出预算可能进一步截断并标记 truncated。无写入。 |

追踪和渲染采集是单次观察，不创建持久会话或暂停游戏；可与另一个已授权操作并行安排以观察触发过程。调用结束、取消、导航或场景变化会清理监听；不同调用以私有 owner/request ID 隔离。已执行的业务操作不会因取消诊断而回滚。

无事件不能证明节点没有变化；没有原生事件覆盖的字段不会被追踪。调用栈是同步事件发射链，异步任务的原始发起者可能不在其中。渲染的“疑似纹理”仍是推测；没有新完成帧时 frame=null。引擎不支持所需 hook 时返回明确失败，不伪造结果。

更新后需要 Creator 重新加载两插件并重开桥接面板。`help runtime_environment` 应能发现新工具；`help get_node_detail` 应包含 includeRuntime。Game Agent 工具目录指纹升级至 v11，旧工具目录不会继续被新会话复用。

测试：bridge `npm test` 包含构建、探针、实际面板处理函数及 Router 取消测试；Game Agent `npm test` 包含工具目录、参数、授权边界、取消与输出过滤。Node 测试与真实 Creator Preview 验证分开记录。
