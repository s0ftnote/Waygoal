---
status: accepted
---

# 沿用 pi-web 的会话运行方式，技术栈为 TypeScript

Waygoal 的宿主基于 pi-web，pi-web 在宿主进程内直接创建 Pi SDK 的 AgentSession 来运行会话。曾考虑改为每段会话启动一个 `pi --mode rpc` 子进程，以保证同一会话文件只有一个写者（Pi 会话文件只追加、不加锁；终端 `pi` 与宿主同时写同一文件会损坏历史，见[交付形态研究](../research/pi-extension-delivery-shape.md)）。实测 `pi --mode rpc` 事件与 pi-web 前端消费的事件一致，方案可行，但每段活跃会话约 190 MB 内存，且需要宿主管理子进程生命周期。

决定：不改。宿主沿用 pi-web 进程内运行会话的方式，pi-web 整体保留（会话呈现、侧栏、文件浏览、模型与 skills 配置以后都会用到）。终端 `pi` 与画布同时写同一段会话的情况记为已知限制，暂不加锁、不起子进程、不做所有者登记；单人本地使用下这种情况少见，出现问题时再按实际需要处理。

技术栈：产品代码用 TypeScript，与 Pi、pi-web 一致；测试暂沿用上游的 `.mjs` 形式。交付形式仍是 [ADR 0004](0004-canvas-carrier-and-user-chosen-skills.md) 所定的 Pi extension，本地 Web 宿主是它拉起或连接的界面；接入扩展的打包与安装方式由后续票据确定。
