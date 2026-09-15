# Chartr 与 ThoughtDAG：设计理念、产品结构与交互语言

研究日期：2026-09-14（America/New_York）。本轮根据用户澄清，从“哪些功能值得借鉴”转向理解两个产品自身的设计逻辑，再讨论对 Waygoal 的启发。

核对版本：Chartr `be8073f6ffe771f034e6a6b4d44400621ba37f5b`；ThoughtDAG `3c57d429f83946498fce06d8e2a579c99f102e1e`。结合 README、设计文档、ADR、关键源码与第一方界面截图；未安装运行两款应用，未做用户体验实验。文中明确区分作者陈述、静态视觉观察和研究者推断。原始设计文档用于理解动机，修订与执行代码用于核对当前行为。

> 本文保留研究过程与当时的设计问题。后续已确认的 Waygoal 交互以 [ADR 0006](../adr/0006-continuous-chat-and-turn-cards.md) 和[画布导航与状态](../design/canvas-navigation-and-states.md)为准。

## 总体判断

两个产品都把原本不容易看见的工作关系放到空间里，但它们组织的对象、进展的定义和交给用户的权力不同：

| 设计维度 | Chartr | ThoughtDAG |
| --- | --- | --- |
| 核心问题 | 多项问题和多次 Agent 会话怎样持续推进 | 曲折的讨论如何被挑选、修正并用于下一次推理 |
| 用户角色 | 掌握全局并选择下一项工作的操作者 | 选择前提、比较尝试、组织成果的思考者 |
| 核心对象 | 问题／工作票据及其结果 | 问答、笔记、材料及其版本 |
| 主要关系 | 哪个前提阻塞哪项工作 | 哪段历史或材料进入后续问题 |
| 进展的表达 | 答案落地，后续工作获得解锁条件 | 分叉、挑选、修正、比较，再提炼成可用表达 |
| 画布职责 | 告诉人现在能做什么、什么正在发生 | 告诉人思考从哪里来、现在依赖什么、可以怎样重组 |
| 视觉重心 | 可推进的节点和会话活动 | 不同阅读距离下的内容、所得与思考结构 |
| 连续性载体 | 地图、票据及前置答案等工作材料 | 带来源与版本的可编辑图，以及原始历史 |

这张表是下文一手资料的综合解释，不是作者提供的竞争产品对比。



## Chartr：让人驾驶一张能够推进的工作地图

### 核心命题与用户角色

