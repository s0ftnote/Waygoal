# Waygoal

## 产品方向

Waygoal 以 Pi extension 接入，提供本地无限画布 Web 界面。核心体验是非线性聊天：用户可以从一段讨论分出去探索，看见来源与当前路径，再回看或继续原来的思路。画布承载会话及可选的票据，产品重心是交互、视觉设计与动效。

**第一性目标：帮助用户把模糊想法逐步变成自己认可的实际结果，并在思考、行动和调整中始终知道方向。**

- **理清想法**：帮助用户明确需求、约束和动机，保留讨论及其依据。
- **保持方向**：分叉和返回后仍能理解当前位置、已有共识及变化的影响。
- **推进与验证**：让方案、行动和实际结果保持联系，支持继续、调整或停止。

面向工程、创意、内容和活动等工作。用户从普通工作目录开始，无需 Git 仓库、仓库导入或 GitHub 账号；不用 Matt skills 或 tracker 也能使用基础画布。

## 工作边界

- 复用 Pi 的会话、模型、工具与运行能力。Matt skills 保留原有流程和核心理念，产品提供载体与少量提示，不另加自动路由或流程编排。
- 展示、导航和 tips 不分析或干预聊天上下文。用户明确发起的继续、分叉，以及已调用 skill 的正常工作，与纯查看行为区分。
- 提出改动时，说明它改善哪个第一性目标，并用实际操作验证。优先打磨“分叉 → 深入 → 返回”；原型接入成功、动画能播放，不等于体验已成立。

## 按任务读取

- **目录职责、开发命令、测试与证据输出**：读[开发指南](docs/development.md)。Waygoal 界面和数据模块分别位于 `apps/web/components/waygoal` 与 `apps/web/lib/waygoal`，宿主能力继续复用 pi-web。
- **术语、对象关系**：读 [CONTEXT.md](CONTEXT.md)。定义只在术语表维护；本文件保留产品方向和工作指引，决定及理由写入 ADR，交互细节和验收写入设计文档。
- **技能入口、extension 职责、流程衔接**：读 [ADR 0004](docs/adr/0004-canvas-carrier-and-user-chosen-skills.md)。
- **建票边界、会话关联、分支交接**：读 [ADR 0003](docs/adr/0003-discussion-and-ticket-map.md)。
- **票据来源、同步、持久化**：读 [ADR 0001](docs/adr/0001-tracker-authority-and-local-canvas-records.md)；设计卡片内容或完整原文展示时，再读 [ADR 0002](docs/adr/0002-faithful-preview-and-full-view.md)。
- **画布交互、动效、提示、状态及体验验收**：读[画布导航与状态](docs/design/canvas-navigation-and-states.md)，区分已确认方向、未决方案和原型现状。
- **主题色、字体、组件视觉与动效参数**：读 [DESIGN.md](DESIGN.md)，复用其中的语义色值；配色预览与起始参数不等于最终交互定稿。
- **核对 Matt 建议出处**：读[工作流研究](docs/research/matt-workflow-guidance.md)；其中历史提案不等于当前决策，实际 skill 行为以其原文为准。
- **复用 Pi tree、fork 或技能加载**：从 [Pi 调研](docs/research/pi-tree-and-waygoal.md)定位源码，再核对当前安装版本；调研快照不代表已完成产品接入。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `s0ftnote/Waygoal`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical Matt Pocock skill labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.
