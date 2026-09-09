# Waygoal

**From a rough idea to something real.**

Waygoal 是基于 Pi 的本地 Web UI，将 Matt Pocock 的澄清、探索、汇总、拆解、执行与验证工作流融入非线性对话和可视化。帮助用户理清想法、保持方向，并通过行动与反馈逐步形成自己认可的实际结果；面向工程开发，也面向创意、内容和活动。

当前是 Pi × Wayfinder 的接入原型：把本地工作目录中的 Markdown 地图和票据变成可浏览的画布，点击节点开始或继续它自己的 Pi 对话。完整的方案汇总、执行与验证衔接仍待实现和验证。产品目标与设计原则见 [AGENTS.md](AGENTS.md)。

## 启动

```sh
npm --prefix prototypes/pi-web ci --ignore-scripts
npm run dev
```

打开 http://127.0.0.1:30142/beacon 。使用本机已有 Pi 登录与 skills，新节点使用 `openai-codex/gpt-5.6-luna`，不改变 Pi 的全局默认模型。已有的 pi-web 30141 不受影响。

原型的 `/beacon` 路由、界面名称及内部标识暂时保留，文档中的产品名称统一为 Waygoal。

第一次试用默认打开 `playground/`：这是虚构的朋友放映会示例。点击「希望朋友带走什么感受？」继续 Luna 已经提出的问题，研究节点可以直接读结果。其余节点等待前面的答案。

也可以在顶部切换到任意已有工作目录。没有地图时，先写想法并开始澄清目的地；Agent 创建地图后会出现在画布中。无需 Git 仓库或导入流程。

## 本次实现的范围

- 当前读取 `.scratch/<effort>/map.md` 和 `issues/NN-*.md`；GitHub tracker 的画布适配尚未实现。
- 目的地、问题类型、问题/结论摘要、状态、依赖关系以及未知方向可见。
- 拖动画布、缩放、拖动节点；节点位置保存在浏览器中。
- 首次点击节点创建真实 Pi 会话并调用 Wayfinder；后续点击恢复同一会话。依赖未满足的节点可阅读，不创建新会话。
- 票据是状态来源。`.beacon-prototype/sessions.json` 只保存节点与 Pi 会话的关联；Pi 自己保存聊天记录。
- 小型 Pi extension 在实际地图变化时发送事件；浏览器也每 2.5 秒刷新，以接收其他会话或外部编辑。
- 这个实验进程启用 pi-web 的内置研究子代理；没有更改全局子代理设置。

这是验证接入方式的可运行原型。页面重载后需再次点击节点恢复对话；GitHub、票据重命名后的关联迁移、多进程争抢、自动布局优化尚未处理。节点默认布局根据阻塞关系分层，虚线连接没有前置依赖的票据与目的地，实线表示依赖；它不是 Pi 内部聊天分支树。

## 验证

在 `prototypes/pi-web` 中：

```sh
node_modules/.bin/tsc --noEmit
node --test lib/beacon-store.test.mjs lib/startup-preferences.test.mjs lib/subagent-settings.test.mjs
node e2e/beacon.mjs
```

浏览器检查需本机 Google Chrome 和已完成真实模型试跑的默认 playground。它恢复已有会话，不向模型追加消息。

详见 [试跑记录](docs/research/prototype-results.md)。上游是 [agegr/pi-web](https://github.com/agegr/pi-web)，基于提交 `a26cc68df9227cb74253bddd7c59624aa475e61f`，Pi SDK 版本 `0.85.1`。
