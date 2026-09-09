# pi-web 源码研究：会话、扩展桥与 Wayfinder 节点

研究日期：2026-09-08。范围是用户提出的本地 Pi Web UI、ticket 对应会话、画布与扩展衔接；未实现产品代码，未启动真实用户会话，未读取模型凭据。

本文以 `agegr/pi-web` commit `a26cc68df9227cb74253bddd7c59624aa475e61f` 为固定快照。该快照 package version 为 `0.9.0`，依赖的 Pi 四个包均精确锁定 `0.85.1`，不是任意最新 SDK。[package.json](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/package.json#L1-L67)

## 结论

**用户提出的“ticket 成为画布上的会话入口，第一次进入就启动 Wayfinder”与 pi-web 的基础能力相容。** 它已有按工作目录新建、恢复会话、流式聊天和 skill 命令加载。新增工作主要是画布、ticket 与 session 的关联，以及 tracker 变化到界面的更新；现成 extension UI 桥不会自动提供无限画布。[创建入口](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/new/route.ts#L18-L98)、[恢复入口](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/%5Bid%5D/route.ts#L25-L61)、[UI 桥](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1475-L1627)

**需要修正“先批量创建空 session”的实现理解。** pi-web 的 `ensure_session` 会产生真实 runtime 和 session id，但未持久化空会话被明确隐藏于历史列表；Pi 通常等首次 assistant 消息才写 JSONL。空 runtime 会被空闲回收。因此空节点可以先存在，但不能把这次 API 返回的空 session id 当作已经可靠保存的节点记录。[空会话创建](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/new/route.ts#L54-L85)、[历史过滤](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1823-L1846)、[回收](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L458-L475)

推断建议：**先把 ticket 显示为可点击节点，首次点击时创建并绑定 Pi 会话，随后发送 `/skill:wayfinder` 与地图、ticket 定位信息。** 用户仍感知“每个问题有自己的对话”。这是基于上述生命周期的候选实现，不是已确认的产品决策。

## 1. 它实际怎样运行

pi-web 是本地浏览器应用。README 的启动方式是 `npx @agegr/pi-web@latest`；CLI 等服务就绪后打开浏览器，默认地址为 `127.0.0.1:30141`。它与 Pi 共用本地配置和 session 文件；README 明示 `PI_CODING_AGENT_DIR` 可切换 agent 数据目录。[README](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/README.md#L18-L35)、[数据目录说明](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/README.md#L93-L98)

真实调用路径是：

```text
React 浏览器界面
  ├─ POST /api/agent/new { cwd, type: "ensure_session", ... }
  ├─ POST /api/agent/<id> { type: "prompt", message: "..." }
  └─ GET  /api/agent/<id>/events                    ← SSE
              ↓
Next.js 服务内 AgentSessionWrapper / rpc-manager.ts
              ↓
createAgentSessionServices + createAgentSessionFromServices
              ↓
同一 Node.js 进程中的 Pi AgentSession.prompt / subscribe
```

虽然文件和类仍叫 `rpc-manager`、`RpcSession`，这里没有通过 stdin/stdout 启动 `pi --mode rpc` 子进程；Pi SDK 被直接 import 并创建。`mode: "rpc"` 是传给 extension binding 的运行模式标签，不能据此反推进程结构。[SDK import](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1-L2)、[构建 services](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1988-L2036)、[创建 AgentSession](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L2059-L2067)、[执行 prompt](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L610-L625)、[SSE 路由](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/%5Bid%5D/events/route.ts#L7-L38)

## 2. 工作目录和 session API

| 能力 | 当前机制 | 与本次设想的关系 |
| --- | --- | --- |
| 选择目录 | `POST /api/cwd/validate` 规范化路径、检查目录存在，再登记文件访问根 | 无要求目录是 Git 仓库；不是“导入用户仓库”流程 |
| 创建 | `POST /api/agent/new`；`type: ensure_session` 只建立 runtime；其他 type 可紧接发送命令 | 可复用首次节点启动入口 |
| 列表 | `GET /api/sessions` 合并磁盘会话与符合显示条件的 runtime | 不能单靠这份列表呈现未开始的 ticket |
| 恢复和发送 | `POST /api/agent/<id>` 优先取活跃 wrapper；否则查文件并重建 session | 可复用点击已有节点继续聊 |
| 流式事件 | `GET /api/agent/<id>/events` | 可复用节点内聊天流 |
| 标题 | `set_session_name` 调 Pi `setSessionName` | 可让会话名对应问题标题，但不能替代 ticket 类型/状态/摘要等数据 |
| Fork | `fork` / `fork_branch` / `clone` 从旧消息路径创建另一会话 | 用于历史衍生，不自动表达“被哪些 ticket 阻塞” |
| 会话内部导航 | `navigate_tree` 调 `inner.navigateTree` | 一个 session 内切换历史分支；不是跨 ticket 地图 |

逐项来源：[目录验证](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/cwd/validate/route.ts#L9-L45)、[创建](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/new/route.ts#L18-L98)、[列表合并](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/sessions/route.ts#L16-L34)、[恢复](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/%5Bid%5D/route.ts#L25-L61)、[命名](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L838-L843)、[fork/clone/navigation](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L718-L812)。

界面的新建按钮先生成一个客户端临时 UUID，回调打开新聊天；真正 session 由 `ensureNewSession` 调后端产生，其 id 会替换临时 id。打开旧 session 会把当前选择目录同步到该 session 的 cwd。已有会话加载时使用其 SessionManager 保存的 cwd，不会因工作目录选择器改变而自动搬迁原会话。[界面新建和选择](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/components/SessionSidebar.tsx#L928-L946)、[ensureNewSession](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L607-L639)、[保存的 cwd](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1944-L1951)

### 空 session 的具体边界

pi-web 自己的注释与判断明确区分 runtime 和磁盘文件：只有正在运行、已有首条用户消息的未持久化会话，才临时进入列表；idle empty runtime 不显示。默认空闲回收时间是十分钟，可配置。另有一个 Bash-only 特殊处理：手写 SDK 生成的 header/entries 并设置内部 `flushed` 字段，不是空会话通用 API。[显示规则](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1823-L1866)、[默认回收时间](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/README.md#L43-L52)、[Bash-only 特殊处理](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L478-L495)

因此，提前创建几十个空 runtime 会同时加载服务、资源与扩展，还不能获得稳定的已保存节点列表。节点可以先由已有 ticket 数据支持，真实 session 按需要产生。这是成本与生命周期推断，没有做性能基准。

## 3. Wayfinder 在 Pi 中怎样调用

`get_commands` 将 extension commands、prompt templates、skills 分开列出；skills 的 invocation name 明确是 `skill:<skill.name>`。因此已加载的 Wayfinder skill 对应 **`/skill:wayfinder`**；`/wayfinder` 只有在另有同名 extension command 或 prompt template 时才有等价保证，不能直接照搬其他 Agent 的 slash 语法。[命令汇总源码](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L889-L915)

浏览器对 `/compact`、`/reload`、`/name`、`/session`、`/copy`、`/clone` 有本地分派；其余 slash 输入继续作为 prompt 交给 SDK。通用发送路径只是把原始 `message` 通过 `type: prompt` 传给服务器，并先打开 SSE，不需要模拟按键。[内置 slash 分派](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L1606-L1698)、[发送路径](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L1335-L1365)

候选启动文本：

```text
/skill:wayfinder 继续地图「内容方向探索」（<地图链接或本地路径>），
本次处理「第一期到底讲哪个问题」（<ticket 链接或本地路径>）。
```

文本参数怎样被 Wayfinder 解读，依赖已安装 skill 内容与 tracker 配置；`#123` 没有在这条传输链中变成原生 issue 对象。建议绑定明确定位信息并展示问题名称。此处是调用建议，尚未对真实 Wayfinder 会话做端到端验证。

另外，pi-web 的 Chat-only 模式会禁用 extensions/skills 等资源，因此不能为 Wayfinder 节点选择该模式并期待 skill 自动可用。常规非空工具预设会保留 extension tools。[Chat-only 判断与资源加载](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1960-L2035)、[激活 extension tools](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L2085-L2089)

## 4. Extensions 能力如何抵达浏览器

pi-web 给 Pi extensions 绑定自己的 UI context，将 UI 请求编码为 SSE，再把浏览器回复传回正在等待的扩展。已实现 select、confirm、input、editor、notify、status、widget、title、编辑器预填与 custom TUI 面板。[绑定](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L338-L369)、[UI methods](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1475-L1600)

但 `ui.custom` 在这里是**服务端执行 TUI component 的 `render(width)`，把 `string[]` 发给浏览器**；键盘输入再传回 component.handleInput。浏览器渲染的是对应文字面板，而非加载 extension 提供的 React/HTML 组件。[custom render](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1294-L1337)、[factory 执行](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1349-L1409)、[浏览器面板](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/components/ChatWindow.tsx#L1748-L1778)

`setHeader`、`setFooter`、`setEditorComponent` 等当前是 no-op。扩展命令上下文里的 **newSession、fork、switchSession 均直接返回 `{cancelled:true}`**；navigateTree、reload 则有实际实现。所以“写一个 extension 调 Pi 的新建/切换会话 API，就无须改 pi-web”在这个快照上不成立。[no-op UI](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1563-L1600)、[扩展会话动作](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1603-L1627)

发现的浏览器下游扩展点是 session-row context menu 事件，可让 Electron 等包装器接管右键菜单；README 明确其独立于 Pi agent extensions。这不是任意画布面板挂载协议。服务端另有 liveness registry，作用是延长有后台工作的 session 存活时间，也不是创建地图的协议。[下游右键菜单](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/README.md#L101-L123)、[liveness](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/README.md#L125-L145)

根据本次对入口、UI bridge 与 app/components/lib 的检索，没有发现供 Pi extension 直接安装任意无限画布的现成入口。合理推断是需要修改 Web UI，或自建读取同一服务的浏览器视图；不是声明 Pi extension 在 Node 层绝无其他自定义实现可能。

### 一个更轻的更新信号通路

Pi 配套研究确认 `pi.appendEntry` 会在 SDK 发出 `entry_appended`。pi-web 的 wrapper 订阅全部 SDK 事件并原样 `emit`；SSE wire 只滤去 `turn_start`、`turn_end`，对 `entry_appended` 这样的其余事件原样返回。随后 SSE 编码、浏览器 JSON.parse、onEvent 到 React hook 的链路都已存在。[wrapper 订阅](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L296-L305)、[wire 过滤](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/agent-event-wire.ts#L26-L29)、[其他事件原样返回](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/agent-event-wire.ts#L96-L107)、[SSE 编码](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/agent-event-stream.ts#L59-L65)、[浏览器解码](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/agent-event-connection.ts#L140-L158)、[hook 接收](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L361-L364)

当前 hook 的 switch 没有消费 `entry_appended` 的分支，需要添加。**推断：可以让 extension 在确知 tracker 变化后 append 一个小型自定义条目，现有 SSE 把通知传给 UI，再刷新地图；未必需要另建事件总线。** 这里核查了传输源码，未对真实 extension 做端到端实验。事件是实时信号，不能代替 tracker 的持久记录；切换会话、关闭 SSE 或刷新后仍应重新读取状态。[当前事件处理](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L1054-L1284)

## 5. 当前的“树”究竟是什么

需要以实现校正仓库文字说明：`AGENTS.md` 仍描述 fork 在 sidebar 按 parentSession 嵌套，但当前真实 sidebar 使用 `listSessionFamilies`，把主会话和 fork 各自作为独立 root，subagents 收到各自 family，按最近活动排序为列表。`lib/session-tree.ts` 的当前注释也明确“Forks remain roots; only subagents nest”。[sidebar 实际入口](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/components/SessionSidebar.tsx#L1006-L1013)、[实际列表渲染](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/components/SessionSidebar.tsx#L1697-L1732)、[family 分组](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/session-family.ts#L45-L68)、[session-tree](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/session-tree.ts#L8-L19)

fork 的来源仍被保存和读取：session header 的 parentSession 路径被映射为 `relation.kind: fork` 与 originSessionId；另一类 `relation.kind: subagent` 有独立语义。它们没有 ticket blocker 含义。[关系解析](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/session-reader.ts#L143-L173)

会话内部还有消息分支导航：`navigate_tree` 调同一 AgentSession 的树导航。这代表“从哪段历史继续”，不代表“哪个决定完成后才能解锁另一个决定”。[navigate_tree](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L807-L812)

## 6. 可复用什么，需要新增什么

以下是基于源码的集成判断，并非已接受架构：

- 可复用：工作目录选择、session 创建/恢复/命名、聊天输入与渲染、SSE 与运行状态、模型/工具配置、skill 命令加载、已有 extension 交互桥。
- 需要新增：ticket → node 的投影，问题标题/摘要/类型/状态/依赖的读取，node 与 Pi session 的绑定，首次启动文本，画布布局与定位，tracker 更新后的刷新。
- 待选择：直接改 pi-web 还是以其 SDK/HTTP 路径为参考建小型宿主；如何让 GitHub 与 Markdown 的变化变成可靠地图更新；预填启动文本还是首次点击自动提交；一个 ticket 是否允许后续新增另一 session。

无需为当前研究引入仓库导入、GitHub 账号管理或软件交付流水线。GitHub/本地 tracker 的配置与操作可继续由 Wayfinder 承担，Web UI 为可视化读取其必要数据；它读哪种格式、何时刷新仍须在接入实验中明确。

## 7. 验证边界

本笔记主要是固定 commit 的源码审阅，不是已跑通产品的证明。本次没有安装依赖、启动 pi-web 或调用模型。主研究者另执行 `listSessionFamilies` 无凭据纯函数 probe，确认 fork 为独立 family、subagent 归入 parent，结果 PASS；这只验证分组语义。版本对应的 Pi session 持久化和 extension 细节由配套 Pi 研究笔记核对。下一次最有价值的无产品化实验是：一个临时目录中创建两张本地票，呈现未开始节点，点击其中一张生成 session 并投递 skill 命令，刷新/重启后确认绑定可恢复；再观察关闭前置票后后继节点状态是否更新。
