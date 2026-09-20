# Waygoal

## 产品方向

Waygoal 让用户与 Agent 探索并推进一片逐渐清楚的工作空间：跨越多个问题、分支和会话，仍能掌握大局、知道下一步能做什么，并沿用已有背景继续。产品通过 Pi SDK 运行会话，提供本地无限画布 Web 界面，重心是非线性聊天的交互、视觉设计与动效。

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

- **目录职责、开发命令、测试与证据输出**：读[开发指南](docs/development.md)。源码按功能放在 `src/features/`，Pi 运行与持久化放在 `src/server/`。聊天、模型、认证、终端和会话生命周期改动另读 [运行能力开发说明](docs/runtime/development-notes.md)。
- **术语、对象关系**：读 [CONTEXT.md](CONTEXT.md)。定义只在术语表维护；本文件保留产品方向和工作指引，决定及理由写入 ADR，交互细节和验收写入设计文档。
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

## 单应用开发

在仓库根目录执行安装、启动和检查命令；`@/` 指向 `src/`。单元测试跟随源码，浏览器检查在 `tests/e2e/`。已有开发服务时，构建和浏览器套件使用独立 checkout，避免争用 `.next`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
