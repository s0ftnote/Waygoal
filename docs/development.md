# 开发与验证

Waygoal 当前通过 pi-web 宿主中的 Pi extension 接入。目录整理的目的，是让画布交互、来源记录和宿主能力容易定位，便于持续验证“分叉 → 深入 → 返回”。目前没有独立可安装的 Waygoal extension 包。

## 目录职责

```text
apps/web/
  app/waygoal/              画布页面与样式
  app/api/waygoal/          画布、真实路径与来源刷新接口
  components/waygoal/       画布、查找、路径、票据面板等界面
  lib/waygoal/              画布记录、工作区、票据、分支投影、Pi extension
  e2e/waygoal*.mjs          隔离 Pi 数据与假模型的浏览器检查
  experiments/             独立的历史交互和接入实验
  components/、lib/、hooks/  复用的 pi-web 宿主代码
docs/
  adr/                     已作出的决定及理由
  design/                  交互设计、视觉与体验验收
  spec/                    规格底稿与实现票清单
  research/                研究、历史试跑记录与保留证据
.github/workflows/         当前仓库的 CI
```

`lib/waygoal` 中，`store` 和 `workspaces` 保存画布及工作区记录，`tickets` 和 `remote-store` 读取来源，`branches` 与 `tree` 投影 Pi 的真实路径，`extension` 提供技能反馈和远程票据交付入口。测试与对应模块放在一起。

Waygoal 直接复用宿主的聊天组件、会话读取和运行能力。目录变更不改变 Pi 会话身份、画布记录格式或用户数据路径。`apps/web/docs` 与其多语言 README 是保留的宿主资料；Waygoal 的产品说明以根目录 README、CONTEXT 和 `docs/` 为准。

## 根目录命令

使用 Node.js 24。依赖和锁文件仍归 `apps/web` 管理，根目录负责统一入口。

| 命令 | 用途 |
| --- | --- |
| `npm run setup` | 按应用锁文件安装依赖，运行依赖与宿主的安装脚本 |
| `npm run dev` | 在 `127.0.0.1:30142/waygoal` 启动开发服务 |
| `npm run check` | 顺序运行 lint、类型检查及全部单元测试 |
| `npm run test:e2e` | 顺序执行全部 15 组 Waygoal 浏览器检查 |
| `npm run build` / `npm start` | 构建并启动生产宿主，使用同一 Waygoal 入口 |
| `npm run prototype:canvas` | 在 30145 端口查看独立静态交互原型 |

`lint`、`typecheck`、`test` 也可从根目录单独运行。生产构建和开发服务共用 `.next`，运行 `build` 或浏览器套件前应先停止该 checkout 的开发服务；浏览器套件之间也需串行。

完整单元测试包含宿主终端检查，因此安装时保留原生依赖的安装脚本。终端依赖的修复方式见 `apps/web/docs/terminal.md`。

## 浏览器验证

首次运行前，在 `apps/web` 下执行 `npx playwright install chromium`，也可以使用本机已有 Google Chrome。测试自行启动临时宿主、临时 Pi 数据目录和可控的假模型；远程票据使用已保存的只读结果，不访问外部平台。

全部检查覆盖：基础会话画布、连续聊天与轮次双向定位、分叉与回看、本地票据、票据讨论、依赖变动、查找改名、工作区与多画布、分组关联、地图结论、远程来源。单独复跑例如：

```sh
npm --prefix apps/web run test:waygoal-branches
```

分支套件已按连续聊天基线更新，包含材料快照与真实发送、草稿往返、运行中定位和长历史分页；其证据目录为 `turns/`。

新截图和 `checks.json` 默认位于 `apps/web/test-results/waygoal/<套件>/`，宿主日志位于 `apps/web/test-results/e2e/`。这些目录被 Git 忽略，日常复跑不会覆盖研究证据。

确需刷新保留证据时，从仓库根目录显式指定目标，再检查生成的差异：

```sh
WAYGOAL_EVIDENCE_DIR="$PWD/docs/research/prototype-evidence" npm run test:e2e
```

基础会话套件保留一段受控的慢缩放动画，等待动画结束后同帧读取节点相对位置，并核对保存坐标和缩放值。这样可以区分画布记录丢失与动画中途采样。套件还调用 `waygoal-motion.mjs`，暂停实际镜头转场后抓取画布，核对从可见位置接手、跟手平移，以及滚轮、键盘与减少动态效果下的即时响应。

