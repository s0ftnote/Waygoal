# Spec #1 实现票

父规格：https://github.com/s0ftnote/Waygoal/issues/1。10 张票已发布并远端核验正文、ready-for-agent 标签及原生阻塞关系；父规格未修改。

| 草案 | GitHub 实现票 | 被哪些票阻塞 |
| --- | --- | --- |
| T1 | [#2 从普通工作目录开始真实会话画布](https://github.com/s0ftnote/Waygoal/issues/2) | 无 |
| T2 | [#3 真实分叉、只读回看与明确继续](https://github.com/s0ftnote/Waygoal/issues/3) | #2 |
| T3 | [#4 切换工作区与创建多张画布](https://github.com/s0ftnote/Waygoal/issues/4) | #2 |
| T4 | [#5 通过标题和位置找回讨论](https://github.com/s0ftnote/Waygoal/issues/5) | #2 |
| T5 | [#6 手动分组和关联想法](https://github.com/s0ftnote/Waygoal/issues/6) | #2 |
| T6 | [#7 本地票据从来源进入画布](https://github.com/s0ftnote/Waygoal/issues/7) | #2 |
| T7 | [#8 从票据开始、分叉和继续讨论](https://github.com/s0ftnote/Waygoal/issues/8) | #3, #7 |
| T8 | [#9 依赖变动与下游解锁可见](https://github.com/s0ftnote/Waygoal/issues/9) | #7 |
| T9 | [#10 远程原文也走同一票据入口](https://github.com/s0ftnote/Waygoal/issues/10) | #7 |
| T10 | [#11 从地图结论回到讨论与产物](https://github.com/s0ftnote/Waygoal/issues/11) | #8 |

推荐执行顺序：#2 → #3 → #7 → #8 → #9 → #5 → #4 → #6 → #11 → #10。这是优先级建议，不是新增阻塞边。

2026-09-11 本地接手核对：#2–#11 均已有代码和对应浏览器检查脚本。上面的顺序保留拆票时的依赖关系；当前应从回归与体验验收继续，而不是重新从 #2 开始。此处记录本地实现状态，不代替 GitHub 票据状态或用户验收。验证入口见[开发指南](../development.md)。

50 条用户故事均有票覆盖，依赖无环。draft.json 保留覆盖映射；编号 Markdown 为已发布正文；publication.json 保存真实编号、来源 ID 与验证结果；review-disposition.md 记录审查后的取舍。
