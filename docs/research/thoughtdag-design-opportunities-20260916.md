# ThoughtDAG 可借鉴设计：上下文、汇合与来路

研究日期：2026-09-16。源码快照：`chenxiachan/thoughtdag@3c57d429f83946498fce06d8e2a579c99f102e1e`。本笔记核对文档与实现，未运行其应用；“已实现”仅指当前源码存在对应逻辑，不代表体验验收。Waygoal 对照当前工作区 `TurnCanvas.tsx`、`materials.ts`。本文是研究建议，不是实施决定。此前 `chartr-and-thoughtdag-reference.md` 已研究同一上游快照；这次重点是对照目前已落地的 Waygoal 做差距分析，不表示 ThoughtDAG 最近新增了这些能力。

## 1. 让“这次带入什么”在发送前看得见

**实现证据。** ThoughtDAG 的输入框上方有可展开的发送预览，显示消息数量、估算 token、材料/引用/会话的组成，并在背景材料显著超过对话时提示。预览直接复用 `buildContext`，减少显示内容与请求构造各写一套造成的偏差。[预览计算](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/focus-panel/FollowUpInput.tsx#L64-L85)、[预览入口](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/focus-panel/FollowUpInput.tsx#L120-L154)。

**值得借鉴的理念。** 用户操作的是一次明确的上下文组合，连线的后果应在发送前可检查；无需理解整个图算法。

**Waygoal 适配。** 已有 `WaygoalMaterialTray` 展示下一轮材料原文、来源 ID 和时间，底层已有精确发送快照。因此优先改进现有托盘：显示可读会话名与轮次、引用范围、预计新增文字量，点击定位来源。Pi 本身管理的历史压缩、系统提示、工具与运行时消息没有完整证据前，不承诺“完整实际请求预览”或精确 token。文案用“本次额外带入”更诚实。

## 2. 让连线有明确作用，而且折叠只影响看法

**实现证据。** 当前图分区将材料、显式引用、结构会话路径分开。引用默认带所选节点问答及上游问题线索，完整模式才带上游问答。[分区规则](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/graph.ts#L48-L89)、[引用内容](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/context-builder.ts#L66-L92)。当前真正构造请求的代码明确让折叠保持纯视觉，不截断结构路径。[构造逻辑](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/context-builder.ts#L313-L330)。文件开头关于 collapse+summary 控制数量的旧注释与后面的实现存在出入，不能照抄该注释。

**值得借鉴的理念。** 用户要能知道“我只是整理画面”与“我在改变下次讨论的材料”分别发生了什么。所谓 summary reference 也并非模型新写的一份摘要，而是所选问答加问题来路。

**Waygoal 适配。** 保留现有历史/分叉、引用材料、普通关联三种语义。拖线完成后，当场明确“仅关联”或“加入下一轮材料”；材料操作更新托盘，普通关联不改 Pi context。展开/收起任何会话都不改变当前 Pi 路径或草稿。不要把任意连线改造成 Pi 的多父消息树。

## 3. “汇合”要生成有用途的新成果，并保留原分支

**实现证据。** 多选汇总创建新节点，将用户输入的综合目的作为可见问题；从所选节点的末端引入真实边，调用上下文构造器生成综合。提示要求结论、依据、分歧与未决，而非仅流水压缩。[新节点与来源边](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/slices/llm.ts#L458-L525)、[综合提示](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/slices/llm.ts#L526-L550)。文档另有保留原路径的 Condense 副本；本轮未追查其执行链，不将其当作已验证功能。[Condense 文档](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/docs/guides/organize.md#L15-L25)。

**值得借鉴的理念。** 分叉的价值需要一个明确的“带回结果”动作：现在认可什么、依据是什么、仍有何分歧，以及接下来可以做什么。

**Waygoal 适配。** 多选若干轮次 → 加入材料托盘 → 输入“综合成需求结论/比较两条路线”等目的 → 用户正常发送至当前或新 Pi 会话。结果仍是真实 Pi 回答卡片，连回已送出的材料快照；原讨论保留。第一版不做自动生成、不加新摘要运行器，不采用 Merge & Delete 删除原讨论的行为。可把“汇合讨论”作为现有引用流程的批量入口，而非新一套会话系统。

## 4. 结果保留来路，也让用户知道来路已变化

**实现证据。** 生成时相关逻辑记录上下文 fingerprint；重新计算时只给具有历史 fingerprint 且答案存在的节点判定 stale，缺少来源记录不被伪装成“已过期”。fingerprint 会排除纯视觉折叠和自动摘要，避免移动/折叠制造错误警报。[依赖指纹](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/context-builder.ts#L95-L129)、[失效计算](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/slices/nodes.ts#L244-L261)。卡片也有 stale 提示。[显示代码](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/ThoughtNode.tsx#L540-L546)。

**值得借鉴的理念。** “过去引用过什么”与“当前来源是什么”是两件事；结论可以保留，同时明确它的依据时间点。

**Waygoal 适配。** 我们材料本来就是不可悄悄替换的发送快照。宜显示“引用于某轮，来源此后有更新”，允许并排看快照与当前来源，并由用户决定重新引用或继续验证。不能因为来源更新就把旧回答标成错误，也不能自动重跑整条 Pi 会话。此项优先级低于发送预览与主动汇合：先有可靠来源对照，再做失效提示。

## 建议顺序

1. 语义缩放与可确认的简短所得，让多会话全局可读。
2. 连续聊天中的选文探索，降低普通讨论和 grilling 的分叉成本。
3. 多选轮次后“汇合讨论”，同时改善材料托盘的可读来源与额外输入预览，复用现有 Pi 发送链。
4. 连线动作后的明确语义与范围选择，以及来源版本比较与轻量更新提示。

## 画布与探索交互补充

以下由主研究核对源码与官方静态截图补充，未运行应用。

### 语义缩放：远看方向，中看所得，近看原文

三级缩放有迟滞阈值，避免临界缩放反复切换；中景将提炼所得作为可扫读内容，根节点仍突出发起的问题。这适合 Waygoal 用同一画布呈现多会话，而不是缩小成不可读小字。[缩放状态](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/lib/use-map-mode.ts#L16-L31)、[节点显示](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/ThoughtNode.tsx#L455-L490)。

### 提炼所得可供确认，不能自动成为用户决定

ThoughtDAG 会让模型自动生成 INSIGHT / RULEOUT / DECISION / PIVOT / OPEN 类型及简短所得。[生成实现](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/store/streaming.ts#L26-L47)。Waygoal 可以借用“发现、排除、决定、转向、待解”的表达，但应区分模型提炼与用户已确认，允许用户改写/确认关键所得。不要把模型自动写出的 DECISION 当成用户认可的决定，也不必让每张普通轮次卡都长出五类标签。

### 从一段话探索，减少分叉的操作负担

选中回答片段后，探索动作先把片段放入继续输入框；用户发送时才创建问题，并把片段作为 branchContext。[选文暂存](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/focus-panel/ResponseSection.tsx#L128-L140)、[发送时传入](https://github.com/chenxiachan/thoughtdag/blob/3c57d429f83946498fce06d8e2a579c99f102e1e/src/components/focus-panel/FollowUpInput.tsx#L99-L105)。Waygoal 可在连续聊天中支持“选文 → 暂存探索片段 → 写问题 → 明确分叉发送”，使 grilling 和普通探索同样自然。先检查 Pi fork 与草稿保护的现有流程，避免仅点击选文就切换路径。

Session Atlas 与会话管理保持作为参考：Waygoal 已采用同画布多会话展开/收起，本轮不建议再引入一个必须进入的独立会话浏览层。