CI 使用同一套根目录命令，执行静态检查、单元测试、生产构建和 Waygoal 浏览器回归；失败时上传测试输出。自动检查通过表示这些行为获得回归覆盖，视觉品质、分支带结论返回及真实使用体验仍需按设计文档验收。

共同轮次投影位于 `lib/waygoal/turn-board.ts`，只读加载与画布交互在 `components/waygoal/TurnCanvas.tsx`。分支套件同时检查跨会话关系、引用快照及共同布局保存；共享前缀仅是展示投影，真实身份与 Pi 上下文保持分离。

所得与语义缩放检查使用 `npm --prefix apps/web run test:waygoal-takeaways`，覆盖主动提炼、人工确认、保存失败保留文字、重载、缩放定位及 Pi 历史和草稿不变。证据目录为 `semantic/`。

同源分支检查使用 `npm --prefix apps/web run test:waygoal-sibling-forks`，覆盖来源不在画布时共享历史、无新轮次的分叉落点，以及卡片与消息按钮包含所选消息的分叉边界。证据位于 `sibling-forks/`。

分支和所得套件还通过 `waygoal-feedback.mjs` 记录浏览器实际执行的 Web Animations，核对反馈出现在引用、真实分叉和人工确认成功之后；同时检查键盘收拢、减少动态效果、退出残影清理、保存失败与历史恢复不误播。记录仅用于测试，不进入产品页面。

探索与综合检查使用 `npm --prefix apps/web run test:waygoal-exploration`，覆盖选文分叉、取消与发送失败恢复、材料托盘只读回源、多选批量材料、失败和迟到响应隔离，以及真实 Pi 发送后的来源快照。桌面与窄屏截图、`checks.json` 位于 `exploration/`。同样要求没有活动开发服务；可在独立副本中验证，避免中断用户工作。

探索竞态回归使用 `npm --prefix apps/web run test:waygoal-review`，对真实读取／分叉结果注入延迟或落地失败，验证回源不覆盖新导航、材料不抢输入焦点、离开画布后不自动跳回或发送、提前打开新分叉时合并恢复问题，以及重试不重复分叉。`WAYGOAL_REVIEW_CASE=locate|focus|fork-leave|fork-retry|fork-open` 可单独选一案；证据写入 `review-<案名>/`。

分叉来源回归使用 `npm --prefix apps/web run test:waygoal-rename-lineage`，覆盖真实 HTTP 分叉重试、名称元数据挂接、20 次 UI 改名、草稿和内容历史不变，以及刷新／服务重启后的世界坐标恢复。证据位于 `rename-lineage/`。

### 分叉来源与恢复

真实来源保存在 Pi agent 目录下的 `waygoal/lineage/`，不随会话移入其他画布而改变。`fork-service` 使用固定操作 ID、独立暂存目录和阶段记录；来源保存后才发布子会话，重试返回同一会话，读取画布时恢复未完成操作。Pi JSONL 格式与会话 ID 保持不变。

旧画布来源通过 `lineage-migration` 核对真实父链及复制内容；可验证记录先备份到 `waygoal/lineage-backup-v1/` 再迁移，不改旧坐标。不能验证或相互冲突的来源保持旧记录，不猜测精确边界。`migrateLegacyOrigins(sessions, false)` 提供只读预检。

`entry-index` 负责完整 entry 到卡片的定位；显示轮次按固定分叉边界切分，名字元数据不创造内容分叉。材料读取使用相同切分边界。命名通过 `session-access` 使用当前会话实例，自动名称应用前检查名称版本。

### 长会话性能

轮次读取只加载展开的会话、当前聊天和它们的分叉家族。条件请求在历史未变时返回 304，保留已有前端对象；离开的会话数据会释放。画布卡片只传有限长度的预览，引用材料和提炼所得仍读取完整原文。

总览缓存分支数与当前叶节点，不缓存全部历史树。完整树和卡片投影各自有条目数及容量上限；画布轮询等待上次读取完成后再继续，隐藏页面暂停轮询。对应回归见 `tree.test.mjs`、`turn-reader.test.mjs`、`turn-loading.test.mjs`。
