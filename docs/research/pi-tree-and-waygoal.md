# Pi 会话树与 Waygoal 的适配边界

核对日期：2026-09-09。只读研究；本文提出适配建议，不表示产品已实现或已修改 ADR。

## 结论

Pi 本身已支持非线性会话，不需要 Matt skills 或 tracker 才能分支。`/tree` 是单个会话内部的历史树，`/fork`、`/clone` 创建独立会话。Waygoal 可以复用这些能力，提供画布导航；票据、依赖和完成状态是可选的工作记录层，不能从会话树连线推导。依据：下述 S1–S5。

## 核对范围与来源

当前安装包为 `@earendil-works/pi-coding-agent` **0.85.1**，见 [package.json](../../apps/web/node_modules/@earendil-works/pi-coding-agent/package.json)。Pi-web 当前 HEAD 为 `a26cc68df9227cb74253bddd7c59624aa475e61f`，工作区含本地修改；以下 pi-web 结论以当前文件为准。

- **S1 — 官方会话说明**：[本地 sessions.md](../../apps/web/node_modules/@earendil-works/pi-coding-agent/docs/sessions.md)，第 69–140 行；[官方在线版本](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md)。本版已没有单独的 `docs/tree.md`，相关内容集中在 sessions.md。
- **S2 — 格式与 SDK**：[session-format.md](../../apps/web/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md)，第 191–200、308–338 行；[sdk.md](../../apps/web/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)，第 755–855 行。
- **S3 — 上下文构建**：[session-manager.js](../../apps/web/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js)，第 124–236 行。
- **S4 — 树导航实现**：[agent-session.js](../../apps/web/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js)，第 2471–2633 行。
- **S5 — 独立分支实现**：[session-manager.js](../../apps/web/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js)，第 1093–1183 行；[agent-session-runtime.js](../../apps/web/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.js)，`fork()` 第 174 行起。
- **S6 — Pi-web 接入**：[rpc-manager.ts](../../apps/web/lib/rpc-manager.ts)，第 720–814 行；[session GET API](../../apps/web/app/api/sessions/[id]/route.ts)，第 35–105 行。
- **S7 — Pi-web 导航界面**：[BranchNavigator.tsx](../../apps/web/components/BranchNavigator.tsx)，第 26–110、256 行起；[useAgentSession.ts](../../apps/web/hooks/useAgentSession.ts)，第 1453–1493 行；[project-tree.ts](../../apps/web/lib/project-tree.ts)，第 1–95 行；[AppShell.tsx](../../apps/web/components/AppShell.tsx)，第 995–1007 行。

## Pi 的三种分支动作

| 动作 | 保存方式 | 上下文与用途 |
| --- | --- | --- |
| `/tree` | 同一个 JSONL 会话文件，entry 通过 `id` / `parentId` 形成树 | 回到先前位置，在同一会话内探索另一种路线；旧路线仍保存 |
| `/fork` | 新会话文件 | 默认复制选定用户消息之前的历史，将该消息提供给编辑器，可修改后开始新的会话 |
| `/clone` | 新会话文件 | 复制当前活动路径，继续已积累的工作；不是复制原会话的全部分支 |

这是已核对的 Pi 行为（S1、S2、S5）。Pi-web 的包装存在自己的动作与返回值，不能假设它逐项提供 CLI 的完整交互（S6）。

树节点在 Pi 底层是消息、工具结果、压缩记录、标签等 entry，**不是一张票据，也不是一个独立 session**。不同会话之间通过 header 中的 `parentSession` 记录来源文件；这是另一层关系（S1、S2）。

## 导航怎样影响上下文

`buildSessionContext` 从活动叶子沿 `parentId` 回到根，只构建这条路径；存在压缩时，使用对应压缩摘要及保留历史。其他兄弟分支不会自动全部进入模型上下文。普通 `custom` entry 不参与上下文；`custom_message` 和有效的 `branch_summary` 会参与（S3）。

SDK `navigateTree(targetId, { summarize: false })` 默认不生成新摘要。用户选择总结时，可以把离开分支到公共祖先之间的内容总结并附在新位置，也能提供总结重点；CLI 提供“不总结、默认总结、自定重点”三个选项。该总结不是必须发生的导航副作用（S1、S4）。

但 **不总结不等于不改变活动上下文**：真正执行 `navigateTree` 会切换活动叶子并替换 Agent 的消息路径。选择用户消息时实际回到它的父 entry，并把该用户消息文本返回编辑器；选择助手等非用户 entry 则落在目标 entry（S4）。

Waygoal 应据此区分两个意图（建议，未实现）：

- **查看历史／画布定位**：只读取和展示目标位置，不调用会改变活动路径的导航，也不调用模型总结。
- **从这里继续**：用户明确选择后，再复用 Pi 的树导航或分出会话能力。

