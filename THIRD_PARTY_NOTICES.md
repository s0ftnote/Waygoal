# 第三方来源

Waygoal 的 Web 应用基于 [agegr/pi-web](https://github.com/agegr/pi-web) 演进，当前由 Waygoal 独立维护、组织和发布。源代码迁移不改变上游代码的 MIT 授权，原版权与许可全文保留在 [LICENSE](LICENSE)。

Pi Agent 能力继续通过 `@earendil-works/pi-*` npm 包使用，版本及其他依赖见 `package.json` 和 `package-lock.json`，各依赖遵循其自身许可证。

上游 README 和领域说明归档在 [docs/upstream/pi-web](docs/upstream/pi-web/README.md)，其中安装、目录、端口和发布说明是上游历史资料。当前 Waygoal 的使用及开发入口以根目录 README 和 docs/development.md 为准。

为兼容已有会话和配置，部分 `pi-web:*` 存储键、Pi 自定义消息类型及 `PI_WEB_*` 环境变量保留原名；这些标识不是另一套应用包。
