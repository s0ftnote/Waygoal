# Pi Web、Pi Extension 与 Wayfinder：集成研究

研究日期：2026-09-08。本文是源码研究与候选方案，不是已实现功能或已确认的产品规格。

## 问题与边界

Beacon 希望作为本地 Pi Web UI，沿用工作目录、模型、工具、skills 和 tracker 配置。需要研究的是：Wayfinder 创建 ticket 后，能否在无限画布中出现一个带标题、状态、依赖关系的会话入口，用户点击后开始或继续处理该 ticket。

本次不建设仓库导入、代码交付流水线、独立权限平台，也不改用户的 Pi 配置、全局 skill 或已有项目。

## 研究版本与证据

- pi-web：`agegr/pi-web`，commit `a26cc68df9227cb74253bddd7c59624aa475e61f`，package version `0.9.0`。它固定依赖 Pi `0.85.1`。[package.json](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/package.json)
- Pi：实际适配依据为发布版 `0.85.1`，tag / npm `gitHead` 均指向 `d981de1229ef899957bbe968bc8dcda02a21f477`；另外读取了 main 快照 `faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19`，涉及关键能力时与发布版核对。[发布版源码](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477)
- Wayfinder 与 local tracker：以用户本机提供的 [Wayfinder](/Users/neuron/.agents/skills/wayfinder/SKILL.md) 和 [Local Markdown tracker](/Users/neuron/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md) 为准。未用远程最新版覆盖用户使用的规则。
- 专题细节：[pi-web 源码研究](pi-web.md)、[Pi 扩展研究](pi-extensions.md)。

## 已确认：现有软件怎样工作

### 1. 用户选择本地目录即可

