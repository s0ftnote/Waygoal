# Waygoal 以 Pi extension 交付的形态核查

研究日期：2026-09-10。问题范围：Waygoal 想做成一个 `pi install npm:waygoal` 安装的 npm 包，其 extension 负责拉起或连上一个本地 Web host，host 独立于 Pi 会话长期运行，画布还要能显示（可能续聊）用户在终端 Pi 里开的会话。本次只读代码和官方文档，未运行模型、未读 `~/.pi` 凭据、未启动服务。

## 版本与证据边界

证据来自本机已安装的 **Pi SDK 0.85.1**（`apps/web/node_modules/@earendil-works/pi-coding-agent`，`package.json:1-4`）随包发布的官方文档 `docs/` 与编译产物 `dist/`，以及 pi-web fork（上游 `agegr/pi-web@a26cc68`）。下文路径均相对仓库根目录 `/Users/neuron/文稿/2 私人/beacon`。`dist/*.js` 是 `src/*.ts` 的 tsgo 输出，行为一致但行号与上游源码不同；引用行号以本机文件为准。

标记：**事实**来自官方文档与源码；**推断/建议**是针对 Waygoal 的判断；**待验证**未在本次跑通。

## 1. 打包与安装契约

**事实：安装源与落盘位置。** `pi install npm:@foo/bar@1.0.0` / `git:` / 绝对或相对本地路径三种源都支持；默认写入用户设置 `~/.pi/agent/settings.json`，`-l` 写入 `.pi/settings.json`（`docs/packages.md:22-43`）。npm 包用户级装到 `~/.pi/agent/npm/`，项目级装到 `.pi/npm/`（`docs/packages.md:63-65`）。实现里安装根就是这两个目录，包本体在 `<root>/node_modules/<name>`（`dist/core/package-manager.js:1684-1692`、`1723-1731`）；安装前会在该根写一个 `package.json` 和 `.gitignore`（`dist/core/package-manager.js:1663-1682`）。

**事实：`package.json` 契约。** `pi` 键声明 `extensions` / `skills` / `prompts` / `themes` 路径数组，相对包根，支持 glob 和 `!排除`；建议带 `pi-package` keyword（`docs/packages.md:118-133`）。没有 `pi` 清单时走约定目录：`extensions/` 收 `.ts` 和 `.js`，`skills/` 递归找 `SKILL.md`，`prompts/` 收 `.md`，`themes/` 收 `.json`（`docs/packages.md:158-165`）。实现中，一个目录的 extension 入口解析顺序是：`package.json` 的 `pi.extensions` → `index.ts` → `index.js`（`dist/core/package-manager.js:377-401`）。

**事实：编译后的 JS 可以直接作为 extension。** 加载器用 jiti 动态 import，`.ts` 和 `.js` 一视同仁（`dist/core/extensions/loader.js:409-437`，`dist/core/extensions/loader.js:526-529`）。所以 Waygoal 可以只发布编译产物，不必让用户机器上现编译 TypeScript。

**事实：包可以带自己的依赖，但有约束。** 运行时依赖写 `dependencies`；Pi 安装时执行生产安装 `npm install --omit=dev`，`devDependencies` 运行时不存在（`docs/extensions.md:149-152`，`dist/core/package-manager.js:1449-1453`）。实际 npm 分支用的是 `install <spec> --prefix <root> --legacy-peer-deps`（`dist/core/package-manager.js:1459-1484`），即在共享安装根做一次普通 npm 安装，依赖按 npm 常规提升到 `<root>/node_modules`。引用 Pi 自身的包（`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`）必须放 `peerDependencies: "*"` 且不打包，加载器会把这些说明符 alias 到宿主 Pi 的实现（`docs/packages.md:171-173`，`dist/core/extensions/loader.js:90-113`）。

**事实：大体积预构建资产没有被禁止，但不会被 Pi 当作资源扫描。** extension 自动发现明确跳过 `node_modules` 和点开头目录（`dist/core/package-manager.js:404-440`）；`.next` 这类目录只是普通文件，随 npm tarball 一起落到 `~/.pi/agent/npm/node_modules/waygoal/.next`。**推断：**这意味着「npm 包里塞一份 `next build` 产物」在机制上可行，代价是 Pi 的包更新流程要搬运整包体积。pi-web 自己就是这么发的：`files` 只带 `bin`、`.next`（排除 cache/dev/map）、`public`、`next.config.ts`、`package.json`（`apps/web/package.json:20-27`）。

