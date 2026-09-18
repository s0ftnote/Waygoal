# 探索接入 Review 与竞态修复

范围：相对 `5ebcd98c1dd1ce85f9df7cb246be6cabc702b42d` 的探索相关未提交改动。排除用户原有的聊天 padding、欢迎区显隐和 resize 样式改动。Standards 与 Spec 独立审查，之后以真实 Pi 会话、受控模型和浏览器请求故障注入复现；没有使用用户实际会话。

## Standards

| 级别 | 复现的问题 | 修复 |
| --- | --- | --- |
| P2 | 托盘回源读取迟到，覆盖用户已经进行的键盘导航，重新打开预览并拉回视口 | 新的 pointer、keyboard、wheel 意图取消读取及尚未执行的定位 |
| P2 | 批量材料迟到时抢走探索提问框焦点，后续文字进入主输入框 | 捕获发起时的焦点所有者；焦点已改变时只加入材料，不关闭预览或聚焦 |
| P2 | 流式选文浮层的 Escape 先到达主输入框，意外发出 abort | 浮层在 capture 阶段处理 Escape；未保存回答及运行中会话均不提供分叉入口 |

## Spec

| 级别 | 复现的问题 | 修复 |
| --- | --- | --- |
| P1 | 分叉创建请求迟到，把用户拉回已离开的画布；旧分叉忙碌态还会禁用新会话输入 | 延续操作与画布读取绑定版本、作用域；离开后只注册分叉并保留问题，不导航或自动发送，旧忙碌态不带入新面板 |
| P2 | Pi 已创建分叉，但载入失败后重试又创建一份 | 保留已创建 ID，当前页面重试只重做注册／载入；进入该分叉后结束重试缓存 |
| P2 | 向旧画布 PATCH 注册分叉，悄悄改写工作区的当前画布 | PATCH 使用不激活画布的 `resolveScope`；GET 显式打开与记忆行为保留 |
| P2 | 用户提前打开新分叉并写字后，迟到恢复只更新 draft store，界面不出现探索问题；继续输入会覆盖它 | 使用宿主按目标草稿恢复接口，同时更新已挂载输入与缓存，合并新输入；不抢焦点 |

七项均有先失败、后通过的回归证据。旧“迟到发送清空主线材料”的实例级消耗保护仍保留。第二次独立静态复核未发现上述最后两项修复的确凿高优先回归。

## 可重跑的验证

使用 Node.js 24.21.0，浏览器在独立副本运行，避免与用户 30142 服务争用 `.next`：

```sh
# 仓库根目录；不让宿主默认配置测试继承 Waygoal 开关
env -u WAYGOAL npm run check

# 在无活动开发服务的独立副本内
npm run test:waygoal-review
npm run test:waygoal-exploration
npm run test:waygoal-branches
npm run test:waygoal-workspaces
```

- `test:waygoal-review` 的五案为 `locate`、`focus`、`fork-leave`、`fork-retry`、`fork-open`。可用 `WAYGOAL_REVIEW_CASE` 单独重跑；请求先到达真实服务，随后在浏览器侧延迟响应或注入载入失败，不以假分叉替代 Pi。
- PATCH 回归直接调用真实 route，检查会话归属、来源和 workspace.current，另测未知画布拒绝及 GET 的原行为。
- 流式选文测试让模型已经输出文字但尚未结束，验证选区不能错误绑定上一条回答、Escape 不发送 abort。
- 默认忽略的证据目录为 `apps/web/test-results/waygoal/review-*/`、`exploration/`、`turns/`、`workspaces/`。具体通过数量及构建结果见[接入验证记录](exploration-integration-results.md)。

## 边界

本轮没有继续叠加正文搜索或跨刷新草稿保存。恢复与分叉重试缓存仍只在当前页面内；尚未拿到创建结果时的网络中断不等于服务端幂等分叉协议。也未扩展处理跨进程写入竞争、所有迟到 GET 的服务端定位副作用或完整 14 组浏览器套件。受控模型验收不代表真实模型、工具副作用或真机触屏验收。
