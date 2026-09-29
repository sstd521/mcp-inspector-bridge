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

| `runtime_bundle_inventory` | 可选 bundle、type（精确匹配）、cached；offset 0–20000（默认0）、limit 1–50（默认25） | 已加载 Bundle 的配置成员与全局缓存交集/差集；保留未缓存的 packed 条目、全部可观察成员关系，区分 cached、loaded、refCount。返回有界汇总与分页完整性。 |
| `runtime_asset_detail` | uuid | 单资源快照、Bundle 成员关系、依赖缓存中的直接依赖和反向缓存依赖。缺少依赖记录明确不可用，不把空列表当作已知无依赖。 |

资源查询只读取当前 Preview，不触发加载、预加载、释放或常驻 hook。配置成员关系不等于独占物理归属；反向缓存依赖不等于节点、组件或 JavaScript 持有者。尺寸单位是像素，没有虚构内存字节。URL 使用标准解析并移除用户名、密码、查询参数与片段。未知 Bundle 返回 `BUNDLE_NOT_FOUND`；不存在的 UUID 返回 `found:false`。

初版只将可安全回查的标识作为 UUID：URL/路径形式的缓存键（例如 `loadRemote` 的 URL）、超长/无效标识会跳过，返回 `skippedIdentifiers` 并标记统计和反向依赖不完整，避免把带凭据的 URL 当作 UUID 输出。普通资源的 url 字段仍按标准 URL 解析后脱敏。缓存与配置各扫描最多 20000 项，并集最多 20000 条；Bundle 最多扫描128个，单次返回最多50条资源、50个汇总/成员关系/依赖。超过上限应缩小工程观察范围；`totalExact:false` 不能用于资源总量结论。

每次查询都是新快照，context 含 Preview 上下文、场景、引擎版本、采集时间和帧；分页期间运行时可能变化，不能当作冻结事务。检查 `totalExact`、`truncated`、`scanTruncated` 及嵌套完整性标志，再比较同一项目/场景的前后快照；Game Agent 的输出预算可能进一步截断；清单只返回完整资源条目，`outputTruncated` 标明输出裁剪，`nextOffset` 按实际交付条数推进。单条也无法交付时返回 `pageLimitReason:RESOURCE_ROW_TOO_LARGE`；单资源详情截断时，嵌套完整性标记同步失效。

追踪和渲染采集是单次观察，不创建持久会话或暂停游戏；可与另一个已授权操作并行安排以观察触发过程。调用结束、取消、导航或场景变化会清理监听；不同调用以私有 owner/request ID 隔离。已执行的业务操作不会因取消诊断而回滚。

无事件不能证明节点没有变化；没有原生事件覆盖的字段不会被追踪。调用栈是同步事件发射链，异步任务的原始发起者可能不在其中。渲染的“疑似纹理”仍是推测；没有新完成帧时 frame=null。引擎不支持所需 hook 时返回明确失败，不伪造结果。

更新后需要 Creator 重新加载两插件并重开桥接面板。`help runtime_bundle_inventory` 和 `help runtime_asset_detail` 应能发现新工具；`help get_node_detail` 应包含 includeRuntime。Game Agent 工具目录指纹升级至 v12，旧工具目录不会继续被新会话复用。

测试：bridge `npm test` 包含构建、探针、实际面板处理函数及 Router 取消测试；Game Agent `npm test` 包含工具目录、参数、授权边界、取消与输出过滤。Node 测试与真实 Creator Preview 验证分开记录。
