# ThoughtDAG 当前源码核查：可借鉴的交互与实现边界

## 范围与证据口径

- 对象：已下载归档 `/tmp/waygoal-thoughtdag-review`；按主线程提供的归档 commit **`f05fc44`** 固定全部 GitHub 来源。不声称另行验证过远端 HEAD 或正式发行包。
- 方法：阅读一手文档、组件事件处理、状态动作与上下文编译路径；**未安装、未启动、未执行仓库说明命令或测试、未读取远程 issues、未研究 Waygoal 当前代码**。这是静态核查，不是运行验收。
- 本轮独立核对当前能力，不重复两份历史研究的全量观点。下文“价值/借鉴边界”是研究判断，不代表 Waygoal 已有能力或实施方案。
- **文档宣称**与**代码已核对**分别列出；代码存在不等于跨平台、跨模型稳定可用。源码注释若比函数行为更强，以实际调用与字段为准。
- 总入口：[README](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/README.md)、[docs/features.md](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/features.md)、[Feature status](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/reference/feature-status.md)。后者明确区分当前、实验与提案：Why layer 为已发布但实验性；Context Bundle v0 仍是实验提案；不能推导出自动多 agent 编排或改写原始会话历史。

## 1. 选文 Explore：把“这句话引发的问题”保留为分支起点

**具体操作 / 已核对**：在回答正文选字 → 浮出 Explore / Highlight → Explore 把原句暂存到提问区 → 输入问题提交。`ThoughtNode` 记录 `branchContext` 和选区相对高度 `branchYRatio`；`addQuestion` 新建节点并画橙色结构分支；`buildContext` 增加 `[Regarding this passage: …]`。原回答、主路径都保留。编辑回答使用按钮，而非抢占双击选词。

**价值**：把“随手追问”变成有语义锚点的旁路探索；用户不必复制粘贴或把主线拉长。Explore 与 Highlight 并列，也区分了“继续思考”与“收集证据”。

**风险与借鉴边界**：选文是额外聚焦信息，**不是仅发送选区**；结构边仍引入上游对话与材料。普通回答选区保存的是文字及视觉相对位置，不是稳定字符区间；改写原回答后定位未必精确。借鉴时需明确显示“引用原句”和“实际带入上下文”，避免把橙色分支误读为轻量请求。