“把分支结论带回原讨论”属于明确交接，可研究复用 Pi branch summary；Pi 原生摘要并不自动知道哪张票已解决、该回哪段业务讨论，也不自动把 tracker 正式结论合并进来（S4、S5）。

## Fork 已经保留了什么，缺什么

`createBranchedSession` 创建新 session ID，复制选中路径，保留路径 entry ID（标签会重建并重接 parentId），header 保留 `cwd` 和 `parentSession`。它不保存结构化的“分出原因”“待返回问题”“对应票据”，也没有独立的 `originEntryId` header 字段（S5）。

因而跨会话引用至少需要把 **session ID 与 entry ID 一起使用**；fork 会复制 entry ID，单独一个 entry ID 不能当全局定位。若要可靠恢复分支起点，建议 Waygoal 在操作发生时记录来源会话与来源 entry，不仅依靠日后比对复制历史（由 S5 推导）。

## Pi-web 不是只有线性会话列表

当前 Pi-web 已有以下能力（S6、S7）：

- `GET /api/sessions/[id]` 返回 tree、leafId、context，以及解析出的父会话关系。
- `BranchNavigator` 展示分支，服务端投影把长的单链收缩为分叉点／叶子，并用现有消息前缀做短预览；无需额外模型生成。
- 命令处理已有 `navigate_tree`、`fork`、`fork_branch`、`clone`；`fork_branch` 从指定 entry 包含式复制路径，AppShell 的引用后新聊使用它。
- `navigate_tree` 当前传空 options，因此不启用新分支总结；但点击分支的 hook 会实际发出导航命令，并非纯只读预览。该路径会忽略异步错误，若 Waygoal 引入只读查看／继续区分，不宜直接照搬。

这些是代码证据，本轮没有进行浏览器操作或模型调用，不能声称用户体验已验证。

## 无 Matt 时的最小适配建议

画布以现有会话、分支点、来源关系为基础。用户用普通 Pi 聊天或任何其他 skills，依然能查看、分叉、返回和定位。无需为了让画布出现而创建票据，也无需自动语义分析聊天（来自 S1–S7 的产品推导）。

| Pi 可复用 | Waygoal 还需负责 |
| --- | --- |
| 原始会话保存、消息树、活动路径、标签 | 画布布局、视野、适当收缩分支的表现形式 |
| Fork / clone 与父 session 文件来源 | 来源 session + entry 的稳定定位，明确返回位置 |
| 可选分支总结 | 用户何时主动请求交接，以及关联结论的来源 |
| 会话与消息读取 | 可选 ticket 绑定、tracker 快照、依赖／状态展示 |

没有票据时，连线只表达从哪里分出，不能赋予“解决前者才解锁后者”的含义。会话不再生成消息也不能推断工作完成。使用 Matt 和 tracker 后，再呈现有正式记录支撑的依赖、解锁和地图完成状态（结合当前 [ADR 0003](../adr/0003-discussion-and-ticket-map.md) 的边界）。

“无 Matt 也能使用”是用户最新明确的产品要求；会话节点的具体展示粒度及其与可选票据的绑定形式仍是适配建议。本轮仅记录研究，尚未更新定位及领域文档。

## 随产品附带 skills 与首次配置

Pi 0.85.1 支持从 `~/.pi/agent/skills/`、`~/.agents/skills/`、工作目录资源以及包内的 `skills/` 或 `pi.skills` 声明加载技能；SDK 资源加载器也提供 `additionalSkillPaths` 和 `skillsOverride`。因此 Waygoal 可以随产品提供原始技能资源，由宿主加载，并不必须在首次启动时替用户全局安装。依据：[本地技能文档](../../apps/web/node_modules/@earendil-works/pi-coding-agent/docs/skills.md)、[SDK 类型](../../apps/web/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.d.ts)、[官方 skills 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[官方包文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)。

内置 Matt、可选择使用、保留用户自有技能是可行的交付方向；同名技能默认采用发现顺序中的第一份，所以“用户版本优先”需要宿主明确处理，不能假设已自带该优先级。打包时固定所提供的版本，保留完整技能依赖、资源及原始版权许可。Matt 当前仓库提供 [MIT 许可证](https://github.com/mattpocock/skills/blob/main/LICENSE)。本轮没有执行安装或修改任何全局配置。

安装与 setup 分开：本机 `setup-matt-pocock-skills/SKILL.md` 配置工作目录中的 tracker、triage labels 和领域文档，不负责下载技能。普通聊天不需要 setup；用户进入需要这些配置的 Matt 工作流时，可以用固定小提示提供 `/skill:setup-matt-pocock-skills` 入口，由用户主动启动。已有配置时沿用。没有 Matt 或没有票据的会话仍应能使用基础画布导航；内置技能并不意味着每次聊天自动执行 Matt 流程。
