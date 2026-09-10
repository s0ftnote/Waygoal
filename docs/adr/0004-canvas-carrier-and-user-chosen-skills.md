---
status: accepted
---

# 画布承载用户选择的方法，不主动路由

Waygoal 的基础能力是呈现 Pi 会话与真实分叉；不使用 Matt skills 或 tracker 也能使用。用户主动调用 skill，迷茫时可调用 `ask-matt` 获取路线建议。产品不根据聊天内容、节点数量或画布大小自动选 skill、切换流程或发送命令。已调用 skill 内部如何开展工作仍遵循其方法，产品不额外叠加路由器。

总画布是讨论与工作记录的载体，Wayfinder 地图是其中一种围绕目的地组织票据的工作记录。有工作目录时，Matt 的常规澄清入口是 `grill-with-docs`，内部运行 grilling 与 domain-modeling；目标需要跨会话探索时，用户可以选择创建 Wayfinder 地图，保留来源讨论与已有结论。普通对话分叉不会因此自动变成票据，也不会按图的大小强制升级流程。

这修正了此前“产品让 Agent 按情境选择 skill”的方向。代价是方法选择需要用户发起；保留 `ask-matt`、明确的技能入口和可关闭的说明，帮助用户作出选择。根入口是否预选澄清 skill、调用按钮如何操作，以及 Wayfinder 创建后如何在总画布中展开，仍待确认；此决定不规定这些交互细节。

接入形式采用 Pi extension，画布作为本地 Web 展示与交互界面。保留 Matt skills 的原始流程、核心理念和票据格式；extension 负责连接已有会话、工作记录与画布，不重新规定提问、选票、汇总或执行顺序。票据读取与通知遵循 [ADR 0001](0001-tracker-authority-and-local-canvas-records.md)，必要的数据连接不等于另加工作流规则。具体 Web 宿主与通信实现仍需验证，本决定不声称一个 extension 文件已经包含全部 UI 能力。

产品投入重点是交互、视觉与动画，以及可关闭的少量方法提示。返回、展开节点或状态刷新不主动总结或改动上下文；真实的继续、分叉及已选择方法的工作仍正常执行。既有原型中固定启动 Wayfinder、额外规定每节点工作方式的提示属于待调整的实验行为。

入口依据：`ask-matt` 区分有工作目录的 `grill-with-docs` 与无工作目录的 `grill-me`；`grilling` 是共同的提问方法，不必作为根节点的固定名称。用户主动调用 `ask-matt` 后获得建议，再选择执行；它不属于每次开始前的必经步骤。见 [Ask Matt](https://www.aihero.dev/skills-ask-matt) 和[研究报告](../research/matt-workflow-guidance.md)。
