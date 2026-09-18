# ThoughtDAG 对 Waygoal 的交互与功能借鉴

> 后续状态：用户已授权第一轮优化，选文探索、材料托盘升级和多选材料入口已接入。下文保留研究时的判断；当前行为与边界见[设计文档](../design/canvas-navigation-and-states.md#thoughtdag-借鉴落地选文探索与综合材料)，验证范围见[接入记录](exploration-integration-results.md)。

本轮核对 ThoughtDAG `f05fc44` 的文档、源码及官方截图，并对照当前 Waygoal 源码。未运行 ThoughtDAG，不把源码存在或宣传截图视为体验验收。以下为候选建议，不改变既有产品决定，也不代表已授权实施。

## 核心判断

最值得学习的是完整的探索循环：**从具体材料提出问题 → 分叉探索 → 挑选有效结果 → 综合成新成果 → 回到依据**。不要只学习画布外观和更多节点类型。

Waygoal 已有连续聊天、真实分叉、共同画布、材料引用、语义缩放和可确认所得。下一轮更值得投入的是降低这些能力之间的操作成本，尤其“选文探索”和“带成果返回”。

## 建议清单

| 顺序 | 借鉴点 | ThoughtDAG 的做法 | Waygoal 建议与现状 | 改善目标 |
| --- | --- | --- | --- | --- |
| 1 | 选中一句话就能探索 | 回答选文后暂存探索片段，带着片段提出分支问题 | 连续聊天选文 → 显示来源片段 → 输入问题 → 明确分叉并发送。取消不动主线草稿。宿主已有选文回调，Waygoal 尚未接入 | 理清想法、保持方向 |
| 2 | 发送前看清带了什么 | 输入框附近展示材料、引用、会话与估算输入量 | 升级现有材料托盘：可读会话名和轮次、引用范围、原文展开、回源、移除、额外文字量。称“本次额外带入”，不假装能展示 Pi 的完整运行时请求 | 理清想法、推进与验证 |
| 3 | 多选后综合，保留原分支 | 多选建立综合节点，也提供从选区探索 | 多选轮次 → 加入托盘 → 写综合目的 → 在当前或新会话正常发送。结果成为真实回答卡片并保留引用快照。当前可逐条引用，缺批量入口和带成果返回流程 | 推进与验证 |
| 4 | 搜索直达原句 | 搜索问答、便签、高亮与材料，返回片段并定位正文 | 从“找标题”升级为“记得一句话就能找到”。先限当前画布或工作区，显示来源和命中片段；查看其他会话保持当前路径与草稿。宿主已有正文搜索底座 | 保持方向、回看依据 |
| 5 | 选中后看清相关来路 | 强调主线、材料、引用及直接下游，其他节点变淡 | 将真实来源、材料引用和普通关联分别强调；“正在看”与“正在聊”不同。非相关区域只稍淡，不消失、不重排。作为现有定位与连线的体验打磨 | 保持方向 |
| 6 | 缩远看所得，缩近读原文 | 完整卡片、所得门牌、图标骨架三档 | 已有第一步，不重复开发。重点验证 30–50 张轮次的全局可读性，远景保留可辨认的分组、当前路径与已确认所得；不照搬自动决定分类 | 保持方向 |
| 7 | 阅读材料直接长出讨论 | PDF 选文、页码回源、材料节点与就地提问 | 后续先从工作目录 Markdown 和已有关联产物做起：选段讨论并保留路径与位置，再考虑 PDF。避免一开始重建完整阅读器 | 理清想法、回看依据 |
| 8 | 告诉人依据发生了变化 | 上游改变后标记旧输入，可由用户选择重放 | 先做“当时引用快照／当前来源”的比较与重新引用。原结论不自动判错，不自动重跑 Pi；当前所得原文变化提示不等于引用依赖更新系统 | 推进与验证 |

### 可后排的补充

- **继续上次思路**：借鉴远景下可发现的返回入口、悬停提示目标。Waygoal 已有最近讨论与回到当前轮次，宜打磨而非另造一套导航。不要复制 ThoughtDAG 的长镜头动画与定时打开面板；继续保留可打断和草稿连续性。
- **可读导出**：在探索形成阶段结果后，主动导出“所得＋来源”的 Markdown；图片地图是辅助沟通形式，不应替代真实成果。ThoughtDAG 已有 Markdown 与地图图片导出；具体采用仍需确定用户的分享对象与隐私范围。
- **撤销与恢复**：Waygoal 当前整理有单步撤销；可进一步研究展示层分组、关联、布局的撤销。不把展示撤销扩成回滚已经执行的 Agent 工具或外部副作用。

## 最值得先做的一条完整体验

1. 主线讨论“活动怎么安排”，保留一段未发送草稿。
2. 从回答中选中“桌游”一句，明确分叉，连续讨论预算与人数。
3. 返回主线，原草稿仍在；再探索“观影”。
4. 多选两条分支中有价值的轮次，托盘显示清楚的来源与选取范围。
5. 用户输入“比较两种方式，给出适合十个人的方案”，正常发送。
6. 从新方案沿引用回到原文；只读查看不打断右侧聊天。

这个验收同时检验“理清想法、保持方向、推进与验证”。比先增加更多节点类型或一整套跨 Agent 管理更贴近 Waygoal 的方向。

建议开发顺序为 **材料托盘升级＋选文探索 → 多选综合／带成果返回 → 正文搜索与关系聚焦**。语义缩放并行做真实使用验收，不再作为全新能力排第一。

## 不宜直接照搬

1. **所有连线都决定模型上下文**：ThoughtDAG 的核心模型适合其上下文编辑器；Waygoal 还有分叉来源、普通关联与票据依赖。整理关系不能悄悄改 Pi 输入，折叠也不等于删除上下文。
2. **模型自动标“决定／否决／转向”**：可以提炼候选记录，但不能替用户确认。现有所得确认机制应保留。
3. **合并后删除原节点、自动重放下游**：前者损害回看依据；后者在工具型 Agent 中可能再次执行有副作用的动作。优先采用保留来源、用户主动引用和正常发送。
4. **立刻引入完整 Session Atlas、多模型配置与独立运行器**：会扩展项目范围。先复用 Pi 已有会话、模型与工具，解决当前探索循环的缺口。

## 视觉观察

实际查看了官方 `selection-toolbar-zh.png`、`organize-merge-zh.png`、`map-dock-zh.png` 和节点侧栏截图。值得借鉴的是信息轻重与操作时机，而非其紫色主题：

- 多选后才出现综合工具条，不在每张卡片常驻所有按钮。
- 中景弱化问题背景，突出这一步的所得。
- 深读放在侧栏，附件、高亮与上下文按需展开。
- 发送预览紧邻输入，用户能在行动之前检查材料。

Waygoal 已有选中卡片工具条、浮动连续聊天与语义缩放。应在现有纸白、浅青、深蓝系统内打磨，不重新换皮；也不把 ThoughtDAG 的单节点侧栏替换为我们的聊天主界面。

## 依据与实现边界

- ThoughtDAG：[对话探索](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/conversations.md)、[上下文控制](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/context-control.md)、[整理与综合](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/organize.md)、[导航与多选](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/canvas-projects.md)、[阅读材料](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/materials.md)、[版本与重放](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/versions-replay.md)。
- 关系聚焦与远景返回入口：[App.tsx](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L872-L895)、[ThoughtMapPill](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L2026-L2097)。完整外部源码核对见[本轮研究记录](thoughtdag-source-review.md)。
- Waygoal 材料托盘：[MaterialTray.tsx](../../apps/web/components/waygoal/MaterialTray.tsx#L57-L73)、[materials.ts](../../apps/web/lib/waygoal/materials.ts#L24-L46)。目前待发送材料的路径缓存是组件内存 Map，不应描述为跨刷新持久化，见 [Canvas.tsx](../../apps/web/components/waygoal/Canvas.tsx#L172-L175)。
- Waygoal 选文底座：[ChatWindow.tsx](../../apps/web/components/ChatWindow.tsx#L335-L378)；画布聊天接入尚未启用该能力，见 [Canvas.tsx](../../apps/web/components/waygoal/Canvas.tsx#L1316-L1333)。
- Waygoal 查找：[Find.tsx](../../apps/web/components/waygoal/Find.tsx#L13-L29)；宿主已有 [session-search.ts](../../apps/web/lib/session-search.ts)，不应将“画布未接入”写成“整个仓库没有”。
- Waygoal 所得：[TakeawayEditor.tsx](../../apps/web/components/waygoal/TakeawayEditor.tsx)、[takeaways.ts](../../apps/web/lib/waygoal/takeaways.ts)。
- 历史研究：[2026-09-16 借鉴清单](thoughtdag-design-opportunities-20260916.md)。其中语义缩放／所得现已落地第一步，本轮建议按现状调整了优先级。

本轮只增加研究记录，未修改产品代码、创建票据或运行真实 Pi 体验验收。
