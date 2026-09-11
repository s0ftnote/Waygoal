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
| `npm run test:e2e` | 顺序执行全部 10 组 Waygoal 浏览器检查 |
| `npm run build` / `npm start` | 构建并启动生产宿主，使用同一 Waygoal 入口 |
| `npm run prototype:canvas` | 在 30145 端口查看独立静态交互原型 |

`lint`、`typecheck`、`test` 也可从根目录单独运行。生产构建和开发服务共用 `.next`，运行 `build` 或浏览器套件前应先停止该 checkout 的开发服务；浏览器套件之间也需串行。

完整单元测试包含宿主终端检查，因此安装时保留原生依赖的安装脚本。终端依赖的修复方式见 `apps/web/docs/terminal.md`。

## 浏览器验证

首次运行前，在 `apps/web` 下执行 `npx playwright install chromium`，也可以使用本机已有 Google Chrome。测试自行启动临时宿主、临时 Pi 数据目录和可控的假模型；远程票据使用已保存的只读结果，不访问外部平台。

全部检查覆盖：基础会话画布、分叉与回看、本地票据、票据讨论、依赖变动、查找改名、工作区与多画布、分组关联、地图结论、远程来源。单独复跑例如：

```sh
npm --prefix apps/web run test:waygoal-branches
```

新截图和 `checks.json` 默认位于 `apps/web/test-results/waygoal/<套件>/`，宿主日志位于 `apps/web/test-results/e2e/`。这些目录被 Git 忽略，日常复跑不会覆盖研究证据。

确需刷新保留证据时，从仓库根目录显式指定目标，再检查生成的差异：

```sh
WAYGOAL_EVIDENCE_DIR="$PWD/docs/research/prototype-evidence" npm run test:e2e
```

基础会话套件保留一段受控的慢缩放动画，等待动画结束后同帧读取节点相对位置，并核对保存坐标和缩放值。这样可以区分画布记录丢失与动画中途采样。

CI 使用同一套根目录命令，执行静态检查、单元测试、生产构建和 Waygoal 浏览器回归；失败时上传测试输出。自动检查通过表示这些行为获得回归覆盖，视觉品质、分支带结论返回及真实使用体验仍需按设计文档验收。
