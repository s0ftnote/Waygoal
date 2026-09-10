# Matt 工作流的建议、注意事项与 Waygoal 交互机会

研究日期：2026-09-09。本文是第一方文章研究与待验证产品建议，不是新增的已接受决策，也不代表功能已经实现。已对照本项目 AGENTS.md、CONTEXT.md、ADR 0001/0002；不修改 Matt 的票据格式、全局 skills 或 tracker 配置。

后续决策说明：用户已撤回本文中将 grilling 转为问题卡、可操作草图或分析聊天内容来提供情境提示的提案。以下保留为研究记录；当前采用 Pi 原有聊天、画布导航与状态，以及按明确入口展示的小卡片/就地说明，见[当前设计](../design/canvas-navigation-and-states.md)和[修订后的 ADR 0003](../adr/0003-discussion-and-ticket-map.md)。

## 入口复核（2026-09-09）

对照用户提供的完整 `ask-matt`、本机 `grill-with-docs` / `grill-me` 及文章后，正文中的“普通起点是 grill”应读作：有工作目录时通常用 `grill-with-docs`，无工作目录时用 `grill-me`，二者使用同一 grilling 方法。它不是把产品根节点固定为 `/grilling` 的 UI 要求。

`ask-matt` 由用户主动调用，给出路线建议后停止；用户已经选好方法时直接调用即可。Wayfinder 适用于一场会话容不下的模糊探索，不以画布节点数量为触发阈值，也不要求先走完一次 grilling。产品保留方法入口与来源关系，不另建自动路由器。依据：[Ask Matt](https://www.aihero.dev/skills-ask-matt)、[Wayfinder 的位置](https://www.aihero.dev/skills-wayfinder#where-it-fits)。具体边界见 [ADR 0004](../adr/0004-canvas-carrier-and-user-chosen-skills.md)；入口默认值仍未定。

## 结论

优先验证 grilling 过程中的可操作视图有依据：当前的票据地图帮助用户找到一件事，而用户进入讨论后，仍需要看懂这轮问题、辨别推荐与自己的决定、补充事实、改变前提。可以在同一工作区切换整体地图和当前讨论的聚焦深度，不必另造一套画布产品。

这属于 Waygoal 的产品推导。Matt 没有规定这种 UI。也不宜把整个产品缩成 grilling：研究、试做、汇总及行动反馈仍要接得上。尤其要允许普通讨论在没有 Wayfinder 地图、没有 ticket 时使用该视图。

## 从文章到具体措施

“规范/建议”指作者描述的预期用法；“反馈”指文章转述的实际问题，未独立复现或核对相关 issue 的当前修复状态。最后一栏全部是我们的设计推导。

| # | 原文依据及性质 | 何时出现 | Waygoal 可以做什么（待验证） |
| --- | --- | --- | --- |
| 1 | **建议**：Wayfinder 只用于一场会话容不下的模糊探索；普通起点是 grill。[Where it fits](https://www.aihero.dev/skills-wayfinder#where-it-fits) | 用户刚表达想法 | 先开始澄清；确实需要拆开探索时解释理由并提供进入地图的路径。Tip：“先聊清这件事，需要分开探索时再展开地图。”不要让每次开始都先建地图。 |
| 2 | **规范**：地图是索引；问题足够清楚才建票，模糊方向保留为 fog。[Map / fog](https://www.aihero.dev/skills-wayfinder#the-map-the-fog-and-the-frontier) | 一段回答引出若干念头 | 在讨论中先展示候选问题；明确且需要独立推进的才登记为票据。不能把一句话、一个选项都变成新票。 |
| 3 | **规范**：每轮只问前提已成立的问题，回答会重塑下一轮。[Grilling frontier](https://www.aihero.dev/skills-grilling#the-round-the-frontier-and-who-decides) | Agent 发出一轮问题 | 展示“现在可以回答”“还在等什么”“已经确认”，允许从问题回看它承接的回答。由 Agent 判断前沿，界面呈现判断。 |
| 4 | **限制/反馈**：前沿不是可靠的计算图；同轮问题可能被误判为互不依赖，推荐语也可能与题目的 yes/no 相反。[Grilling frontier](https://www.aihero.dev/skills-grilling#the-round-the-frontier-and-who-decides) | 用户发现问题前提不对 | 可直接“反对这个前提”；选择按钮写完整意思，如“允许提前讨论”，不要只写“是”。修正后由 Agent 重新判断受影响问题。 |
| 5 | **建议**：支持一次一题；没有固定题数上限，用户可要求收束。[Grilling FAQ](https://www.aihero.dev/skills-grilling#common-questions) | 用户阅读吃力、轮次过长 | 提供“聚焦这一题 / 看本轮”以及“先收束一下”。不设机械问满题数、过关进度条或强制回答所有未来问题。 |
| 6 | **建议**：反复附和易形成虚假共识；不知道和反对都值得说。[Grill-me conversation](https://www.aihero.dev/skills-grill-me#its-a-conversation-not-an-interview) | 用户对建议拿不准 | 推荐、用户回答分别呈现，保留自由输入、“不知道”“换个前提”。Tip：“可以不同意，也可以先说不知道。”不要设置默认勾选所有建议。 |
| 7 | **建议**：谈不清的体验问题应试做；单个原型只解决一个问题，保留可回看的证据。[Prototype](https://www.aihero.dev/skills-prototype#when-to-reach-for-it)、[Primary source](https://www.aihero.dev/skills-prototype#the-prototype-is-a-primary-source) | 同一感受问题反复换说法 | 在原问题旁打开小样，比较真实差异；反馈后将结论和作品入口带回。Tip：“需要看过才能选，可以先试一版。”不把原型做成整个产品的无限施工。 |
| 8 | **规范**：可查的事实由 Agent 查，人的决定要等人；研究只阻塞依赖它的问题。[Grilling](https://www.aihero.dev/skills-grilling#the-round-the-frontier-and-who-decides) | 缺数据，但另一些问题可以继续 | 卡片标“等场地资料”，其余可答内容继续。模型建议不能显示成用户已确认，用户回答前不得自行完成 HITL 问题。 |
| 9 | **规范/反馈**：研究在后台产出带来源的文件；存在递归委派和产物无人再读的报告。[Research](https://www.aihero.dev/skills-research#delegated-legwork)、[FAQ](https://www.aihero.dev/skills-research#common-questions) | 发起研究、研究完成 | 显示这一项研究的运行状态；宿主避免同任务重复委派。完成时关联原问题、来源与日期，让主会话按需读结果。光显示“研究完成”不算交接。 |
| 10 | **反馈**：过早开大量票、并行 grilling 重复提问、问题冗长都被报告。[Wayfinder FAQ](https://www.aihero.dev/skills-wayfinder#common-questions) | 地图扩张、用户失去方向 | 每轮说明“这题为什么影响当前目标”；已有回答提供回看入口。Agent 建票前检查相关已知结论；优先一个活跃的人类讨论，研究可以后台运行。小提示不能替代这些行为。 |
| 11 | **反馈/建议**：旧决定失效没有完整官方修订流程；明确告知变化后可修订受影响记录。[Wayfinder FAQ](https://www.aihero.dev/skills-wayfinder#common-questions) | 用户改预算、受众或目标 | 提供“修改这项决定”，显示变化原因及 Agent 认为需复核的内容；保留原话。不要把任意连线下游全部自动重开，也不要把旧结论悄悄覆盖成从未变过。 |
| 12 | **规范/反馈**：地图完成交给 to-spec；文章报告 Agent 借自己写的 Notes 越界执行。[Wayfinder FAQ](https://www.aihero.dev/skills-wayfinder#common-questions) | 探索收束 | 明确呈现“准备汇总方案”的下一步及真实用户已授权的行动范围。票据关闭率不能代表方案已成；Notes 不能自授执行许可。 |
| 13 | **规范/反馈**：多数讨论决定留在会话；术语入 CONTEXT，少数重大取舍入 ADR。细节可能在后续弱化。[Grill-with-docs](https://www.aihero.dev/skills-grill-with-docs#the-paper-trail)、[FAQ](https://www.aihero.dev/skills-grill-with-docs#common-questions) | 讨论结束、即将汇总 | 继续利用原会话；汇总时让数字、否定要求和关键约束可回看原回答。文档存在与否看实际文件，不用“已沉淀”的动画替代写入。 |
| 14 | **规范/反馈**：to-spec 记录已有决定，并先核对测试边界；多会话工作才值得拆 spec/票，连续上下文可避免重新读取被截断。[To-spec](https://www.aihero.dev/skills-to-spec#seams-before-prose)、[FAQ](https://www.aihero.dev/skills-to-spec#common-questions) | 汇总并准备拆行动 | 默认承接已确认理解，突出完成标准和不做什么。显示方案依据入口；不要只因出现一个新产物就强制新会话。跨领域的创作简报、试映标准是我们的适配。 |
| 15 | **规范/反馈**：ask-matt 只建议，不执行；摘要可能滞后。包裹 skill 的依赖有加载遗漏报告。[Ask-matt](https://www.aihero.dev/skills-ask-matt#common-questions)、[Grill-with-docs FAQ](https://www.aihero.dev/skills-grill-with-docs#common-questions) | 推荐下一步、开始相应流程 | 用当前实际安装内容核对 skill 及依赖；展示实际步骤而不是仅贴技能名。扩展点可让别的 skill 提供自己的交互，但不能声称 ask-matt 已会自动发现它们。 |

## 局部画布可以怎样试

以下是虚构的活动设计场景，用来验证交互，不是用户已经选定的活动方案。

用户说：“想办一个周末小聚会。”视图先围绕一个真实待答问题展开：**这次更想让大家放松、交流，还是学点东西？** 可以并排比较选择，但旁边始终能自由补充：“都不是，我希望老朋友重新熟悉起来。”

在这个回答明确前，“观影还是共同创作”可以显示为后续待讨论方向，不提前要求作答。用户选定交流后，Agent 再提出下一轮相关问题。缺少场地事实时出现“场地资料待查”的研究入口；对现场气氛没把握时打开一个开场小样，用户体验后回到原问题。

每条已确认回答都能点回原话，用户也能在原处修改。一个选项被选中，不意味着创建一个 GitHub issue；一个问题变得值得独立探索时，才沿用已确定的 tracker 登记方式进入整体地图。尚未形成票据的问答继续由 Pi 会话承载，展示数据不成为另一份正式票据。

适合先试的能力只有：**比较、回答、反对前提、等待事实、看小样、修改已确认答案**。它们能改善理清想法和保持方向。可玩性应来自用户真的能改变方案，并看见影响；不需要收集卡牌、完成题数或人为升级节点。

验证时观察：用户能否解释这轮为何讨论这些问题；改一个前提后是否知道哪些结论需要再看；从研究/小样返回后是否无需复述；汇总是否保留用户原来的明确要求。只验证“卡片可拖动”不足以支持这个方向。

## 另两项跨流程边界

- **交接不是每次换阶段都开新窗。** handoff 针对工作要移动或分出去的情形；已落盘产物通过引用传递。文章还报告临时文件会消失、未验证推测在摘要中变成事实的问题。产品推导：返回入口应关联可持续读取的产物与来源讨论，分别呈现结论和未核对项；当前有效会话优先继续。[Handoff](https://www.aihero.dev/skills-handoff#what-travels-and-what-doesnt)、[FAQ](https://www.aihero.dev/skills-handoff#common-questions)
- **让文档服务理解。** domain-modeling 要澄清概念、保持词汇表精简；未经用户理解的术语和膨胀的 CONTEXT 都可能误导后续。产品推导：术语需要时就地解释，并可回看双方确认的含义；不强制创意用户学习工程术语，也不把问答卡片批量塞入 CONTEXT。[Domain-modeling](https://www.aihero.dev/skills-domain-modeling#two-artifacts-two-bars)、[FAQ](https://www.aihero.dev/skills-domain-modeling#common-questions)

## 阅读覆盖与限制

已逐篇读取下列 **10 篇文章的全部工作流正文**，包括适用情境、正文机制、Common questions、It's working if、Where it fits；不是只读搜索摘要。页面显示更新日期均为 2026-08-24，访问日期为 2026-09-09。

- [wayfinder](https://www.aihero.dev/skills-wayfinder)
- [grilling](https://www.aihero.dev/skills-grilling)
- [grill-me](https://www.aihero.dev/skills-grill-me)
- [grill-with-docs](https://www.aihero.dev/skills-grill-with-docs)
- [ask-matt](https://www.aihero.dev/skills-ask-matt)
- [to-spec](https://www.aihero.dev/skills-to-spec)
- [domain-modeling](https://www.aihero.dev/skills-domain-modeling)
- [prototype](https://www.aihero.dev/skills-prototype)
- [handoff](https://www.aihero.dev/skills-handoff)
- [research](https://www.aihero.dev/skills-research)

另对照本机 grilling 全文、Wayfinder 的票据/地图核心段落与 ask-matt 的主流程。文章是作者建议和文章中报告的第一方来源；具体运行以实际加载的 SKILL.md 为准。研究文章将部分自动研究分支行为标为 v1.1 之后未发布变化，不能推断用户安装版必然具备。

没有通读其他技能文章、相关视频及所有链接 issue，未确认那些问题今天是否仍可复现；不是 Matt 全站或整个技能集合的全面审计。本次不替用户升级 skill、不修改产品已接受决策、不实现 UI。
