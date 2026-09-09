# Pi 的 Skill、Extension 与会话能力核查

研究日期：2026-09-08。问题范围：把 Wayfinder 的 ticket 变成画布上的会话入口，Pi 已提供哪些能力，还缺哪几处连接。只研究，未改产品代码、未读取凭据、未启动模型。

## 版本与证据边界

本报告以 **Pi 0.85.1 发布提交 `d981de1229ef899957bbe968bc8dcda02a21f477`** 为依据，和此次 pi-web 研究中的依赖版本一致。另检查了 Pi main `faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19`；main 虽然仍写 0.85.1，部分实现已有变化，以下链接全部锁定发布提交。版本见 [package.json](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/package.json#L1-L4)。

标记说明：**事实**来自官方文档、源码及仓库已有测试；**推断/建议**是针对 Beacon 的判断；**待验证**不能视为已经跑通。本文未运行 Pi 测试或 SDK 实验；引用测试仅证明上游已有对应测试用例，不能声称本次测试通过。

## 1. 四种能力分别做什么

| 能力 | 官方事实 | 对这次想法的含义（推断） |
|---|---|---|
| Skill | 按需加载的工作方法、说明、脚本和参考资料；启动时先向模型展示名称和描述，匹配后再读取正文。[Skills](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L3-L7)、[加载过程](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L65-L71) | Wayfinder 继续规定怎样提问、查资料、维护地图；加载说明本身不等于执行了硬性状态机。 |
| Extension | 运行 TypeScript，注册模型可调用工具、命令、事件处理器及终端界面。[Extensions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L3-L26) | 适合加“地图发生变化”的程序化连接。 |
| SDK | 嵌入应用、创建自定义 UI；`createAgentSession()` 创建单个会话，`AgentSession` 管理历史、模型状态和事件流。[SDK](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md#L3-L12)、[会话工厂](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md#L46-L68) | Web 服务可以承载会话，无须模拟终端键盘输入。 |
| RPC | `pi --mode rpc` 通过进程 stdin/stdout 的 JSONL 命令、响应和事件供外部应用控制。[RPC](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/rpc.md#L1-L26) | 是 SDK 之外的进程接入方式；不能因 pi-web 消息叫 RPC 就假定它在运行官方 RPC 子进程。 |

## 2. Wayfinder 可以直接加载，正确命令是 `/skill:wayfinder`

**事实：**Pi 默认发现 `~/.agents/skills/`，也支持 `~/.pi/agent/skills/`、配置中的额外路径和 CLI `--skill <path>`。所以本机用户给出的 `/Users/neuron/.agents/skills/wayfinder/SKILL.md` 符合默认发现位置；实际是否启用、是否名称冲突还取决于运行配置。[发现规则](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L20-L42)、[名称冲突](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L179-L189)

**事实：**Pi 的通用 Skill 命令是 `/skill:name`，并非裸 `/wayfinder`。源码读取匹配 Skill，移除 frontmatter，再把正文和参数放入发给模型的内容；找不到 Skill 会把原始文字继续传下去，所以发送命令成功不能证明 Skill 已加载。[命令文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L74-L93)、[实际展开实现](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L1348-L1376)

**建议：**首次进入节点可以直接发送这样的启动文本，而不需要真的“敲键盘”：

```text
/skill:wayfinder 继续地图「这次探索的标题」：<地图路径或链接>。
处理 ticket「这个问题的标题」：<ticket 文件路径或完整 issue 链接>。
```

若由 Extension 调 `pi.sendUserMessage()` 发送，必须显式给 `{ expandPromptTemplates: true }` 才会展开 Skill；该选项默认 false，且发送会真正触发一轮模型运行。官方 RPC 的 `prompt` 则会展开 Skill 命令。[Extension 发送接口](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1439-L1467)、[RPC prompt](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/rpc.md#L44-L79)

**事实与限制：**`#123` 并非自动取 issue 内容的内建通用引用协议。官方提供了额外的 GitHub issue 自动补全示例：要求 `gh` 和 GitHub 仓库上下文，补全值仍是 `#编号`。[示例前提](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/github-issue-autocomplete.ts#L1-L2)、[补全值](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/github-issue-autocomplete.ts#L62-L68)。使用完整路径/链接更能明确节点所指；无须为了引用节点要求工作目录是 Git 仓库。

**待验证：**Skill 加载不代表 Matt 全套调用习惯已适配 Pi。正文中 `/grilling`、`/research` 等引用，研究子代理的启动方式，以及需要真人参与的对话，都要以真实流程验证。另可由 Extension 的 `resources_discover` 提供额外 Skill 路径，无须强制搬文件。[动态资源接口](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L370-L387)

## 3. Extension 能监听工具，但“创建了 issue”不是内建事件

**事实：**`tool_result` 在工具执行后触发，包含工具名、调用 ID、输入、输出、错误标志及 details；可以修改返回结果。并行工具的结果事件按完成顺序交错，不能假定按模型原始调用顺序到达。[事件文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L842-L875)、[事件类型](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts#L956-L1021)

**推断：**监听 `bash` 里有没有 `gh issue create` 可以做演示，但不能可靠识别所有 ticket 变化：同样的创建可以经脚本、API 或本地 write/edit 完成；一次工具调用可以改多票，也可能部分成功。Shell 返回的是文本及截断相关 details，并没有标准的 ticket ID/依赖字段；输出也可能被截断。[Bash 输入和 details](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/tools/bash.ts#L37-L52)

**建议：**可以保留现有 tracker，让工具完成后触发“重新读取相关地图”的刷新；或者提供一个有结构化参数/结果的 Extension 工具，完成 tracker 操作并把 ticket 变化通知 UI。前者仍需解决本地文件/GitHub状态读取，后者需让 Skill 知道使用该工具。仅在自然语言输出中找“我创建了票”不够。注册自定义工具和恢复结构化工具结果已有官方示例。[工具能力](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L9-L16)、[todo 状态恢复示例](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/todo.ts#L105-L127)

## 4. Extension 到 Web 的连接已有接口，但仍需 UI 接收

**事实：**`pi.events` 是共享事件总线，SDK host 可以把同一个 `eventBus` 传给 `DefaultResourceLoader`，在外部监听 Extension 发出的消息。源码使用 Node `EventEmitter`；它不是自动跨进程、跨浏览器的通信或持久队列。[SDK 共享总线](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md#L658-L670)、[实现](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/event-bus.ts#L1-L33)

**事实：**`pi.appendEntry(customType, data)` 还能保存不进入模型上下文的自定义数据；`session_start` 时可读 entries 恢复。实现同时发出 `entry_appended`，SDK 订阅者能收到，官方 RPC 也经事件流转发。[appendEntry 文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1471-L1486)、[事件发射](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L2593-L2598)、[RPC 订阅转发](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L353-L360)、[非 message_update 事件原样返回](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/json-event.ts#L46-L51)

**建议：**这足够承载 ticket 绑定或地图刷新通知，不需要让 Agent 输出一段特制自然语言供前端猜。但 Web 仍要实现接收、节点映射、重连后读取；首次会话落盘还有下一节的限制。`pi.setSessionName()` 可同步问题标题，不能独自表示 ticket 状态及依赖。[会话名称接口](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1489-L1505)

## 5. “创建一批空 session”需要分清两种 API

**事实：**Extension 的 `ctx.newSession()` 是命令上下文能力，文档明确因为可能死锁，不在普通事件处理器提供。它创建并切换到替代会话，旧会话的 Extension 被关闭，新实例重新绑定；不能把它当作 `tool_result` 内批量创建后台会话的接口。[上下文限制](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1109-L1111)、[newSession](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1139-L1170)、[替换生命周期](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L1260-L1269)

**事实：**SDK 的 `SessionManager.create(cwd, sessionDir, options)` 可以创建独立会话管理对象，`createAgentSession()` 创建运行会话；切换活动会话则有 `AgentSessionRuntime`。Extension 本身能使用 Node/包代码，因此不能说它“绝对不能创建别的 session”，但这需要另行编排 SDK 对象或交给 host，并让 UI 能找到它们。[SessionManager.create](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts#L1546-L1554)、[Runtime 职责](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md#L114-L167)、[Extension 可用包及 Node](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L139-L152)

**重要事实：正常新建会话不会立即写 JSONL 文件。**`newSession()` 分配 ID、header 和未来路径，把 `flushed` 设为 false；`_persist()` 在未出现 assistant 消息且尚未 flushed 时直接返回。只调用 `appendCustomEntry()` 或设置名称，没有绕过该规则。[初始化](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts#L926-L951)、[落盘条件](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts#L1029-L1062)、[custom 和名称同走 append](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts#L1135-L1163)

上游已有分支测试覆盖“没有 assistant 时文件不存在，追加 custom entry，assistant 后一次性写入”。此外 `SessionManager.open()` 打开已存在的零字节文件会立即初始化 header；这是不同路径，不能因此宣称标准 create 会立即持久化。未找到专门公开的 `flushEmptySession()` API。[延迟持久化测试](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/test/session-manager/tree-traversal.test.ts#L487-L515)、[已有空文件路径与测试](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/test/session-manager/file-operations.test.ts#L342-L359)

**建议：**可以先保存 ticket 对应的画布节点和待启动提示词，用户首次点开才创建 Pi 会话并绑定。视觉上仍然是“票产生了就有会话入口”，不必预启动许多空 Agent。若坚持提前创建真实 session，则需要明确处理未落盘会话的恢复，不能只依赖 Pi 现有历史列表。

## 6. Pi 的树与问题地图不是同一份数据

**事实：**Pi 内建 `/tree` 展示单个 JSONL 会话里的消息分支，以 entry 的 `id/parentId` 表示；跳转改变当前叶子。`/fork` 和 `/clone` 则产生新文件。[消息树](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sessions.md#L69-L85)、[三种操作区别](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sessions.md#L118-L127)

**推断：**这能支持聊天内部尝试不同路线，但没有自动给出 Wayfinder ticket 的 blocking、已解决、research 等业务含义。Beacon 可以复用会话而另画 ticket 关系；不必把每条消息都画成节点，也不必为了 ticket 的依赖强制复制上游聊天全文。

## 7. Research 子代理和界面渲染的两个边界

**事实：**Pi 官方明确不内建 sub-agents，而鼓励 Extension 或外部 Pi 实例。官方示例提供 `subagent` 工具，以独立 Pi 进程运行，使用 JSON 模式捕获输出；示例参数含 `--no-session`，所以不能直接把示例子任务当成已有持久会话节点。[官方取舍](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/README.md#L493-L507)、[示例方式](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent/index.ts#L1-L14)、[进程参数](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent/index.ts#L300-L306)

pi-web 自带另一套 subagent Extension，由 pi-web 报告单独核查；不能把“Pi 核心没有内建”误写成“pi-web 不支持”。对于 Wayfinder 的 research 票，这个能力归 host/Extension 配置，Skill 本身不会凭空产生子代理运行机制。

**事实：**Pi 的 `ctx.ui.custom()`、工具 renderer 主要是 TUI 组件能力；官方 RPC 只将选择、确认、输入等方法桥接为 UI 消息，`custom()` 返回 undefined，页眉页脚等方法也有降级。因此安装一个 Pi Extension 不会自动在任意 Web UI 中生成无限画布。[TUI 能力定义](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#L9-L16)、[RPC UI 支持范围](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/rpc.md#L1183-L1205)

## 结论与最小待验证项

**研究判断：用户设想可落在现有 Pi 能力上。** Skill 继续维护探索，Web UI 将问题对应为会话入口，Extension/host 将 tracker 变化通知画布。值得修正的是“通过 ctx.newSession 批量预建并自动持久化空 session”的具体手法，以及 `/wayfinder` 的裸命令写法。

进入实现前，只需要用一个小流程确认这几件事：本地 Wayfinder 加载及内部 Skill 引用；新票出现后画布能恢复；第一次点击正确启动该票、第二次点击续聊；完成/新增/依赖变化能同步；research Extension 的子任务是否能与同一 ticket 节点关联。这些是待验证项，不是本次已经跑通的产品行为。