**事实：`/reload` 与设置里的本地路径。** 官方要求放在 `~/.pi/agent/extensions/` 或 `.pi/extensions/` 才能被 `/reload` 热重载（`docs/extensions.md:7`）；`settings.json` 的 `extensions` 字段是「本地 extension 文件或目录路径」列表（`docs/settings.md:279-286`），加载器默认还扫 agentDir 下的 `skills/prompts/themes/extensions`（`dist/core/resource-loader.js:620-626`）。`reload()` 在已加载过的情况下调用 `clearExtensionCache()`（`dist/core/resource-loader.js:263-267`），而缓存清空会让 jiti 重新 import 模块（`dist/core/extensions/loader.js:118-124`、`409-437`，注意 `moduleCache: false`）。**推断：**`/reload` 后 extension 的模块级变量（例如缓存的子进程句柄）全部丢失，因此任何跨 reload 的状态必须落到进程外（端口文件/socket），不能靠模块单例。

## 2. 从 extension 拉起长期进程

**事实：官方明确禁止在 factory 里起后台资源。** 「Extension factory 可能运行在根本不会开始会话的调用里。不要从 factory 启动进程、socket、文件监听或定时器」，应推迟到 `session_start` 或真正需要它的命令/工具/事件，并注册幂等的 `session_shutdown` 清理（`docs/extensions.md:220-224`）。

**事实：生命周期。** 启动依次 `project_trust → session_start{startup} → resources_discover`；`/new`、`/resume` 会 `session_before_switch → session_shutdown → session_start{new|resume} → resources_discover`；`/fork`、`/clone` 同理给 `session_start{fork}`；退出（Ctrl+C/D、SIGHUP、SIGTERM）发 `session_shutdown`（`docs/extensions.md:276-350`、`432-433`、`516-524`）。`ctx.reload()` 等价 `/reload`，会先发 `session_shutdown` 再重新加载并发 `session_start{reload}`，且 reload 之后的代码仍跑在旧版本闭包里，官方建议把 reload 当作该 handler 的终点（`docs/extensions.md:1303-1325`）。

**事实：extension 就是普通 Node 代码，没有沙箱。** 可用 Node 内建模块，npm 依赖照常解析（`docs/extensions.md:145-152`）；包文档在安全提示里直接写「Pi 包以完整系统权限运行，extension 执行任意代码」（`docs/packages.md:20`）。**推断：**因此 `child_process.spawn(..., { detached: true, stdio: "ignore" })` + `unref()` 让 host 活过 Pi 进程，在能力上没有障碍；文档层面的约束只是「别在 factory 里起，起了要能关」。而 Waygoal 的 host 恰恰**不**应该在 `session_shutdown` 里被关掉——这与官方给出的「session-scoped 资源」范式相反，属于要自己承担的偏离：需要一个进程外的 owner 标记（PID/端口文件）而不是靠 Pi 的生命周期管理。

**事实：打开浏览器没有专门限制，pi-web 已有先例。** pi-web 的 CLI 在 Next 输出 `Ready` 后用 `spawn("open"|"xdg-open"|cmd /c start, [url], { stdio: "ignore", detached: true })` 再 `unref()`（`apps/web/bin/pi-web.js:94-131`）。`pi.registerCommand` 的 handler 是普通 async 函数（`docs/extensions.md:1525-1546`），文档未对其可执行的 Node 操作设限。

**事实：pi-web 的正常启动方式。** bin 是 `bin/pi-web.js`（`apps/web/package.json:17-19`），它检查包目录下的 `.next` 是否存在，然后 `spawn(process.execPath, [nextBin, "start", "-p", port, "-H", host], { cwd: pkgDir })`，即标准 `next start`，不是自定义 server（`apps/web/bin/pi-web.js:41-64`、`80-89`）。子进程通过 `wireChildProcessLifecycle` 绑定父进程 SIGINT/SIGTERM（`apps/web/bin/process-lifecycle.js:14-60`）。**推断：**构建产物是「可搬运但需固定 cwd」的：`next start` 必须以包根为 cwd 且 `.next` 在旁边；`next.config.ts` 只设了 `outputFileTracingRoot`，没有 `output: "standalone"`（`apps/web/next.config.ts:15`），所以运行时仍依赖包的 `node_modules`。

## 3. 会话文件并发

**事实：写法是「先攒后追加」，没有锁，没有 fsync。** `SessionManager` 在没有 assistant 消息前不落盘（`dist/core/session-manager.js:735-752`）；出现第一条 assistant 消息时用 `openSync(file, "wx")` 一次性写全量，之后每条 entry 用 `appendFileSync` 追加（`dist/core/session-manager.js:753-768`）。全量重写 `_rewriteFile()` 用 `openSync(file, "w")` 截断重写（`dist/core/session-manager.js:708-719`），调用点只有三处：版本迁移后（`:673-679`）、打开一个 0 字节文件时初始化 header（`:619-636`）、以及 fork/clone 写新文件（`:1162-1178`）。全仓 `proper-lockfile` 只用于 `settings-manager` / `auth-storage` / `trust-manager` / `package-manager-cli`，**session 文件没有任何锁或 owner 标记**（`dist/` 全文检索）。

