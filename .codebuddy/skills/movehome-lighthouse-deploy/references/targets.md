# 迹光发布目标（历史记录，实际操作前只读核对）

更新参考时间：2026-10-29。此文件不是服务器当前状态，也不含凭据；以 Lighthouse 查询和远端检查结果为准。

| 范围 | 历史目标 | 验证入口 |
|---|---|---|
| Lighthouse | `lhins-bunuz1ke`，`ap-shanghai`，历史 IP `111.229.110.233` | 先查询运行中实例，确认 ID、地域、系统类型、可用空间 |
| Fastify API | `/opt/movehome/api`；systemd `movehome-api`，监听 `127.0.0.1:3001`；`/opt/movehome/api.env` 留在服务器上 | `https://api.convenience.top/health`，匿名认证接口应 401 |
| 私有主站 | 历史目录 `/var/www/movehome-app`，nginx `snippets/movehome-web.conf` 挂载 `/app/` | `https://api.convenience.top/app/` 和深链接，构建 `VITE_APP_BASE=/app/` |
| 公开分享站 | 历史目录 `/var/www/movehome-share`，独立虚拟主机 `movehome-share` | `https://share.convenience.top/` 和深链接，构建 `VITE_APP_BASE=/` |

## 容易遗漏的事实

- `convenience.top` 当前是**另一个网站**，不可覆盖。只有 `api.convenience.top/app/` 和 `share.convenience.top` 属于本项目；前端仍需分别构建和备份。
- Lighthouse 远端 GitHub `git clone` 曾长时间挂住；本机曾无免密 SSH。使用 Lighthouse 集成，查询上传工具的**实际返回路径**，不要假定能 SSH 或克隆代码。
- `apps/web` 现在含主站 PWA 与动态路由分片，两个构建的 `dist` 必须分别保存；`index.html`、SW、manifest 缓存头须现场核对。分享站不可意外启用主站 PWA。
- 生产 API 运行中的 Node 历史为 20.20.2；已有 `cookie` 依赖报告过 Node >=22 警告，部署前按当前锁文件与实际 Node 校验，而非忽略 engine。`api.env` 含敏感配置，永不回显或传回本地。
- COS 桶私有；浏览器直传要求桶对**实际上传页面 Origin** 放行跨域。历史上 COS 子账号查询桶 CORS 曾返回 403，不要宣称可以自动修改桶策略。
- 当前本地手机免登录扫码上传功能尚未部署、未经真实设备/COS 验收；单对象 STS 在撤销后仍可对同 Key 覆写。发布包含该功能时先修复/验证这个阻断问题，不能只靠路由和单测结果上线。
- `docs/分享域名部署.md` 是历史部署记录，含旧时 DNS/证书步骤和部分过时表述；每次部署只读核对 nginx、证书到期时间和路由，避免机械重演。