官网把工作过程表达成 chart → spawn → resolve：先和 Agent 形成地图，选择没有阻塞的票据启动会话，答案写回文件后让后续票据进入可推进范围。它复用用户已有 CLI Agent 和原生终端界面。[官网](https://chartr.dev/)、[上手流程](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/getting-started.md)

**我的理解：** Chartr 假设困难在于跨会话工作的连续性：人需要知道大局、下一项可做的事，以及给新 Agent 什么前提。用户承担选方向和调度的工作；单次 Agent 会话承担边界明确的一项问题。地图把多次会话组织成可持续推进的工作。

核心关系是：工作目录包含地图，地图包含问题或工作票据，票据通过阻塞关系相连，票据会话从相关材料出发，结果写回票据。它也允许自由会话和普通 shell，因此这套模型描述的是地图工作流，不是所有终端必须经过的门槛。[对象定义](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/CONTEXT.md)、[来源读取与状态推导](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/internal/wayfinder/parse.go)

### Frontier 是整个产品的设计中心

Frontier 是尚未解决、未被领取且所有前提已经解决的票据集合。源码的 Frontier() 据此计算可推进的工作。它让用户扫描的是“现在有什么可以做”，而不只是查看过去聊过什么。[Frontier 实现](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/internal/wayfinder/parse.go#L132-L155)

例如“明确离线需求”得到答案后，“选择数据存储方案”可以开始；新会话收到该问题及其依赖答案。进展以文件中新增的结论和由此改变的依赖状态表达。这是解释其模型的例子，并非本轮实际运行。

### 为什么是星图：空间、注意力与行动组成同一种语言

Chartr 从作者的 wayfinder-maps 复用模型和星图。原始设计记录明确选择 RTS 游戏式的 2.5D 空间：依赖深度影响半径、节点状态影响大小和辉光、选中后打开详情而不离开地图；拒绝真实 3D 的理由是二维依赖图多一个轴会增加遮挡与深度歧义。[继承关系](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/adr/0001-build-fresh-reusing-the-model-layer.md)、[原始星图设计](https://github.com/rengwu/wayfinder-maps/blob/94a3be97d937db06574c15515ad8c0cd23854ffd/docs/starmap-design.md)

这份原始记录解释动机，不能直接当作当前 Chartr 的功能表。例如历史记录的颜色、迷雾和未实现设想需要分开看。当前源码可确认：

- **位置表达依赖结构，状态表达进展。** 状态变化不重排位置；新增节点或依赖边仍会触发结构重排。
- **可推进的节点获得更大的视觉权重。** 当前 frontier 为亮蓝色、较大半径与辉光；已解决、受阻和移出范围各有表达。标签排布也优先照顾当前选择与可行动节点。
- **会话活动独立于票据状态。** 会话用额外的卫星覆盖层表达，避免把 Agent 正在工作与问题已经解决混为一谈。

依据：[布局](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/layout.ts)、[当前状态视觉](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/theme.ts)、[标签与渲染](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/starmap.ts)、[会话覆盖层](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/session.ts)。

**我的理解：** 星图隐喻有效与否，取决于它能否让人从亮度、位置和连线理解行动机会。“探索未知”的情绪来自实际的工作结构；如果仅保留星空和粒子，意义就丢失了。

### 界面组织：操作区安静，信息区有明确重心

本轮实际查看官网展示的产品截图：左边是空间与会话，中间是 Agent 原生终端，右边是星图与票据阅读面板。它让总览、具体工作和工作依据可以同时出现。这是官方展示截图的观察，不是对安装后当前版本的交互实测。[官方展示](https://chartr.dev/)

设计系统进一步规定外围 UI 使用温暖的橄榄灰中性色，字体为 IBM Plex Sans/Mono；彩色主要留给地图状态与错误，控件遵循一致的高度和组件系统。[设计系统](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/design-system.md)

**我的理解：** 这是一种注意力分配：外围控件提供稳定坐标，终端提供工作内容，地图承担状态判断。视觉设计不是给所有东西统一涂上品牌色，而是让不同视觉通道分别负责不同的信息。

### 跨会话连续性放在工作材料中

ADR 0005 选择启动时组装地图、当前票据和前置答案，拒绝另建不断累积 Agent 自述经验的记忆库。同票据的崩溃恢复允许继续原会话；跨票据仍以文件材料重新开始。[上下文决定](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/adr/0005-assembled-context-no-agent-memory.md)

**我的理解：** 交接的单位是有出处的工作结果，人无需反复口头交代所有历史。代价是上游结果写得不好或漏掉重要前提时，下游简报也会继承这个问题；没有隐藏记忆并不自动保证材料正确或完整。

### 从设计演变理解它的克制，以及代价

- **撤掉审批层。** ADR 0004 的修订明确取消 proposed/review/promotion 流程。写下有效 Answer 即视为 resolved，依赖随之解锁；文档明确承认“session said so”不等于人工认可。它选择把判断交回在场的操作者，代价是错误结果可能进入下游。[ADR 0004](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/adr/0004-derived-ticket-state-and-proposed-answer.md)
- **并发从禁止变为告知后选择。** 不引入每票 worktree，默认串行；人可以确认两个会话共享工作目录。理由是软件不知道两项工作是否真的冲突，不应替人一律拒绝。[ADR 0003](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/adr/0003-serialise-per-space-no-worktrees.md)、[当前操作代码](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/DetailPane.svelte#L179-L218)
- **从固定技能走向可替换来源。** 当前 ADR 0018 不内置特权技能，首次启动预注册普通 git 来源；用户可以移除、调整和替换。它甚至修订了“首次完全留空”的严格版本，以减轻上手成本。[ADR 0018](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/docs/adr/0018-skill-mirror-and-no-seed.md)

**综合判断：** Chartr 想降低组织工作与交接的负担，同时把方法选择和有争议的判断留给操作者。它为此放弃了一部分机械保障。其优势依赖可辨认的问题边界与有质量的答案；模糊探索如何转成合适的票据，仍由人与方法共同承担。

资料存在演变差异：旧对象定义仍说 Map 分 planning/implementation，ADR 0015 已撤掉 map-kind 分类；ADR 0005 中关于答案被人工认可的措辞也需结合 ADR 0004 的撤审修订理解。这里优先采用最新明确修订与关键执行代码，而不把某一篇旧文档当成统一现状。


## ThoughtDAG：理念、对象与交互设计

核对版本：`3c57d429f83946498fce06d8e2a579c99f102e1e`。以下区分作者明确陈述、实际截图观察和我们的解释。只读源码与第一方文档；没有运行软件或重新做其基准实验。

### 核心理解

**我的概括：它把对话历史当作可以挑选、剪接、比较和重新组织的推理材料，让用户编辑“下一次回答所依据的内容”。** 画布形状由此有实际后果：选择哪条线，相当于选择下一次思考接受哪些前提。

作者明确提出两条规则：连线决定上下文；人控制图，模型沿被选的上下文回答。Concepts 进一步解释 DAG 为什么有方向、不能有环、能分叉、能合流：分别对应前提流向后续问题、防止自己递归进入自己的历史、保留替代路线、组合已选择的证据。[README 的核心规则与产品定位](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/README.md#L111-L190)、[Concepts](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/concepts/index.md#L3-L37)。

这个设计要解决的用户问题可以表述为：“我的讨论绕了很多路，有些前提已经过时，有些结论值得保留；下一轮应该带上哪一部分？我怎么检查和调整？”其中最重要的一刀是 **画布上保留 ≠ 发给模型**。用户可以留着废案、失败实验、旧假设，必要时重新访问，而不必每次继续都带着它们走。作者还明确承认，它能说明模型收到了什么，不能证明模型内部为什么这样回答。[可见性与解释边界](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/concepts/index.md#L22-L35)。

### 它的核心对象与关系

| 对象 | 作者给出的定义／行为 | 我们对设计意图的解释 |
|---|---|---|
| 问答节点 | 一个问题及多个回答版本 | 保留同一问题的尝试，避免每次重答都让图长出一颗新节点 |
| 笔记 | 用户可编辑文本 | 在与模型讨论之外，留出人自己的整理与表达位置 |
| 材料 | 文件、网页快照、选中文段及来源 | 把阅读和提问直接接起来，证据不必先变成一份无出处的粘贴文本 |
| 结构连线 | 主线及探索分支，带入完整上游 | 明确“这一步接着哪一段讨论来” |
| 引用连线 | 引用某节点问答及上游问题轨迹，不带入全部上游回答 | 允许借用成果，控制因引用而连带进入的历史 |
| 回答版本、stale | 输入变化后保留旧回答并标记过期来源 | 区分“以前在这些前提下生成过”与“现在仍成立” |
| Frame | 有名字的可视区域，组织节点与移动 | 人的整理范围独立于模型上下文关系 |
| 会话镜像 | 外部 Agent 历史的独立可编辑视图，原始日志保持原样 | 保留真实发生过什么，同时允许为下一次使用重新组织 |

来源：[对象与连线](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/interface-overview.md#L43-L88)、[版本与过期](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/versions-replay.md#L3-L26)、[Frame 与画布](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/canvas-projects.md#L63-L75)、[会话镜像](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/session-atlas.md#L3-L31)。

### 设计如何变成实际的工作流

#### 从阅读长出问题，再把分散尝试收回成果

作者展示的阅读流是：选中原文 → 就地提问 → 回答带页码落到图上 → 通过来源标记回到原文。对话流是：从回答选一段 → Explore → 提交分支问题。收束时可以把多个节点合成新结论、将高亮片段织成带引用的文章，或者把连续无分叉的长段提炼成旁边的新副本。原图可保留，提炼节点保留回源入口。[README 阅读与收束叙事](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/README.md#L137-L157)、[分支交互](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/conversations.md#L3-L49)、[合并与提炼](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/organize.md)。

**我们的解释：** 这是一套“展开探索 → 挑选有效部分 → 形成更高一层表达 → 保留回源”的设计。只谈分叉会错过它更重要的另一半：如何让探索变成可以继续使用的材料。

#### 改前提时，像做一次可比较的实验

作者建议在追问前展开将发送的内容，查看材料、引用、会话与 token 估算；改一条线后保持问题与模型相同，再比较新旧回答。上游变化不会悄悄覆盖下游，而是标 stale，由用户决定按依赖顺序 replay。stale 明确表示旧输入，不表示答案已经错误。[上下文控制](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/context-control.md)、[replay](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/versions-replay.md#L7-L26)。

**我们的解释：** 它强调的控制感不止是“我可以编辑”，还包括“我能知道改了什么，以及观察改动后发生了什么”。图、输入预览、答案版本、过期提示形成一套可追溯的交互语言。

### 视觉与界面设计：不是把卡片缩小，而是改变用户读到的信息

作者定义了三个阅读距离：近处是完整卡片，中间是这一步的简短所得，远处是图标骨架。位置和连接保留。远景图标表达洞察、否决、决定、转向、未决；它们来自长回答完成后的自动摘要与分类，短或未分类的讨论为中性圆点。图标不是新节点类型。[语义缩放](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/canvas-projects.md#L14-L18)、[语义图标](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/interface-overview.md#L59-L71)。源码也有对应 work/map/glyph 三档和防边界抖动的阈值，表明这确实参与节点显示。[实现](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/use-map-mode.ts#L4-L39)。

**我的解释：** 三档分别回答“这里说了什么”“这一步得到什么”“整段思考怎样走过来”。这比用缩放级别控制字号更接近真正的信息设计。它把讨论的意义提到远景，同时把检查原文的能力留在近景。

我用 `view_image` 实际检查了仓库所附的未标注中文界面截图；以下是静态视觉观察，不是本轮运行软件的截图：

- [整体画布原图](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/public/screenshots/interface-overview/zh/interface-overview-zh.png)：暖白纸面、大留白，淡紫／黄／蓝／绿的区域框；远景由大图标、方向箭头和少量区域标题承担识别。顶部放项目与全局动作，左侧为材料入口和时间标记，右下角缩略图，底部突出“导出思路地图”和“继续上次思路”。我的判断是，这一屏把图同时视为可观看的成果与可恢复的工作现场；代价是小图标语义需要学习，远景失去原文标题也可能使首次进入的人难以理解具体内容。
- [节点面板原图](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/public/screenshots/interface-overview/zh/node-panel-zh.png)：右侧约占三分之一的浮层展示长回答，问题／回答／附件／高亮／上下文链分层，追问框在底部，上方紧贴“将发送约多少 token、多少消息”。背景图仍在，当前卡片及来源线清楚，其他内容被淡化。我的判断是，画布负责位置与关系，面板负责深读和实际发问；它没有让长文本承担画布的全部信息密度。

作者另外明确：常用操作放卡片或面板，低频动作放右键和 More；不适用的全局操作隐藏。浮层不移动节点。远景里的 Continue last thread 在悬停时先揭示位置，点击才飞回、恢复可读缩放并打开面板。复盘笔记初始不连线，避免“帮我整理”顺便改变下一次输入。[节点信息层级](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/conversations.md#L11-L36)、[继续上次](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/canvas-projects.md#L37-L45)。

### 设计代价与内部张力

这些是我们的分析，不是作者承认了某项缺陷，也没有用户实验来证明影响程度。

1. **控制权增加，也把上下文管理的工作交给了用户。** 用户得理解主线、引用、归档、版本、stale、replay。它用分层面板、原文预览、按状态隐藏动作来控制复杂度，但使用门槛仍是核心代价。
2. **人主导图结构，不等于所有画面语义都由人确认。** 远景“决定／否决／转向”的标记来自模型分类；它让图更可读，也可能将模型对讨论的解释呈现得过于确定。学习它时应一起研究误分类后的纠正与表达强度，而不是只复制漂亮图标。[分类来源](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/interface-overview.md#L59-L71)。
3. **“连线就是模型看到的全部”是简化口号。** 当前文档承认 ambient memory 是独立于图线的背景层；源码在 `buildContext` 之后加入该层，并故意不纳入上游 stale 指纹。因此准确的心智模型应是“线控制图上下文，其他层另行显示与控制”。这是一种理念向完整产品增长时出现的张力，不应把口号当作绝无例外的技术保证。[Memory 说明](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/models-tools.md#L29-L44)、[实际注入](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/streaming.ts#L211-L227)。
4. **剪掉来源，不会自动抹去它对已有回答的影响。** 作者的研究叙事正是：错误可能已经传播到下游，处理来源不足以修复整个讨论；因此还需要查看受影响部分、删掉或重算。这解释了 stale 和 replay 为什么是该理念的后续要求。这里仅转述作者研究动机与自述，不将其有限 benchmark 提升成“产品保证消除幻觉”。[作者研究说明](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/README.md#L215-L225)。
5. **镜像保留了原始历史，也产生两份不同用途的记录。** 源会话继续追加，镜像可以被剪裁；后来将精心挑选的上下文交给另一个 Agent，还要把结果挂回原处。它在探索更自由的跨工具工作，也必须持续让用户分清“真实历史”“现在整理出的图”“下一轮真正发送的内容”。[Atlas 模型](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/session-atlas.md#L3-L31)。

### 给主研究的结论

不宜再把 ThoughtDAG 概括成“值得参考的几项画布功能”。更有价值的是这套连贯设计：**把历史外化成可编辑材料 → 把保留与使用分开 → 让用户在局部尝试与全局结构之间切换 → 对变更留下版本与来源 → 把探索重新组织成可用成果。** 这些理念可以先理解完整，再讨论哪些适合 Waygoal、哪些需要不同语义承接。

## 对 Waygoal 的启发：先反思设计模型，再选功能

### 1. 画布需要有一个用户能理解的用途

Chartr 让用户找到可推进的工作，ThoughtDAG 让用户组织下一轮推理的依据。对 Waygoal，需要进一步检验“保持方向”能否在日常使用中被具体感知：用户能说出现在讨论什么、为什么走到这里、哪些变化影响原来的方案，以及下一步如何继续。

这会影响默认显示什么、哪些关系最突出、何时展开详情、何时收束。仅把所有会话摆上画布，还没有回答这个设计问题。

### 2. 探索和收束应当有同等清楚的设计

ThoughtDAG 展示了完整循环：材料产生问题，问题分出尝试，尝试被选择和提炼成新材料，同时保留回源。Chartr 展示另一种收束：讨论留下可供后续工作使用的答案。

对 Waygoal，“分叉 → 深入 → 返回”中的返回，既有导航含义，也可能包含工作上的变化：带回什么发现、原来的判断是否改变、下一步是否因此不同。现有纯查看不改变上下文的规则仍然适用；同时，用户主动要求交接时，需要足够清楚的承载方式。这个问题值得完整研究，而不应被简化为“加一个返回按钮”。

### 3. 保留历史、表达当前判断、发给模型，是三种不同的需要

从两个项目可以看到：真实发生过的讨论值得保留；用户当前认可或正在使用的内容可能只是其中一部分；某次模型调用的输入又可能更小。它们需要可追溯联系，但不必使用完全相同的结构。

这是对 Waygoal 当前以会话及来源关系为中心的设计提出的问题：怎样在不改写历史、不暗中推断共识的前提下，让人看见自己现在采纳的结果？本轮提出问题，不自动采用 ThoughtDAG 的图上下文机制，也不把当前 Waygoal 对象定义当成不可重新讨论的答案。

### 4. 视觉语言应当承载可以解释的信息

Chartr 把显著颜色、辉光与位置用于行动状态和依赖；ThoughtDAG 按阅读距离切换到内容、所得、思考动作。前者有游戏式的探索感，后者有工作纸面与编辑台的感觉，但两者都试图让视觉变化对应用户要理解的事情。

对 Waygoal，设计讨论应落实到：远处最值得保留的是问题、分组、路径还是当前判断；近处如何读长文；当前路径与正在查看如何区分；一次动画结束后用户是否更知道自己在哪。颜色和动效参数应服从这些选择。

### 5. 把它们的代价也一起学会

Chartr 的简洁有前提：工作已经能被组织成边界明确的问题，输出材料足够可信，操作者愿意承担一些判断。ThoughtDAG 的自由也有前提：用户愿意管理上下文关系、版本与变化影响，并理解图的表达可能包含模型生成的解释。

Waygoal 面向更广泛的模糊想法，不能只挑两边令人兴奋的能力相加。需要决定哪些复杂度值得让用户掌握，哪些应由宿主承担，哪些仅在用户需要时出现。学习的成果应是一套更连贯的产品判断，而不是更长的功能列表。

### 后续设计研究应怎样验证

用同一个真实案例观察完整过程：从模糊想法开始，形成两个方向，在支线发现原先前提有误，回到主线调整，并形成可以使用的结果。

记录的重点是：用户何时迷路、何时知道已有判断发生变化、返回时能否说清带回什么、形成结果后能否回到依据，以及为完成这些动作需要学习多少概念。功能可用、图能画出来和动画流畅，分别只是这套体验成立的部分证据。

Waygoal 当前方向与词汇依据：[AGENTS](../../AGENTS.md)、[CONTEXT](../../CONTEXT.md)、[画布导航与状态](../design/canvas-navigation-and-states.md)、[ADR 0004](../adr/0004-canvas-carrier-and-user-chosen-skills.md)。以上是设计研究的解释与待验证问题，未修改已确认决定。



## 附录：首轮实现观察

以下保留最初的源码观察，作为设计分析的补充，不再作为研究的主要结论。

### Chartr 与 ThoughtDAG 对 Waygoal 的参考价值

研究日期：2026-09-14（America/New_York）。以下是源码阅读所得的设计参考，不代表已运行外部项目或验证其完整体验，也不构成 Waygoal 的新决策。

#### ThoughtDAG

核对版本：[3c57d429f83946498fce06d8e2a579c99f102e1e](https://github.com/chenxiachan/thoughtdag/commit/3c57d429f83946498fce06d8e2a579c99f102e1e)。该提交记录日期为 2026-09-15，与本地研究日期存在时区差异。只读浅克隆；未安装依赖、运行脚本、测试或桌面应用。

**判断：值得参考，最直接的价值是大画布的信息层级、找回具体内容以及精确的分叉来源；它的“连线决定模型上下文”属于另一种产品语义，不能直接移植。** Waygoal 已有来源返回、只读查看与继续分离、视野恢复和标题搜索；这里主要提出进一步打磨的参照。

##### 1. 远看结构、近看内容，避免缩放边界闪动

源码的 `useZoomTier` 将展示分为 work、map、glyph 三档，并使用不同的进入／退出阈值，例如 map → glyph 为 0.32，glyph → map 为 0.4，避免在边界来回切换。`ThoughtNode` 实际消费这三个档位，输入中的节点还可保留工作形态。见 [缩放分档](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/use-map-mode.ts#L4-L39)、[节点使用](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/ThoughtNode.tsx#L69-L105)。

**Waygoal 借鉴：** 服务“保持方向”。远景保留会话标题、真实来源、当前路径和分组，近景展示已有内容。先用原文片段或用户标题，不为缩放自动分析聊天、生成结论。验证 30–50 个节点时连续缩放，当前节点与来源关系仍能识别，临界缩放不闪动。

##### 2. 点选后突出相关路径，保留整体位置

`App.tsx` 的 `focusSets` 根据选中节点计算上游、引用与直接下游，并在展示副本添加 target／ctx／down／dim 样式；多选时取消这种聚焦。它还根据侧面板宽度修正居中位置，避免目标落到面板下面。这是实际渲染逻辑，不仅是 README 宣称。见 [关系聚焦](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/App.tsx#L875-L945)、[面板偏移](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/App.tsx#L253-L266)。

**Waygoal 借鉴：** 在已有来源返回与视野恢复之上，比较“只强调真实来源路径、其余稍淡”的效果。必须区分分叉、手动关联和 tracker 依赖；不能将全部连线统一显示为模型读过的上下文。验证“在 A 深入 → 查看 B → 回到 A”，来源和正在继续的位置始终可辨，纯查看不更改活动路径。

##### 3. 搜索最终要找到原句，而不只找到卡片

画布搜索是本地、大小写不敏感的精确子串匹配，覆盖问题、当前回答、高亮、链接标题、附件名和已有摘要；返回命中片段。选择结果会调用节点定位，再尝试滚到面板中的首个匹配文本并短暂高亮。`setTimeout` 加 DOM 文本遍历也说明这只是现有实现，不能由源码断言所有虚拟化或长文本场景都可靠。见 [匹配函数](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/canvas-search.ts#L51-L91)、[原句定位](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/SearchBar.tsx#L55-L90)。此外，CLI 暴露 `why_check`、`why_file`、`find`、`recall_turn`，将历史检索结果关联到具体会话轮次；其查询入口不写画布或会话，但会刷新本地索引，不能把“只读历史”理解成完全不写磁盘。见 [CLI 查询入口](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/cli/src/lib.ts#L890-L923)。

**Waygoal 借鉴：** 服务“理清想法、回看依据”。当前标题搜索可以进一步研究“记得一句话 → 命中会话与消息 → 只读打开原句”。先限定当前工作区并复用 Pi 的真实历史；跨多个 Agent 的索引不是首轮必要条件。以很久以前的具体一句话为样例验收，不能只停在打开会话首屏。

##### 4. 从宿主的精确位置分叉，避免带入后续讨论

README 宣称 DeepSeek Harness 负责执行，画布可以继续宿主会话。源码进一步落实了区别：单一来源是已镜像会话尾部时继续该会话；来源是历史轮次时携带该轮用户消息 ID 分叉；复杂连线则创建新会话并编译画布上下文。宿主实现将消息 ID 解析成该轮的结束序号，再调用自己的 `sessionController.fork`，拒绝尚未结束的轮次。见 [画布出站选择](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/atlas/dsh-bridge.ts#L317-L380)、[宿主真实分叉](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/dsh/lib/index.js#L667-L698)。

**Waygoal 借鉴：** 为已经接入的 Pi 分叉补充有针对性的验收：从历史消息分叉时，后面的消息和兄弟分支不能进入；来源消息缺失时准确显示已知范围；发送与查看严格区分。复用宿主的历史和运行能力与 Waygoal 方向一致，但这里核对的是 DSH 接入，不能据此宣称它的所有 Pi 接入细节已验证。

##### 5. 学习语义一致性，保留两种产品的边界

README 的核心宣称是连线决定模型看见什么。源码确实把材料、虚线引用、结构主线和选中文段编译成 messages，并给各项保留来源；引用可以带入单节点或整条上游。当前实现明确让折叠只影响显示，主线上下文仍取全文，归档和高亮过滤才会改变内容。文件顶部旧注释提到 collapse+summary 控制内容，不能以该注释覆盖下面的实际逻辑。见 [上下文编译](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/context-builder.ts#L290-L349)、[引用深度](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/context-builder.ts#L78-L94)。

**Waygoal 借鉴：** 视觉状态不能暗中改变会话；界面上的来源必须有真实记录支撑。Waygoal 的手动关联只是整理关系，拖线不能合并或重新编译 Pi 上下文；分支结论返回也应由用户或已调用的方法明确发起。ThoughtDAG 的上下文编辑器、自动摘要和执行范式不是本次建议引入的范围。

##### 许可证

核对提交中的 [LICENSE](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/LICENSE) 为 MIT，版权标注为 2026 Xia Chen；其许可要求复制软件或实质部分时保留版权及许可声明。这次仅记录设计与代码参考，没有复制外部实现进产品。

#### Chartr：学习地图的方向感与操作可见性

核对源码提交：[`be8073f6ffe771f034e6a6b4d44400621ba37f5b`](https://github.com/rengwu/chartr/tree/be8073f6ffe771f034e6a6b4d44400621ba37f5b)。以下是源码与仓库说明层面的结论，本轮未运行 Chartr。

##### 1. 状态变化不移动节点，但不要照搬结构变化时的全图重排

布局只接收票号与依赖边，结构签名不包含状态；渲染器收到仅状态变化的模型时更新外观，不重新计算坐标。仓库测试也明确覆盖状态生命周期内坐标不变。它仍会在票号或依赖结构变化时重新计算全图，因此不能概括成“任何更新都稳定”。

Waygoal 改善目标：**保持方向**。学习“状态只更新状态”的约束与验证方式；沿用 Waygoal 已有的新节点就近放置、旧坐标不动策略。星图的径向力导向布局适合票据依赖，不宜替代我们的真实分叉布局。

来源：[layout.ts](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/layout.ts)、[starmap.ts](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/starmap.ts)、[对应测试](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/starmap.test.ts)。

##### 2. 镜头围绕可见区域和用户的阅读位置工作

详情面板的尺寸作为 insets 传入镜头，选中节点被放进剩余可见区域。重复的相同测量不会再次挪镜头；无选中节点时，关闭面板不强制全图 fit。缩放动画在世界焦点和每像素世界单位之间插值，以保持缩放锚点。相机保存目标位置，避免保存动画中途的偶然位置。

Waygoal 改善目标：**保持方向**。当前 Canvas 已有面板打开后的节点 reveal 和视野保存，应对照验证连续缩放、面板尺寸变化、动画中切换画布，而不是再造同名能力。Chartr 切空间时在内存保留镜头，刷新只保留地图选择；我们现有的跨刷新视野恢复应继续保留。

来源：[镜头实现](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/starmap.ts#L396-L469)、[缩放插值](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/starmap.ts#L618-L650)、[mapstate.ts](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/mapstate.ts)。

##### 3. 发送前看得见准备交给 Agent 的内容

PayloadPreview 按块显示启动输入、来源与完整组合文本，也显示粗略 token 估算。值得学的是让用户在启动前核对材料，而不是它自身按票据类型绑定角色的策略。

Waygoal 改善目标：**理清想法、推进与验证**。可用于已有“票据开始讨论”的输入准备，也可作为未来“带结论返回”的设计参考：明确来源消息、选中的原文和目的会话，由用户发送。不要声称这个预览能揭示宿主内部所有系统提示和隐藏上下文。

Chartr 自带票据会话规则，包括 claim/audit 和成果记录要求；这些是它的工作流，不能一并叠加到 Pi 与用户选择的 Matt skills 上。

来源：[PayloadPreview.svelte](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/PayloadPreview.svelte)、[core-ticket.md](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/internal/prompt/assets/core-ticket.md)。

##### 4. 票据状态与 Agent 活动分开表达

星图把票据状态作为底层显示，会话活动作为额外的卫星覆盖层，使用形状及运动通道辅助颜色。Pi transcript adapter 区分 toolUse、正常结束、中止与失败；这是读取运行证据的参考，不证明其所有 Agent 状态都准确。

Waygoal 改善目标：**推进与验证**。会话在生成、需要输入或已经结束，都不等于票据已完成。可学习展示分层；运行事实仍优先复用 Pi 宿主直接提供的事件，无需复制多 CLI 的进程探测与日志适配系统。

来源：[session.ts](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/web/src/lib/starmap/session.ts)、[Pi adapter](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/internal/transcript/pi.go)。

Chartr 仓库声明 MIT：[LICENSE](https://github.com/rengwu/chartr/blob/be8073f6ffe771f034e6a6b4d44400621ba37f5b/LICENSE)。本轮未复制代码。

#### 对 Waygoal 的采用顺序

以下是候选实验，尚未成为产品决定或已验证实现。

| 顺序 | 借鉴内容 | 解决的问题 | 实际验收动作 |
| --- | --- | --- | --- |
| 1 | Chartr 镜头细节 + ThoughtDAG 聚焦/缩放层级 | 分叉深入后仍知道所在位置 | 从同一消息分出 A、B；深入 A；查看 B；回到来源；连续缩放、开关面板、切换画布后检查焦点与位置；查看不发送、不改变活动路径 |
| 2 | ThoughtDAG 搜索命中定位 | 记得一句话却记不得会话标题 | 作为独立候选设计，由用户输入原话查找并跳转原消息；保留来源与只读行为；不能把当前标题搜索说成已支持正文检索 |
| 3 | Chartr 输入预览 + ThoughtDAG 显式材料选择 | 支线研究结束后知道带什么回主线 | 用户主动选一段原文，预览来源与目标，发送后继续原讨论；仅返回、拖线和整理都不交接上下文 |

当前实现对照：[Paths.tsx](../../apps/web/components/waygoal/Paths.tsx) 已区分正在看与在聊的路径并提供来源返回；[Find.tsx](../../apps/web/components/waygoal/Find.tsx) 仅按标题查找；[Canvas.tsx](../../apps/web/components/waygoal/Canvas.tsx) 已恢复视野及消息位置，并在面板打开时让节点可见；[layout.ts](../../apps/web/lib/waygoal/layout.ts) 已支持新分叉靠近来源、旧节点不动和显式整理。

产品边界依据：[CONTEXT](../../CONTEXT.md)、[画布导航与状态](../design/canvas-navigation-and-states.md)、[ADR 0004](../adr/0004-canvas-carrier-and-user-chosen-skills.md)。现有能力的体验质量尚需上述实际操作检验，本次仅做一手资料与源码比较，未安装或运行两项目，未改动产品代码。