**事实：没有人监听 session 文件的变化。** SDK 里的文件监听只有 git HEAD/reftable（`dist/core/footer-data-provider.js:251-330`）和主题文件（`dist/modes/interactive/theme/theme.js:6`）。`SessionManager.open()` 在构造时一次性读入 entries（`dist/core/session-manager.js:619-637`），此后以内存中的 `fileEntries` 为准。

**推断（并且是本次最重要的结论）：两个进程同时打开同一个 jsonl 会互相覆盖。** 终端 Pi 与 Web host 各自持有一份 `fileEntries` 快照；两边都追加时，文件内容是两条分支的交错，谁都没有对方的 entry；任一侧触发 `_rewriteFile()`（迁移、或 fork 前的路径）会直接把对方写入的行截掉。`appendFileSync` 每次都是独立的 open/write/close，也不保证一行不被拆开。

**事实：TUI 恢复方式。** `pi --session <path|id>` 指定会话文件或部分 id，`pi -c` / `--continue` 继续最近一次，`/resume` 打开选择器（`docs/sessions.md:7-14`、`26`、`39`）。会话默认存 `~/.pi/agent/sessions/--<路径>--/<时间戳>_<uuid>.jsonl`（`docs/session-format.md:5-11`）。

**事实：pi-web 目前只做进程内的「正在运行」判定。** `lib/session-liveness.ts` 是挂在 `globalThis` 上的注册表，只用来防止空闲驱逐（`apps/web/lib/session-liveness.ts:42-110`）；`startRpcSession` 用进程内 registry + inflight locks 去重（`apps/web/lib/rpc-manager.ts:1937-1951`）。**没有任何跨进程的「这个会话正被别的进程写」检测**。`lib/session-reader.ts` 则直接以只读方式扫 jsonl（`apps/web/lib/session-reader.ts:1-16`）。

**待验证：**并发追加的实际破坏形态（交错、截断、还是仅分支分裂）需要一个不跑模型的实验即可确认，见文末。

## 4. Extension 与 host 的通信

**事实：现成的三个出口。** `pi.events` 是共享事件总线，host 侧把同一个 `eventBus` 传给 `DefaultResourceLoader` 就能在 Pi 之外收发（`docs/sdk.md:656-670`）——但它是同进程 `EventEmitter`，跨不了进程。`pi.appendEntry(customType, data)` 把自定义数据写进会话且不进模型上下文，`session_start` 时可回读（`docs/extensions.md:1471-1486`）；Waygoal 现有 extension 就用它发 `beacon:map-changed`（`apps/web/lib/beacon-extension.ts:55-65`）。`session_start` 事件带 `reason` 和 `previousSessionFile`（`docs/extensions.md:393-399`、`432`）。

**事实：Pi 没有为 extension 约定「每个 extension 自己的状态目录」。** agentDir 下 Pi 自用的是 `auth.json`、`models.json`、`keybindings.json`、`settings.json`、`sessions/`、`skills/`、`prompts/`、`themes/`、`extensions/`、`npm/`、`git/`、`tmp/extensions/`（`dist/core/config.js:421-440`，`dist/core/resource-loader.js:620-626`，`dist/core/package-manager.js:81-86`、`1686-1692`、`1765-1767`）。`getAgentDir()` 是公开导出，且尊重环境变量覆盖（`dist/index.d.ts:2`，`dist/core/config.js:421-427`）。

**建议：**最简可靠的传输是「agentDir 下自建目录 + 端口文件 + localhost HTTP」：extension 读 `getAgentDir()`，在 `~/.pi/agent/waygoal/host.json` 里写 `{pid, port, token, startedAt}`；有则 `fetch` 该端口校验存活，无则 detached spawn host 再等它写文件。理由：跨进程、跨 `/reload`（模块状态会丢，见 §1）、跨 Pi 重启都成立；unix socket 同样可行但 Windows 支持与路径长度更麻烦；纯文件监听在 host 侧要额外轮询，且没有请求-响应语义。token 必须有，因为 localhost 端口对本机任意进程开放。

## 5. host 侧的 SDK 能力

