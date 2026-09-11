# 本地票据从来源进入画布（票 #7）试跑

日期：2026-09-10。入口：`http://127.0.0.1:30142/beacon`（`npm run dev`）。票据：[#7](https://github.com/s0ftnote/Waygoal/issues/7)，父 Spec [#1](https://github.com/s0ftnote/Waygoal/issues/1)，前置 [#2](https://github.com/s0ftnote/Waygoal/issues/2)。

## 结论

工作目录里本来就有的 Markdown 地图和票据，直接出现在会话画布上：程序自己读来源文件，Agent 不用再抄一份正文，也不用专门发布一次。展开一张票据看到的就是那个文件本身——原始结构、Question 与 Answer 一起——并标出来源路径和读取时间。看票据不启动任何 Pi 会话。改标题、反复刷新都不会多出卡片；文件不见了，卡片留在原处并说明「读不到来源」，显示的是上一次成功读到的内容和时间，而不是猜一个标题相近的文件绑上去。

## 实现摘要

- 布局是明确的一种，不是「任意本地 tracker」：`.scratch/<地图>/map.md` 加 `issues/NN-*.md`，字段沿用本地 Markdown tracker 的 `Type:`、`Status:`、`Blocked by:`、`## Question`、`## Answer`。`.scratch/` 下没有 `map.md` 的目录会被照实报出「这里没有 map.md」，而不是静默忽略，也不假装支持别的格式。
- 读取器 [lib/waygoal-tickets.ts](../../apps/web/lib/waygoal-tickets.ts) 只读不写，复用票据原型已有的扫描器（`parseTicket` 与路径检查 `safePath`，[lib/beacon-store.ts](../../apps/web/lib/beacon-store.ts)），不新造第二套解析。每次读文件前都确认路径仍在这个工作目录内：票据文件只读，但一条指向外面的符号链接照样会把内容带出去。
- 一份读不到不牵连其余：读不出的票据文件、读不出的 `map.md`、`.scratch/` 下不是这个布局的目录，都各自记下来并在画布上说明，其它地图、票据和会话节点照常显示。
- 身份是「工作目录 + 来源文件相对路径」，不是标题，也不是票据编号：跨地图同号不会混淆，改标题只是同一张卡片换了名字。
- 依赖关系复用现有阻塞判断：`Blocked by: 09, 02` 里指不到票据的编号标为 missing、指到多份的标为 ambiguous，两种都让票据保持被挡住的状态——读不出来的关系不等于没有关系。同号重复时地图上会带一条说明，指出依赖它的票据无法确定指向哪一份。编号按数值比较（`01` 与 `1` 同一张），显示时保留文件自己的写法。
- 快照与布局保存在已有的画布记录里（`<agentDir>/waygoal/workspaces/<id>/canvas.json` 的 `tickets` 字段），和会话节点共用同一套位置分配与拖动；票据不会被算成会话节点。记录里的 `readAt` 记的是「这份内容是什么时候读到的」，文件没变就沿用上次的时间，因此每 2.5 秒一次的轮询不会反复重写记录。
- 读不到时的降级在 `mergeTicketScan`：这次扫描没产出、但以前读到过的地图和票据都保留下来，带上 `lastReadAt`（上次成功读到的时间）与 `checkedAt`（这次读不到的时间）。界面上卡片变虚线并显示「读不到来源」，展开后先是一条说明，再是上次读到的正文。
- 界面 [components/WaygoalTicketPanel.tsx](../../apps/web/components/WaygoalTicketPanel.tsx)：类型、状态、所属地图、依赖（已满足／等待中／未知分开标）、来源路径、读取时间，正文按原样呈现。

## 验证

单元测试：[lib/waygoal-tickets.test.mjs](../../apps/web/lib/waygoal-tickets.test.mjs) 12 项（布局与身份、依赖解析、同号重复、没有 map.md 的目录、读不出的单个票据文件不牵连邻居、读不出的 map.md 不牵连整张画布、空工作目录、读不到时的合并、改标题、整张地图消失、正文与来源文本、重复读取产出同一份记录）；[lib/waygoal-store.test.mjs](../../apps/web/lib/waygoal-store.test.mjs) 追加 3 项（卡片与布局按工作目录持久化且没变化时不重写记录、宿主重启后仍带上次读到的内容、票据不会混进会话节点且会缓存进画布记录）。

浏览器验证（`npm run test:waygoal-tickets`，[e2e/waygoal-tickets.mjs](../../apps/web/e2e/waygoal-tickets.mjs)）：隔离的 `PI_CODING_AGENT_DIR`、独立 Next 宿主，不配置模型。16 项检查全部通过：

- 地图和票据来自这个工作目录自己的文件；读本地文件没有启动任何 Pi 会话（会话目录始终为空）。
- 完整视图显示的是文件本身，结构、Question 与 Answer 都在。
- 指得到的依赖读作它命名的那张票据。
- 在 Waygoal 之外改文件，刷新即被读到，不需要谁来发布一次。
- 反复读取不新增卡片；把标题改掉后仍是同一张卡片，不是新的一张。
- 指不到任何票据的依赖被报出来，不当成已满足；两张票据同号时依赖保持未定。
- `.scratch/` 下没有 map.md 的目录被明确说明，并且是说在画布上，而不只是接口返回值里。
- 停止并重启宿主后，布局和上次读到的内容都还在。
- 删掉来源文件后，卡片没有从画布上消失，显示的是上一次成功读到的正文，并说明现在读不到、不能当作现在的状态。
- 无页面脚本或控制台错误。

证据：截图 `prototype-evidence/tickets/01-local-tickets.png`、`02-stale-source.png`。同时通过全项目 TypeScript 检查和改动文件的 ESLint。全量单元测试 969/973 通过，其余 4 个文件（`lib/rpc-manager-*.test.mjs`、`lib/rpc-session-info.test.mjs`）在本次改动前的提交 `8876e68` 上以同样的 `Cannot find module '@/lib/skill-lock'` 失败，属于上游既有问题。

## 本票没有做的

- 变更发现走画布已有的 2.5 秒轮询和页面刷新，没有接 `lib/beacon-extension.ts` 里那条 extension 变更检查通道；在 Waygoal 之外改文件确实会被读到（e2e 有验证），但触发机制留给远程来源那张票（#10）一起定。
- 只支持 `.scratch/<地图>/map.md` 加 `issues/NN-*.md` 这一种布局。一个 `.scratch/` 下没有 `map.md` 的目录会被报成「没有读成地图」，这是照实说明，不是支持。（本仓库根上曾有一个装规格底稿的 `.scratch/`，2026-09-11 已搬到 `docs/spec/`，把这个名字还给工作目录里的 tracker。）
- 票据和会话还没有挂在一起：票据卡片旁边不显示相关会话，也不能从票据开始讨论，那是票 #8。

## 实测发现

- 又一次是截图而不是断言暴露的问题：「这个目录还没有 Pi 会话」的空状态框压在票据卡片上（空状态要同时看会话和票据才判断）；面板把标题显示了两遍；工具栏只报会话数、不提票据。三处都改掉后重跑。
- 读不到 `map.md` 原本会把整张画布带下去：读取器只给票据文件包了 try/catch，地图文件没有，一次权限问题或删除竞态就让 `GET /api/waygoal` 返回 400，连会话节点都不显示。现在每张地图各自兜住，读不到的那张退回上次读到的内容。
- 记录被反复重写：判断「有没有变」时把 `readAt` 也算进去了，而它每次扫描都是新时间，于是每 2.5 秒轮询都会重写 canvas.json。改成让 `readAt` 跟着内容走：文件没变就沿用上次的时间。
- 卡片背景一直是透明的：`.waygoal-app button { background: none }` 的优先级压过 `.waygoal-node` / `.waygoal-ticket-card` 这类单类名选择器，画面上看不出来，直到把两张卡片拖到重叠——底下那张的文字透过上面那张显出来。改成 `.waygoal-app :where(button)`（优先级归零，组件自己的背景生效），并让正在查看的那张卡片浮到上层。
- 票据编号在文件里写作 `01`、在依赖里写作 `1`：比较要按数值，显示要保留文件自己的写法。指得到时显示被指向那张票据的编号，指不到时只能显示引用里写的那个数。
- 「文件不见了」和「文件没读过」必须分开：前者要留下上次读到的内容和时间，后者什么都不该显示。这也是不按标题重新绑定的原因——同一个标题在另一个目录里是另一件事。