pi-web 的目录入口验证路径存在且为目录，然后选择它。新会话 API 接收 `cwd`，没有要求先导入 GitHub 仓库。Git 和 worktree 功能是额外能力，不能据此把所有工作限定为软件开发。[目录入口](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/cwd/validate/route.ts#L19-L54)、[新会话入口](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/new/route.ts#L17-L104)

### 2. pi-web 的宿主直接调用 Pi SDK

虽然文件名为 `rpc-manager.ts`，实际调用的是同进程中的 Pi SDK `createAgentSessionFromServices`。网页通过 HTTP 发送命令，通过 SSE 收事件。现有会话浏览、恢复、模型设置和聊天组件都是可复用基础，但其内部 API 不能未经测试就视为稳定的第三方插件协议。[运行时创建](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L2059-L2067)、[事件端点](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/%5Bid%5D/events/route.ts)

### 3. Skill 管工作方法，Extension 接入可编程行为

Pi 原生发现 `~/.agents/skills/`，因此用户当前的 Wayfinder 位置属于默认发现路径。显式技能命令是 `/skill:wayfinder`，后续参数交给 skill；裸 `/wayfinder` 需要另外注册对应命令，不能假设已存在。[Skills 文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L24-L83)

Extension 是运行在 Pi 侧的 TypeScript 模块，可注册工具、命令，监听输入、工具及会话事件，写入自定义会话条目。它可以帮助把 Agent 的行为与宿主连接起来，但不会自动获得修改网页 React 布局的能力。[Extensions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md)

### 4. “建票即建空 session”有持久化限制

pi-web 的 `ensure_session` 可以先创建一个运行时，用于查询命令，不立即发送 prompt。但它明确把尚未保存、尚无用户输入的空运行时排除在会话历史之外。Pi 的正常 `SessionManager.create()` 路径，在出现第一条 assistant 消息前不会把条目写入 JSONL；仅附加标题或 custom entry 也不能当作稳定占位文件使用。[ensure_session](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/app/api/agent/new/route.ts#L17-L104)、[空运行时过滤](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1823-L1852)、[Pi 持久化实现](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts#L1029-L1050)

因此“已创建 ticket”与“已存在一个可恢复的 Pi 会话”不能直接等同。这里指正常创建路径；不把手工拼 JSONL、假造 assistant 消息或利用特殊文件路径当作推荐集成方式。

### 5. 会话分支与 ticket 依赖有不同含义

pi-web 支持历史 fork 和同一会话内的 branch 导航。当前真正用于侧栏的 `listSessionFamilies` 把普通会话与 fork 保持为独立项，只把 subagent 后代归入父会话 family。仓库 AGENTS.md 中关于 fork 在侧栏嵌套的说明与当前源码不一致，研究以实际组件调用和函数为准。[实际分组](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/session-family.ts#L45-L68)、[侧栏组件](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/components/SessionSidebar.tsx#L1697-L1731)

Wayfinder 的关系应从 tracker 的 Map、ticket 和 blockers 读取。已有会话的 fork/subagent 关系不能直接充当“完成这个问题才能继续另一个问题”的依据。[Wayfinder 规则](/Users/neuron/.agents/skills/wayfinder/SKILL.md)

### 6. Extension 与网页之间已有部分桥接，但画布仍需 Web 代码

pi-web 已经适配若干 extension UI 方法，包括提示、选择、确认、输入、widget 和 custom TUI 的渲染桥接。它没有因此成为可任意安装 React 页面或替换侧栏的 UI 插件平台。[Extension UI 实现](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1294-L1600)

尤其是当前 extension command context 的 `newSession`、`fork`、`switchSession` 都直接返回 `cancelled: true`。网页自己的新建会话 API 可以使用，但不能把它与 extension 的同名动作混为一谈。[实际 action 实现](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L1603-L1615)

## 对用户设想的判断

| 设想 | 研究结论 |
| --- | --- |
| 切换工作目录后使用 Pi | 已有基础能力。 |
| 点击节点后自动启动 Wayfinder 并指明 ticket | 已有 prompt / skill 基础，Web 需补节点与会话绑定及首次启动逻辑。 |
| 每创建一票，画布立即出现一个入口 | 可实现；入口应以 ticket 为依据，无需等待真实会话开始。 |
| 一次预创建很多可恢复的空 Pi 会话 | 当前正常会话持久化语义不直接支持。 |
| 节点显示标题、摘要、状态和依赖 | 这些数据应来自 tracker；现有会话列表不足以提供。 |
| 只装一个 extension 就替换成无限画布 | 未找到现成挂载能力；至少需要 Web UI 宿主改动。 |
| 自动察觉任意方式创建的 GitHub / 本地 ticket | 没有统一的 Pi `issue_created` 事件；需要读取 tracker 状态或约定结构化通知。 |

最后一项为从公开事件类型与工具接口得出的集成判断。`tool_result` 表达某个工具的执行结果，不天然证明某个业务 ticket 已创建：同一次 bash 可能完成多次操作，本地文件也可能分几步写完。不要把匹配聊天文本、shell 字符串或模型一句“已创建”当成唯一依据。[工具事件](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#tool-events)

## 建议验证的最小连接方式

下面是基于源码的建议，尚未实施或通过真实使用验收。

```text
Pi 运行 Wayfinder
      │
      └─ 通过原有 skill / tracker 配置维护 ticket
                  │
                  ▼
          Web 读取地图与 ticket → 在画布显示节点
                  │
              点击节点
                  │
       ┌──────────┴──────────┐
   没有关联会话             已有关联会话
   新建并发送启动内容       打开并继续
       └──────────┬──────────┘
                  │
          对话改变 tracker，画布刷新
```

**先生成节点，首次进入时再创建真正会话。** 对用户仍然是“每张票都有自己的对话入口”，同时顺应 Pi 的持久化与运行时生命周期。Web 只需补充 ticket 与会话的关联、画布位置及首次启动状态；ticket 正文、状态、结论继续归原 tracker。绑定时同时包含 tracker/地图范围，不能仅以 `#3` 这类局部编号为全局标识。

**首次消息使用正确的 Pi skill 命令，并给足定位信息。** 例如：

```text
/skill:wayfinder 继续地图：.scratch/某次探索/map.md
处理其中的「这个问题的标题」：.scratch/某次探索/issues/03-某个问题.md
```

GitHub 配置则传地图和目标 ticket 的完整链接。命令名后先接一个普通空格，再写参数：该版本源码用第一个空格分开 skill 名与参数，不能把命令后直接换行当成等价写法。它是启动内容示例，不是另写一套 Wayfinder 决策流程。[Pi skill 参数语义](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md#L74-L83)、[实际解析](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L1353-L1360)

**刷新以 tracker 实际状态为依据，事件仅用来提醒重新读取。** 本地版可以从现有 `.scratch/<effort>/map.md` 和 `issues/` 入手；约定已有 `Type:`、`Status:`、`Blocked by:` 和 `## Answer`。其中没有 Pi session 绑定字段，故关联数据需要补充，但不必改变用户现有 skill。GitHub 的读取成本、依赖查询和更新时机另需验证。两者都不能仅靠监听当前会话的 `write` 工具覆盖全部外部变化。[本地约定](/Users/neuron/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md:21)

**优先试用已有的自定义条目事件通路。** 发布版 Pi 的 `pi.appendEntry` 发出 `entry_appended`；pi-web 的 wrapper 订阅 SDK 事件后原样发出，其 SSE 转换对该类型保留。事件能到浏览器 hook，但当前 hook 尚无消费它的分支。候选方式是 extension 在确认 tracker 已变化后附加一个小型通知，UI 收到后重新读地图。这里已追通源码，尚未做实际 extension 到浏览器的实验；离线、换会话或断流后仍要重新读 tracker。[Pi 发出事件](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L2593-L2598)、[宿主订阅](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/rpc-manager.ts#L296-L305)、[SSE 保留事件](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/lib/agent-event-wire.ts#L96-L97)、[当前 hook](https://github.com/agegr/pi-web/blob/a26cc68df9227cb74253bddd7c59624aa475e61f/hooks/useAgentSession.ts#L1054-L1284)

SDK 另支持注入宿主共享的 event bus；该总线本身不跨浏览器，若选择它，仍需宿主转发。已有 SSE 能否满足需求应先验证，不必提前增加一套通信服务。[SDK event bus](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md#extensions)

## 选型建议与待验证项

建议优先在 pi-web 的现有聊天与会话能力上做一条窄的集成实验。仅做 extension 无法满足画布；从零写 SDK Web UI 则需重新承担已有聊天、模型配置、文件预览和会话恢复工作。是否长期维护 pi-web 分支，待最小实验和 UI 耦合程度验证后再决定。

最小实验只需一张 Map、几张有依赖的 ticket，包含一次 HITL 对话和一次 research：

1. ticket 出现后，未启动会话的节点也能在刷新后保留。
2. 点击指定节点，正确加载对应地图和 ticket，不重复发送启动消息。
3. 关闭票与新票出现后，标题、结论、依赖更新；用户能继续原会话。
4. 重启后仍能找到对应 ticket 和会话；首次响应前失败不会造成永久错误绑定。
5. research 使用实际可用的子 Agent 能力；skill 被加载不等于其所有依赖都已兼容宿主。

## 本次验证范围

- 阅读固定版本官方文档、源码、已有测试；核对 npm 发布 `gitHead`。
- 使用 Node 24 在临时目录运行 pi-web 原版 `listSessionFamilies` 和辅助 `buildSessionTree`，输入普通会话、fork 和 subagent 的最小 fixture。断言通过：fork 保持独立，subagent 归入父会话。前者才是当前侧栏实际使用的分组函数。
- 没有调用付费模型，没有启动用户的真实 Pi 会话，没有运行浏览器完整流程。空会话持久化、extension actions 和工具事件范围属于源码确认，不能当成 Beacon 端到端运行成功。
- 本次只新增研究 Markdown。没有安装或修改 Wayfinder/extension，没有创建业务 tickets，也没有做产品实现。
