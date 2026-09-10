# 真实分叉、只读回看与明确继续（票 #3）试跑

日期：2026-09-10。入口：`http://127.0.0.1:30142/beacon`（`npm run dev`）。票据：[#3](https://github.com/s0ftnote/Waygoal/issues/3)，父 Spec [#1](https://github.com/s0ftnote/Waygoal/issues/1)，前置 [#2](https://github.com/s0ftnote/Waygoal/issues/2)。

## 结论

分叉、回看和继续三件事在真实 Pi 数据上分开了：会话内分支读自实际 Pi tree，不伪造会话文件；跨会话 fork 调用 Pi 原生 `fork`，并在分叉发生的当下记下来源会话与来源消息；只读回看走已有的历史读取接口，不调用会切换活动叶子的树导航，也不新增消息；只有明确点「从这里继续」才移动活动路径，下一次发送才进入所选路径。刷新与宿主重启后来源和最近查看位置都还在；记录缺失时明确提示，不按相似标题绑到另一段历史。

## 实现摘要

- 分支投影：[lib/waygoal-branches.ts](../../prototypes/pi-web/lib/waygoal-branches.ts) 是纯函数，把 Pi tree 折算成分叉点与路径选项（每条路径的首个可见条目、最深条目、预览、步数、是否含活动叶子）。遍历一律迭代，线性会话的链长等于条目数，递归会爆栈。位置标识是「会话 + 条目」：Pi 的 fork 会把条目 id 复制进新文件，单独的条目 id 不是全局位置，见 [pi-tree-and-waygoal.md](pi-tree-and-waygoal.md)。展示用的条目和「继续」用的叶子分开：Pi 的 `navigateTree` 对用户消息会把叶子移到它的父条目、把正文放回输入框（这正是「从此处编辑」），所以继续一定用路径的叶子，不能用正在显示的那条。
- 读取适配：[lib/waygoal-tree.ts](../../prototypes/pi-web/lib/waygoal-tree.ts) 优先用进程内活着的 `AgentSession` 的 `SessionManager`（Pi 的活动叶子只在内存里），否则按文件打开并按 `mtime + size` 缓存。读不出来的会话被略过，而不是当成「没有分支」。
- 接口：`GET /api/waygoal/session/[id]?entry=` 返回该会话的分叉点、各路径叶子与活动叶子；带 `entry` 时还回答这个位置在这段会话里是否仍然存在。全程只读，不做 `navigate_tree`。画布快照 `GET /api/waygoal` 增加每个节点的分叉点数量、活动叶子与来源。
- 来源记录：客户端在真实 fork 成功后立刻 `PATCH /api/waygoal { origin }` 写下来源会话与来源条目。记录不完整或自指的来源直接丢弃；没有记录时退回 Pi header 的 `parentSession`，只知道来源会话、不知道来源消息，界面照实说明。
- 界面：面板顶部把「正在查看」和「继续位置」分成两个标记，每条路径有「只看这段」和「从这里继续」两个独立按钮；画布节点上有「分叉自「…」」和「N 处会话内分叉」标记，选中节点下方列出会话内路径，跨会话来源用虚线连到来源节点。运行中沿用 Pi 的限制，分叉与继续按钮置灰，不静默打断任务。
- 只读回看复用 pi-web 已有的 `GET /api/sessions/[id]/context?leafId=`，用 `MessageView` 渲染，不接 ChatWindow 的 `handleLeafChange`（那条路会真的导航）。

## 验证

单元测试：[lib/waygoal-branches.test.mjs](../../prototypes/pi-web/lib/waygoal-branches.test.mjs) 8 项（无分支、单分叉点的叶子与预览、活动叶子落在被折叠的链里、多根分叉点、嵌套分叉点由外到内、活动叶子未知时不标记、两万层线性链不爆栈、祖先路径）；[lib/waygoal-store.test.mjs](../../prototypes/pi-web/lib/waygoal-store.test.mjs) 追加 6 项（记录的来源、Waygoal 之外做的 fork 只给出来源会话、来源不在本工作区时照实说明且不按标题匹配、不完整或自指的来源被拒绝、最近查看位置随会话消失而清除、分叉数与活动叶子来自真实会话树）。

浏览器验证（`npm run test:waygoal-branches`，[e2e/waygoal-branches.mjs](../../prototypes/pi-web/e2e/waygoal-branches.mjs)）：隔离的 `PI_CODING_AGENT_DIR`、可控输出的假模型、独立 Next 宿主。24 项检查全部通过：

- 一段普通会话没有分支；用 Pi 自己的「Edit from here」分出第二个方向后，真实 Pi tree 里是一个分叉点、两条路径，而不是两个会话文件；共享的那条消息就是分叉点。
- 画布把这段会话标为有会话内分叉并列出两条路径，标出当前从哪条继续。
- 点「只看这段」读兄弟路径：假模型没有收到请求，会话文件没有增加条目，活动叶子没有移动，面板同时显示「正在查看」和「继续位置」且指向不同路径。
- 刷新后回到同一个查看位置，仍然没有发送。
- 点「从这里继续」：活动路径移动，仍然没有新增消息；只读回看条上的同一个按钮也要落在这条路径的叶子上，而不是它前面那条消息；随后发送的一条消息在真实 jsonl 里沿 `parentId` 回溯确实落在所选路径上，没有落到另一条；被放弃的那条路径仍然保存；这次请求的上下文里没有兄弟路径的内容。
- 在消息上做真实 fork：新会话是另一个 Pi 会话文件，来源记录同时含来源会话与来源消息，原路径两条分支都没有被改动，画布画出这条来源连线。
- 从 fork 点「回到来源这条消息」只读打开来源，没有发送。
- 停止并重启宿主后来源与查看位置都还在，没有发送、没有新增条目。
- 把最近查看位置改成不存在的条目后刷新，界面明确提示找不到，不绑定到另一段历史。
- 无页面脚本或控制台错误。

证据：[检查记录](prototype-evidence/branches/checks.json)与截图 `prototype-evidence/branches/01–07`。同时通过全项目 TypeScript 检查和改动文件的 ESLint。全量单元测试 955/959 通过，其余 4 个文件（`lib/rpc-manager-*.test.mjs`、`lib/rpc-session-info.test.mjs`）在本次改动前的提交 `f9faba2` 上以同样的 `Cannot find module '@/lib/skill-lock'` 失败，属于上游既有问题。

## 实测发现

- Pi 的活动叶子不会写进会话文件：`SessionManager._buildIndex()` 把 `leafId` 设成文件里的最后一条，`branch(id)` 只改内存。所以「导航但不发送」在宿主重启后会丢；一旦发送，最新条目就在所选路径上，位置自然保住。界面按这个语义呈现，不自己造一份活动叶子。
- Pi 的 fork header 只记 `parentSession`（来源文件），从不记来源消息。要给出「分叉自哪条消息」，必须在分叉发生的当下自己记下来。
- fork 会把条目 id 一起复制进新文件，所以条目 id 不能单独当位置用。
- 自动断言不能代替看截图：三处只有截图才暴露的问题——节点带上来源/分叉标记后卡片变高，画布上的路径小标签会压住卡片（改为用 `ResizeObserver` 量实际高度）；来源连线按中心到中心画，标签落在卡片上（改为把线裁到卡片边框）；两张卡片挨得近时连线标签仍放不下（放不下就不画，卡片上的「分叉自「…」」仍然说明来源）。
- e2e 里逐条消息的操作入口是悬停才出现的，出现时还会改变行的布局；先悬停、等按钮的实际位置、再用真实坐标点击才稳定。

## 真实模型核验（有界）

用本机 Pi 登录在 `npm run dev`（根目录脚本，30142）上跑了一轮，工作目录 `playground/`，模型 `openai-codex/gpt-5.6-luna`，共 4 次真实请求。会话 `01a08ba4-ff40-70a2-8ccc-48f96b9994f0`，分叉出的会话 `01a08baa-ee3b-70a2-8ccc-48fac45026ac`。

- 会话内分支：先发一句、再发一句，然后在第二条自己的消息上用 Pi 的「从此处编辑」，换个方向再发一句。真实 jsonl 里是一个分叉点（`39b04bff`）下的两条用户消息（`d6fef377` 野餐 / `e8dc8570` 桌游），不是两个会话文件；所有 assistant 条目的 `model` 都是 `gpt-5.6-luna`。
- 只读回看：对「野餐」这条点「只看这段」，会话文件仍是 10 行，活动叶子仍是 `54552cfd`（桌游）。面板同时显示「正在查看」与「继续位置」，画布节点标红「正在查看」。
- 明确继续：点「从这里继续」后活动叶子变成 `933280b1`（野餐），会话文件仍是 10 行——没有因为切换路径产生任何消息。
- 下一次发送：再发一句后，新条目 `6a6bfad3 → 32440002` 的 `parentId` 链一路回到 `933280b1 → d6fef377`，落在所选路径上；「桌游」那条路径仍然完整保存。
- 真实分叉：在「那就先说野餐」这条消息上点「从这里分叉」，得到另一个会话文件（6 行，含 Pi 复制的路径），画布记录的来源是 `{sessionId: 01a08ba4…, entryId: d6fef377}`，节点上显示「分叉自「…」」，画布画出连线。Pi 自己的 header 只有 `parentSession`（来源文件路径），没有来源消息——来源消息是 Waygoal 在分叉当下记下的。
- 「回到来源这条消息」只读打开来源会话的那条消息，两个会话文件的行数都没有变。
- 宿主重启：停掉 30142 再起，刷新后来源、最近查看位置（`lastViewedEntry: d6fef377`）和继续位置都还在，两个会话文件行数不变。重启后活动叶子回到文件里的最后一条 `32440002`，正是所选路径的最新条目——这是 Pi 的语义，不是 Waygoal 自己记的。

证据：[snapshot.json](prototype-evidence/branches-real/snapshot.json)、[snapshot-after-restart.json](prototype-evidence/branches-real/snapshot-after-restart.json)、[session-tree.json](prototype-evidence/branches-real/session-tree.json)、[session-entries.json](prototype-evidence/branches-real/session-entries.json)（两个会话的真实条目与 `parentId`）与截图 `prototype-evidence/branches-real/01-restored-after-restart.png`。断言都读会话文件和快照，不用模型回答代替状态。

## 未覆盖与边界

- 分支标题、把分支挂到票据、跨会话的「带结论返回」都还没有接入；一个分叉点下超过两条路径只在单元测试里覆盖，没有做真实多路径的体验走查。
- 只读回看一次读末尾 200 条，更长的历史没有分页。
- 多进程同时写同一 `canvas.json` 仍未处理（同票 #2）。
- 运行中沿用 Pi 的限制（不能 clone/fork），界面只是把按钮置灰并说明原因，没有做排队。
- 草稿语义按操作区分：Pi 自己的「从此处编辑」和 fork 仍由 pi-web 处理，正文照旧回到输入框；Waygoal 新增的「从这里继续」是另一件事，只移动继续位置，不动草稿。
- 分叉与返回的过渡沿用已有的画布平移和面板出现动画（都受 `prefers-reduced-motion` 约束），没有为这一步单做新的过渡；定位主要靠来源连线、节点标记和「正在查看 / 继续位置」两个标签。

## 代码审查后的修正

按 `/code-review` 结果做了六处修正：只读回看条上的「从这里继续」原来把正在显示的条目当成导航目标，Pi 对用户消息会改跳到它的父条目，因此改为记录并使用这条路径的叶子，并补了一项 e2e 检查；来源只知道会话时用空字符串占位（会发出 `leafId=`、也可能导航到空 id），改成显式的 `null` 并隐藏「从这里继续」；`navigate_tree` 返回的 `cancelled` 原来没看，现在明确提示没有切换；画布小标签和面板里的「路径 N」原来一个按全局编号、一个按分叉点内编号，统一成分叉点内编号；只有测试用到的 `branchRef`/`parseBranchRef` 删除，身份约束由 `WaygoalOriginRecord` 的会话+条目字段承担；接口返回体改为共用一个导出类型，`chatSessionId` 的赋值移出渲染体。`prototypes/pi-web/AGENTS.md` 的 fork 文件清单和 `CONTEXT.md` 的术语（路径、继续位置、查看位置）同时补齐。上面那次真实模型核验在这些修正之前跑，涉及的位置在那段会话里两个 id 恰好相同，结论不受影响；两者的区别由新增的那项浏览器检查覆盖。