**证据**：文档 [Conversation nodes](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/conversations.md)；代码 [ThoughtNode.tsx#L145-L207](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/ThoughtNode.tsx#L145-L207)、[llm.ts#L16-L119](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/llm.ts#L16-L119)、[context-builder.ts#L311-L347](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/context-builder.ts#L311-L347)。

## 2. 材料引用：来源关系不必等于上下文依赖

**具体操作 / 已核对**：将材料接入问题；用引用边引入别处节点；删边保留节点；归档节点保留内容但不再贡献文本。`partitionContext` 将输入分成材料、虚线引用、结构主线；默认引用块包含来源节点 Q/A 与上游问题轨迹，而非所有上游回答，也不会递归转发引用的引用。材料即使由虚线接入，仍按材料处理。卡片折叠仅改变显示，不压缩实际发送内容。

**特别值得借鉴**：阅读器“保存选文为笔记 / 剪区域为图片”创建**不连原文的独立材料节点**，通过 `anchor.attId/page/rects` 保留来源。这样下游只引用摘录时，不会因溯源边把整篇文档再次带入。

**价值**：把“证据从哪里来”与“模型要读哪些内容”分开，兼顾回溯和成本可控。

**风险与借鉴边界**：README 的 “Wires are the context” 是主原则而非完整请求规范：角色、附件排除、高亮过滤和生成时记忆注入也影响输入。归档节点自身不贡献内容，但遍历仍可穿过它保留更早祖先，不等于剪断整条分支。引用块主要编译 Q/A，不能承诺连带来源节点的全部附件。需为“来源链接 / 参与上下文”使用不同数据字段与视觉语义。

**证据**：文档 [Control context](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/context-control.md)；代码 [graph.ts#L70-L124](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/graph.ts#L70-L124)、[context-builder.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/context-builder.ts)、[MaterialReader.tsx#L324-L394](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/MaterialReader.tsx#L324-L394)。

## 3. Will send：在发送处暴露上下文构成，但当前预览不等于最终请求

**具体操作 / 已核对**：节点面板输入框上方点击 “will send ~… tok · … messages” → 展开材料/引用/对话 token 构成及逐消息列表。代码调用同一个 `buildContext`，逐条展示角色、前 90 字与 token 估算；材料加引用超过 1,000 token 且大于对话层时显示背景过重提示。

**价值**：把上下文控制放在决定发送的最后一刻，而不是藏进设置；让用户知道成本主要花在哪一层。

**重要实现差距**：`preview` 只编译当前节点，依赖项不含待输入问题、暂存选文、待发附件、此次“不继承附件”开关或新 mention。`submit` 才传这些参数；`runNodeGeneration` 还会在 `buildContext` 之后插入 ambient memory。图片也不计入逐文本消息 token 合计。因此不能将文档的“actual / next request”直接当作严格所见即所发；它更接近**当前已继承上下文的摘要预览**，且不是完整正文检查器。

**借鉴边界**：优先借鉴“紧邻输入、默认摘要、按需展开、解释组成”，但实现应让预览和提交共用同一份待发送请求快照；草稿、选文、附件、记忆、工具及图片预算都应显式纳入或标示未计入。

**证据**：文档 [Control context](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/context-control.md)；代码 [FollowUpInput.tsx#L64-L154](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/focus-panel/FollowUpInput.tsx#L64-L154)、[llm.ts#L120-L155](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/llm.ts#L120-L155)、[streaming.ts#L210-L228](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/streaming.ts#L210-L228)。

## 4. 多选综合与 Weave：先表达综合意图，再形成有来源的新产物

**具体操作 / 已核对**：选中至少两个节点才出现工具条；点击 Merge summary / Merge & delete / Weave 可填写可选意图，Explore 则必须填写问题。仅当所选节点存在高亮时出现 Weave。综合节点以意图作可见问题，提示词要求“结论、依据、分歧与未决”，而不是逐条流水摘要。连线只接所选集合的结构性末端，祖先经已有链进入，避免重复接线。

**价值**：把多选从批量管理升级为“对这些内容做一次有目的的工作”；显式保留矛盾、证据和未决，比泛泛 summarize 更有用。

**风险与借鉴边界**：

- **Merge & delete 的实际范围大于文档“移除所选原件”**：生成成功后，会删除所选节点及其全部结构性后代（新综合节点除外），再接回边界父节点；此按钮的执行路径未见对应破坏范围确认。不能直接复制，应默认保留原件，并预览删除影响范围。
- Merge 沿真实上游编译，输入不局限于框选节点。Weave 则是特殊路径：**第一次仅发送编号高亮；新节点后的追问会沿连线读取完整上游**。该函数没有保存逐高亮的稳定 `[n] → highlightId` 引用映射，不能仅凭提示词要求 `[n]` 就宣称点击级引文回溯已完成。
- 普通 rerun 走标准上下文构建；已核对路径没有为 Weave 保留“只送高亮”的专用重放分支。借鉴时应将产物类型、来源快照、综合意图与重做配方一起保存。

**证据**：文档 [Merge, highlight, condense](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/organize.md)；代码 [SelectionToolbar.tsx](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/SelectionToolbar.tsx)、[llm.ts#L458-L679](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/llm.ts#L458-L679)、[evaluator.ts#L35-L97](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/evaluator.ts#L35-L97)。

## 5. Condense：压缩副本而非悄悄改写原路径

**具体操作 / 已核对**：打开 Condense → 本地扫描候选连续段 → 查看轮数和预计节省、勾选 → 逐段流式蒸馏 → 在右侧生成凝练副本 → 点击 distill 节点来源 chip 回看原段。候选至少 3 轮；排除已归档/生成中/无回答节点、`decision/pivot`，保护每个叶子往前 3 轮。未选中段中的节点也会被复制；重建副本连线，原节点不删除；高亮原文追加到蒸馏正文。

**价值**：将压缩变为可对照、可检查的显式产物；“决策、转向、人工标记、正在工作末端不轻易压缩”比统一字数预算更符合研究过程。

**风险与借鉴边界**：

- 蒸馏输入主要是每轮问题（截至 90 字）、已有所得句，缺失时用回答前 160 字；不是对全文做无损压缩。预计节省用全文与短摘要差值推算，不是最终 token 实测。`decision/pivot` 保护又依赖模型分类，可能漏判。
- 实现复制的是**当前画布全部节点**而非只复制所选链；大图空间/存储成本要评估。候选扫描忽略虚线，且代码可能把分叉点作为段尾、汇合点作为段头；不要把文件注释“fork nodes never enter a run”当作已证明的严格约束。
- 完成时对原图加副本调用全图 `autoLayout`，因此“原内容和连线保留”不等于原手工坐标绝不变化。取消只使 runner token 失效，已在途模型调用没有通过该路径被 AbortController 立即终止。
- 借鉴应先做小范围副本、可手动保护节点、压缩前后输入对比；不要把自动蒸馏直接替代长期事实记录。

**证据**：文档 [Organize](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/organize.md)；代码 [CondenseDialog.tsx](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/ui/CondenseDialog.tsx)、[condense.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/condense.ts)、[ThoughtNode.tsx#L519-L538](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/ThoughtNode.tsx#L519-L538)。

## 6. 语义缩放 / 所得：缩远后看“思考产生了什么”，不只是缩小聊天卡

**具体操作 / 已核对**：缩放在 work / map / glyph 三档切换。work 缩小至 0.8 进入 map，map 放大至 0.9 才回 work；缩小至 0.32 进入 glyph，放大至 0.4 才回 map，形成滞回以避免边界闪烁。地图层中普通节点问题较小、所得/主题较大；根节点例外，以开场问题作地图标题。徽标区分 ruled out / decision / pivot / open；普通节点可弱化成微主题。双击地图卡回到 zoom=1。

**价值**：长对话的全局视图可以读成研究进展，而非一堆无法读的小文档；按信息重要性降噪比统一裁剪更有效。

**风险与借鉴边界**：所得句由额外模型调用生成，回答少于 400 字跳过，失败静默降级。短句及认知动作类型不是用户确认的事实；它们用于显示，不会因缩放/折叠自动减少发送全文。借鉴应允许编辑/确认所得、给生成失败可理解的降级，不把地图标签当权威决策记录。

**主线程补充，非本次重复验收**：单选突出主线、材料、引用及直接下游；地图 dock 提供导出和继续上次，hover beacon、点击 zoom=1 并开面板。主线程指出该返回路径有 1100ms 动效加定时器，**只借鉴定位/返回能力，不复制慢动效**。

**证据**：代码 [use-map-mode.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/use-map-mode.ts)、[ThoughtNode.tsx#L455-L504](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/ThoughtNode.tsx#L455-L504)、[streaming.ts#L19-L49](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/streaming.ts#L19-L49)；主线程提供的代码观察 [App.tsx#L872-L895](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L872-L895)、[App.tsx#L2026-L2097](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L2026-L2097)。

## 7. 查找与来源回溯：精确命中、证据类型、最后一跳

**具体操作 / 已核对**：画布搜索输入短语 → 列表显示类型、命中片段、次数和归档状态，同时淡化未命中节点 → 上下键/Enter 或点击定位并开面板 → 尝试滚到第一处文字并闪亮。搜索是本地大小写不敏感的子串扫描，覆盖问题、当前回答、高亮、链接标题、附件名、当前所得。

另一个独立入口是 CLI / 只读 MCP：按文件/URL/论文追溯触达轮次，或按 Q/A/M 搜精确短语；结果区分 `Δ` 观察到的改动与 `≈` 从回答摘出的候选解释，并给出 `thoughtdag://open?...` 来源节点/轮次链接。`recall_turn` 读取原会话轮次的问答与工具概况。

**价值**：不是停在“找到了这个会话”，而是尽量落到具体语句/轮次；把观察与解释分开，避免把 agent 说过的原因当成已证实因果。

**风险与借鉴边界**：画布搜索**不搜附件正文和历史回答版本**；CLI 的材料全文检索是另一条索引路径，不能混为一谈。画布 DOM 定位依赖 500ms 延时和面板可见文字，折叠内容/跨 Markdown 文本节点命中不保证定位成功。CLI 为实验能力、精确匹配非语义搜索；`recall` 的工具展示不是完整工具结果逐字回放，edit/write 调用截至 1,200 字。推荐先做确定性局部查找与稳定来源 ID，再增加跨会话索引。

**证据**：文档 [Why layer](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/why-layer.md)；代码 [canvas-search.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/canvas-search.ts)、[SearchBar.tsx](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/SearchBar.tsx)、[cli/src/lib.ts#L650-L925](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/cli/src/lib.ts#L650-L925)。

## 8. 读文档：阅读位置、问答轨、摘录与原文形成闭环

**具体操作 / 已核对**：双击材料进入 reader → 按材料可用能力切换 Original / Text / Digest → 选文提问 → 回答在阅读轨流式出现，可继续追问 → 画布回答的 `p.N` 返回来源页及该线程。原文选区保存页内比例矩形（最多取 8 个），文字视图不冒充纸面坐标。阅读轨是画布节点的视图，不是另存聊天；只沿唯一非分支结构孩子继续，岔路回画布处理。阅读位置在会话内记忆，Esc 按问句浮层 → 阅读轨 → 阅读器逐层退出。

**价值**：阅读、提问、摘证据、回原文不必不断切场景；页码与位置使答案可核查，而不是生成后与源文件失联。

**文档与代码边界**：

- 文档写“选文字或视觉区域后提问”；已核对的矩形处理 `handleClipped` / `handleImageClipped` 实际先生成独立图片材料，随后可接入问题；**未见矩形直接进入同一个 ask bar 的一步问答路径**，不应按文档概括直接承诺。
- PDF 常规问答走提取文字，不自动发送整套页图；但 `recognizePdfPages` 会逐页将图像交给配置的视觉模型。README “PDFs never leave your machine; only extracted text travels” 不能外推为“识别/截图永不发往模型”。远程视觉模型仍涉及图像出站、成本与隐私；它不是内置离线 OCR。
- Digest 是可版本化的回答节点，重生成输入截取提取文字前 120,000 字符；不是任何长度文件完整读完的保证。格式表中 PPT/PPTX/Keynote/ODP、旧 DOC、表格不属直接支持；此处依据官方输入文档，不声称逐格式解析器都已运行验证。

**借鉴边界**：优先做选文问答、独立摘录、页码回跳和阅读轨；扫描识别、复杂排版、Office 格式应明确失败/截断提示与授权边界。

**证据**：文档 [Materials](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/materials.md)、[Supported inputs](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/reference/supported-inputs.md)；代码 [MaterialReader.tsx#L217-L436](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/MaterialReader.tsx#L217-L436)、[MaterialReader.tsx#L545-L639](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/MaterialReader.tsx#L545-L639)、[content.ts#L246-L365](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/content.ts#L246-L365)、[evaluator.ts#L45-L64](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/evaluator.ts#L45-L64)。

## 9. 返回 / 交接：携带上下文，也携带明确的返程地址

**具体操作 / 已核对**：节点右键选择“带去 CLI 实验”或“在 CLI 继续” → 将该节点编译上下文复制成 Markdown，末尾附 `project/node/bundle/mode` anchor → 用户粘贴到新会话 → 导入/发现该会话时解析首轮 anchor，挂回原画布。branch 模式侧向挂载，continue 模式向下续接；已订阅会话优先按 ledger 追加，不重复导入。首轮复制过来的长上下文在镜像中换成出发标记，避免层层嵌套。

**价值**：外部工作不是一次性导出；用户能知道从哪里离开、带了什么、结果回到哪里。显式区分“旁路实验”和“主线继续”比系统猜测意图可靠。

**风险与借鉴边界**：这是剪贴板交接 + 会话镜像，不是自动启动并管理 agent，更不回写旧源日志。`renderHandoffMarkdown` 主要输出文本消息，不应承诺图像二进制也完整交接。anchor 是消息内声明，不是签名授权；目标已不存在时可降级普通导入。Context Bundle v0 仍是实验格式。实现需要稳定项目/节点标识、来源 ledger、重复导入处理和失效返程提示；剪贴板内容可能包含敏感材料，应允许发送前检查。

**证据**：文档 [Session Atlas](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/session-atlas.md)；代码 [NodeContextMenu.tsx#L83-L97](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/components/NodeContextMenu.tsx#L83-L97)、[experiment-loop.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/experiment-loop.ts)、[atlas/canonical.ts#L103-L202](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/atlas/canonical.ts#L103-L202)。

## 10. 撤销 / 重做：图编辑可逆不等于外部行动回滚

**具体操作 / 已核对**：工具栏或 Cmd/Ctrl+Z、Shift+Cmd/Ctrl+Z 撤销/重做。store 保留最多 50 个 nodes/edges 浅引用快照，利用不可变更新减少大型 PDF 数据复制；恢复只替换 nodes/edges 与历史指针。历史栈不持久化，重新载入以当前图为基线；Condense 运行时撤销/重做被 guard 阻止。

**价值**：连线决定上下文时，撤销是敢于剪枝、比较与整理的前提，而不是锦上添花。

**风险与借鉴边界**：这不是事件溯源，也不撤销已发送的模型请求、token 花费、外部文件、剪贴板或订阅 ledger。官方 Atlas 文档明确：删除全部镜像节点会退订；Undo 可恢复节点但不自动恢复订阅。各动作 `pushHistory` 的时点与生成结束快照尚未经运行验证，不能宣称所有异步复合动作都严格一步撤销。借鉴应区分图操作回滚、生成停止、版本恢复、订阅恢复，并做异步事务测试。

**证据**：代码 [history.ts](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/history.ts)、[constants.ts#L12](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/lib/constants.ts#L12)、[store/index.ts#L58-L78](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/index.ts#L58-L78)、[App.tsx#L708-L709](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L708-L709)；文档 [Session Atlas](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/session-atlas.md)。

## 11. Stale / Replay：告诉用户结论依赖已变，再显式付费刷新

**具体操作 / 已核对**：上游编辑/改边后，图变化经 400ms debounce 重新计算 fingerprint → 依赖变化的回答显示 stale → 单节点重生成或点击 replay 查看数量、输入 token 估算并确认 → 按结构依赖分批并行重生成，旧回答保留为版本；可停止后续批次。

**价值**：将“答案仍在但依据已变”显性化；stale 表示输入已变，不直接宣判答案错误。比自动覆盖更利于复核与可控成本。

**风险与借鉴边界**：

- Replay 在启动时冻结 stale 集合，依赖排序只考虑**结构边**，不包括虚线引用；运行中新变 stale 的节点留给用户下一轮处理。停止按钮只设标志，不立即终止本批已发出的请求。
- 指纹记录于生成完成时，计算基于当时图，而非完全冻结的发送时请求；生成期间修改上游存在误归因风险。指纹只哈希 `buildContext` 的文字消息，不覆盖纯图像内容或后插入记忆；无旧指纹的导入节点也不会自动标 stale。
- Replay 输入 token 估算不等于模型最终账单，尤其不含未来回答、工具/图片成本。应借鉴显式状态、版本保留与确认流程，但使用发送时请求快照、完整依赖排序及真正取消机制；不要宣称确定性重放。

**证据**：文档 [Versions, staleness, replay](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/guides/versions-replay.md)；代码 [context-builder.ts#L109-L129](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/context-builder.ts#L109-L129)、[nodes.ts#L244-L262](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/nodes.ts#L244-L262)、[evaluator.ts#L99-L137](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/slices/evaluator.ts#L99-L137)、[streaming.ts#L174-L209](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/store/streaming.ts#L174-L209)、[App.tsx#L1621-L1641](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/src/App.tsx#L1621-L1641)。

## 主线程提供的静态视觉观察（非运行验收）

主线程已实际查看以下官方截图，本轮未重复查看：

- [selection-toolbar-zh.png](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/selection-toolbar-zh.png)、[organize-merge-zh.png](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/organize-merge-zh.png)：多选才出现操作条。
- [map-dock-zh.png](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/map-dock-zh.png)：地图层问题小、所得重，提供返回入口。
- [node-panel-zh.png](https://github.com/chenxiachan/thoughtdag/blob/f05fc44/docs/public/screenshots/interface-overview/zh/node-panel-zh.png)：侧栏把附件、高亮、上下文折叠，发送预览紧邻输入。

这些仅辅助说明层级与入口位置，不能证明点击后的完整行为、性能或平台兼容性。

## 最值得借鉴的三项

1. **发送前可见的上下文组成 + 独立来源关系**：让用户知道“读哪些、为什么读、哪些不读”，同时摘录不被迫携带整篇原文。优先补齐预览与最终请求的一致性。
2. **选文探索 → 阅读轨 → 页码回源的闭环**：在当前阅读位置提出问题，结果仍成为可复用节点；比孤立的画布或孤立阅读器更有连续性。
3. **有意图的多选综合，默认保留原件**：以结论/依据/分歧产出可检查的新材料，保存稳定来源与重做配方；Condense 可作为后续的非破坏性高级操作，而非首期自动压缩。

总体判断：值得迁移的是“用户能看懂并修正上下文的交互”，不是直接复制整套节点种类、慢动效或 README 的绝对化承诺。优先避免四个误区：把显示缩略当上下文压缩、把来源关系当发送依赖、把镜像当源会话回写、把重生成当确定性重放。
