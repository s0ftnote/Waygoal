# Waygoal

## 产品方向

Waygoal 让用户与 Agent 探索并推进一片逐渐清楚的工作空间：跨越多个问题、分支和会话，仍能掌握大局、知道下一步能做什么，并沿用已有背景继续。产品通过 Pi extension 接入，提供本地无限画布 Web 界面，重心是非线性聊天的交互、视觉设计与动效。

右侧保持 pi-web 的连续对话，左侧随讨论生长为可分叉、引用和组合的轮次卡片；需要时可以收起讨论、关联票据，从具体消息回到整体工作。

**第一性目标：帮助用户把模糊想法逐步变成自己认可的实际结果，并在思考、行动和调整中始终知道方向。**

- **理清想法**：帮助用户明确需求、约束和动机，保留讨论及其依据。
- **保持方向**：跨分支和会话仍能理解当前位置、自己认可的判断、变化的影响及下一步。
- **推进与验证**：让方案、行动和实际结果保持联系，支持继续、调整或停止。

面向创意、科研、写作、需求讨论和工程等工作，普通聊天与 grilling 都能自然分叉探索。用户从普通工作目录开始，无需 Git 仓库、仓库导入或 GitHub 账号；基础体验不以进入实现流程、使用 Matt skills 或建立票据为前提。

## 工作边界

- 复用 Pi 的会话、模型、工具与运行能力。Matt skills 保留原有流程和核心理念，产品提供载体与少量提示，不另加自动路由或流程编排。
- 纯查看、导航和 tips 保持只读；卡片与快捷节点双向定位时，右侧历史、当前路径和未发送输入保持连续。用户明确选择路径、分叉或引用材料时，才执行对应操作；发送由用户或已调用 skill 的正常流程发起。
- 提出改动时，说明它改善哪个第一性目标，并用实际操作验证。优先验证连续聊天、双向定位及“分叉 → 深入 → 返回”；原型可操作不代表真实 Pi 接入和体验验收已完成。

## 按任务读取

- **目录职责、开发命令、测试与证据输出**：读[开发指南](docs/development.md)。Waygoal 界面和数据模块分别位于 `apps/web/components/waygoal` 与 `apps/web/lib/waygoal`，宿主能力继续复用 pi-web。
- **术语、对象关系**：读 [CONTEXT.md](CONTEXT.md)。定义只在术语表维护；本文件保留产品方向和工作指引，决定及理由写入 ADR，交互细节和验收写入设计文档。
- **持续聊天、轮次卡片、材料引用、路径切换**：读 [ADR 0006](docs/adr/0006-continuous-chat-and-turn-cards.md)；Pi 与 pi-web 的运行方式见 [ADR 0005](docs/adr/0005-keep-pi-web-session-hosting.md)。
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
