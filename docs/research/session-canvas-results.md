# 从普通工作目录开始的真实会话画布（票 #2）试跑

日期：2026-09-10。入口：`http://127.0.0.1:30142/waygoal`（`npm run dev`）。票据：[#2](https://github.com/s0ftnote/Waygoal/issues/2)，父 Spec [#1](https://github.com/s0ftnote/Waygoal/issues/1)。

## 结论

不需要 Git 仓库、GitHub、Matt skills 或 tracker，一个普通工作目录就能成为画布：已有 Pi 会话按真实身份登记为节点，新开的独立会话通过 pi-web 原有的新建、发送和事件流工作，画布记录保存在 Pi 数据目录并按工作目录隔离，刷新和宿主重启后回到原位置且不自动发消息。改动集中在一个页面、一个 API 路由、一个记录存储和 Pi extension 的一个 `input` 钩子；没有另建启动器或通用插件框架。旧的票据原型移到 `/beacon/tickets`，留到票据讨论接入时替换。

## 实现摘要

- 发现：`GET /api/waygoal?cwd=` 合并磁盘会话（`listAllSessions`）与进程内运行会话，按 `projectIdentityKey` 匹配工作目录，排除子代理会话，同一 ID 只保留一个节点（优先磁盘记录）。标题来源依次为已存会话名称、首条消息、空会话标记。
- 新建与发送：右侧面板直接挂载 pi-web 的 ChatWindow；`onSessionCreated` 后把新会话记为最近查看并强制刷新。运行状态来自 `getRunningRpcSessionIds()`。
- 画布记录：`<agentDir>/waygoal/workspaces/<目录名-身份哈希>/canvas.json`（节点位置、视野、最近查看）。`PATCH /api/waygoal` 只写这三类字段；GET 只在新发现的会话需要位置时写一次；记录损坏时按空记录处理并重写。工作目录来自 `?cwd=`，否则是 `playground/`；切换与记住工作区留给票 #4。
- Skills：extension 在 `input` 事件按 Pi `_expandSkillCommand` 同样的规则解析 `/skill:名称`（不去前导空白），名单由宿主绑定到该会话自己的 `resourceLoader.getSkills()`；缺少时 `ctx.ui.notify(..., "warning")` 并返回 `handled`，消息不会发到模型。已安装 skill 走 Pi 原有展开。
- 可达性与窄屏：节点是按钮，Tab/Enter 打开，方向键微调（Shift 大步）；画布区域获得焦点后方向键平移、`+`/`-` 缩放、`0` 回到全景、Esc 关闭面板；640px 以下面板全屏并提供「← 回到画布」。主题按 `docs/design/waygoal-theme.css`，ChatWindow 的 CSS 变量在 `.waygoal-app` 内重映射。

## 验证

单元测试（`node --test lib/waygoal/store.test.mjs lib/waygoal/tickets.test.mjs`）：工作区身份隔离、目录解析回退、发现去重与子代理排除、标题回退、位置分配与持久化、视野与最近查看的写入和缺失提示、损坏记录容错、extension 对缺失/存在 skill 的处理。

浏览器验证（`npm run test:waygoal`，[e2e/waygoal.mjs](../../apps/web/e2e/waygoal.mjs)）：在临时 `PI_CODING_AGENT_DIR` 中预置两段本工作区会话（一段有 `session_info` 名称，一段只有首条消息）和一段其他目录的会话，写入指向假模型的 `models.json`/`settings.json` 和一个 skill 夹具，再启动独立的 Next 宿主。假模型是最小的 OpenAI 兼容 SSE 服务（[e2e/fake-model.mjs](../../apps/web/e2e/fake-model.mjs)），回复内容可控并记录每次请求。23 项检查全部通过：

- 发现：两个节点、真实标题、其他目录不出现、没有 Wayfinder 入口或流程提示、背景色为已确认主题的 `rgb(246, 250, 246)`；重复读取不产生重复节点。
- 打开已有节点只加载历史，假模型没有收到请求。
- 新开聊天 → 输入 → 点击 Send → 界面显示 `E2E reply: …`，画布多出且只多出一个节点，请求经由 `e2e/e2e-model`。
- `/skill:e2e-missing-skill` 得到「没有找到 skill…这条消息没有发送」提示，请求数不变；`/skill:e2e-skill` 的请求里包含 skill 正文标记。
- 拖动节点、放大后：位置和视野写入本工作区记录，最近查看指向新会话；另一个工作区的记录不受影响；`waygoal/workspaces/` 下每个工作区一个目录。
- 刷新：缩放、节点位置恢复，最近查看的会话面板重新打开；假模型请求数与会话文件中的用户消息数不变。
- 停止并重启宿主后重复上述恢复检查，结果相同。
- 键盘：Esc 关闭面板，聚焦节点后方向键改变持久化位置，Enter 打开面板；无页面脚本或控制台错误。
- 390px 宽：面板全屏并有「← 回到画布」，返回后看到节点。

证据：[检查记录](prototype-evidence/session-canvas/checks.json)与截图 `prototype-evidence/session-canvas/01–08`。同时通过全项目 TypeScript 检查和改动文件的 ESLint。

## 实测发现

- Playwright 1.62 期望的 Chromium 构建本机未安装；脚本在拿不到内置浏览器时改用本机 Google Chrome，不触发下载。
- 新建会话的 jsonl 存放在 `sessions/<编码后的 cwd>/`，与预置夹具的目录不同；验证按 ID 递归查找。
- 新节点默认落在网格第三列，桌面上会被右侧面板挡住；选中节点不在可见区域时画布会平移到它。
- 断言「回复出现」时不能用宽松正则匹配面板容器，否则用户消息和上一条回复拼接会误判；改为等假模型收到请求再匹配精确文本。

## 真实模型核验（有界）

用本机 Pi 登录在 `npm run dev`（30142）上跑了一轮，工作目录 `playground/`，模型为 Pi 默认的 `openai-codex/gpt-5.6-luna`，只发一条消息：

- 发现：`playground/` 下 3 个会话文件，画布 2 个节点；第三个是票据原型试跑留下的研究子代理会话，按规则排除。标题来自已存会话名称。
- 新开聊天并明确发送后，画布出现第三个节点并平移到它，节点显示「正在运行」；会话 `01a08a83-c741-7463-a39d-81f6b8dd5e0f` 的 assistant 消息 `model` 字段为 `gpt-5.6-luna`，回复「已收到，我的模型名是 GPT-5.6。」。
- 刷新后 3 个节点、视野 100%、最近查看的会话面板重新打开并显示真实回复；会话文件中的用户消息仍是 1 条，没有自动发送。画布记录 `~/.pi/agent/waygoal/workspaces/playground-99005ca70a29/canvas.json` 只含 3 个位置和最近查看。
- 环境备注：本次用桌面端内置浏览器面板操作，面板在后台时 `document.hidden` 为 true，轮询和 ChatWindow 的事件流按设计暂停，回复要等面板可见或刷新后才显示；这是面板状态而非产品缺陷，但值得记住：画布只在页面可见时刷新。

## 代码审查后的修正

按 `/code-review` 结果做了四处收窄：GET 不再记录「上次工作目录」（去掉 `state.json`）和顶部切换表单；恢复视野与自动定位不回写记录；skill 解析改为与 Pi 一致并绑定会话自己的 skill 名单；`samePath` 改名为 `sameWorkspace` 以区别于 `lib/paths.ts`。节点尺寸常量统一由 `waygoal-types.ts` 导出。

## 未覆盖与边界

- 多画布、手动分组与连线、真实分叉呈现、会话重命名入口、票据挂载尚未接入；多进程同时写同一 `canvas.json` 未处理。
- 工作目录切换只接受已存在的目录；项目级 skills/extension 的信任提示复用 pi-web 的 `/api/project-trust`，本次验证目录不含项目级资源。