**事实：单进程托管多会话已经在跑。** pi-web 每个会话调用 `SessionManager.open(file)` 或 `SessionManager.create(cwd)`，再 `createAgentSessionServices({cwd, agentDir, settingsManager, resourceLoaderOptions})` 和 `createAgentSessionFromServices({services, sessionManager, ...})`，用进程内 registry 管理多个 wrapper（`apps/web/lib/rpc-manager.ts:1937-2070`）。Waygoal 的 extension 正是通过 `resourceLoaderOptions.extensionFactories` 注入的（`apps/web/lib/rpc-manager.ts:2026-2040`）。

**事实：SDK 提供 `createAgentSession()`（`dist/core/sdk.d.ts:107`）、`AgentSessionRuntime` / `createAgentSessionRuntime()` 负责 new/resume/fork/import 的会话替换（`docs/sdk.md:114-153`）、以及 `SessionManager` 的 `create/open/continueRecent/inMemory/forkFrom/list/listAll` 静态工厂（`dist/core/session-manager.d.ts:319-355`）。**

**事实：存在一条真正只读的展示路径。** `SessionManager.inMemory(cwd, options, entries)` 明确用于「会话存在文件系统之外」的场景（`docs/sdk.md:791-794`，`dist/core/session-manager.d.ts:333-334`），配合公开导出的 `loadEntriesFromFile(filePath)`（`dist/core/session-manager.d.ts:169`）即可加载磁盘会话而不接管写权。构造时 `persist=false` 会让 `_persist()` 直接返回（`dist/core/session-manager.js:735-737`）。**推断：**这就是「画布展示终端里开的会话」应该走的路——`SessionManager.open()` 会让 host 成为该文件的第二个写者，`inMemory + loadEntriesFromFile` 不会。

## 对交付形态的含义

**证据支持的假设：** (a) npm 包 + `pi` 清单 + 编译后 JS extension 完全在契约之内，包可带 `dependencies` 与 `.next` 这类预构建资产；(b) 从 extension detached spawn 一个活过 Pi 的 host、以及打开浏览器，都在能力范围内，pi-web 自己就用 detached+unref 开浏览器；(c) 单进程托管多会话是 pi-web 的既有实现；(d) 画布只读展示终端会话有干净做法（`loadEntriesFromFile` + `SessionManager.inMemory`）。

**证据反对或需要改写的假设：** (1) 「host 跟着会话生命周期走」不成立——官方要求后台资源在 `session_start` 之后起、在 `session_shutdown` 关，而 Waygoal 要的正相反，必须把 host 的存活判定放到进程外（端口文件 + 存活探测），并接受 Pi 不会替我们回收它；(2) 「extension 里存个 host 句柄就够了」不成立——`/reload` 清缓存并重新 import 模块，模块级状态必然丢失；(3) 「画布可以直接续聊终端里正在跑的会话」在当前 SDK 下不安全——jsonl 无锁、无 owner 标记、无变更监听，两个 `AgentSession` 同时打开同一文件必然互相覆盖，pi-web 也没有跨进程的运行中检测。可续聊的只应是**已经结束的**会话，且需要 Waygoal 自己发明 owner 约定。

**待验证与对应实验：**

1. **并发写的实际破坏形态。** 不跑模型：用 SDK 在两个 Node 进程里各 `SessionManager.open()` 同一个已有 jsonl，交替 `appendCustomEntry()`，然后比对文件行与两边内存快照。预期看到分支丢失；要确认是否出现半行。
2. **detached host 的存活。** 从一个 `pi -e ./ext.ts` 会话里 spawn 一个写端口文件的最小 HTTP 进程，退出 Pi（Ctrl+D 与 SIGTERM 各一次），确认进程仍在、端口文件仍有效；再重开 Pi 确认走的是 attach 而不是二次 spawn。
3. **`/reload` 与会话切换下的 attach 行为。** 在同一 Pi 进程内执行 `/reload` 与 `/new`，各记录一次 factory 是否重跑、模块级变量是否保留（`loader.js:118-124` 与 `resource-loader.js:263-267` 预示 reload 丢、切换可能不丢），据此确定端口文件是否是唯一可信来源。
4. **`pi install npm:` 装大包。** 用一个含 `.next` 量级 payload 的本地 tarball 走 `pi install`，测量安装耗时与 `~/.pi/agent/npm/node_modules/<name>` 的完整性，确认 `--omit=dev`、`--legacy-peer-deps` 下 peer 的 Pi 包确实由宿主提供而未被重复安装。
5. **只读展示路径。** 用 `loadEntriesFromFile` + `SessionManager.inMemory` 打开一个终端会话文件，确认全程无写入（对文件做 mtime/inode 比对），并确认展示所需字段齐全。
