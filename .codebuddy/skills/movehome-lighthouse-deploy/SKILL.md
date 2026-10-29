---
name: movehome-lighthouse-deploy
description: This skill should be used when a user asks to deploy, release, verify, or roll back the movehome project's Fastify API or Vite frontends on Tencent Lighthouse, including the /app main site and share.convenience.top. It guides scoped packaging, backup, canary checks, atomic switching, validation, and rollback without touching unrelated sites.
---

# 迹光 Lighthouse 发布

以当前工作区源码向已存在的 Lighthouse 服务器发布迹光，不创建新实例、不顺带发布其他网站。先读 `references/targets.md`；其中信息是历史记录，**每次发布均须只读核对实际配置**。

## 入口与边界

1. 仅在用户明确要求**实际发布/回滚**时操作远端；询问方案、检查状态或编写 Skill 时不发布。发布请求未说明 `API`、主站 `/app/`、分享站还是组合时，先确认范围；不要默认发布全部。记录目标、工作区来源（含未提交改动）、构建参数和回滚点。
2. Lighthouse 未连接时先调用 `invoke_integration(id="lighthouse", type="deploy")`；每次调用集成工具前，先用 `search_integration_tool` 按名称取得输入 schema。使用 `describe_running_instances` 确认目标实例，`deploy_project_preparation` 上传白名单文件夹，`execute_command` 运行**经过审阅**的远端命令；遇到异步任务用 `describe_command_tasks` 查状态。命令最大 2048 字符，按步骤拆分并逐条核对退出状态。
3. 不假设本机有服务器 SSH；不要在 Lighthouse 上 `git clone` GitHub（历史上会挂起），不要从 Cloud Studio 兜底部署或借第三方站点传包。优先使用 Lighthouse 上传工具，并依据**工具实际返回的远端路径**定位上传物。传输不可用时停止并说明，不猜测路径。
4. 禁止把 `.env`、令牌、数据库凭据、Mongo 导出、私有文件、`node_modules`、`.git` 或本地记忆打包上传；不得打印/记录环境变量值。保留服务器原 `/opt/movehome/api.env` 及其权限。不要修改 `convenience.top` 主站、其他 nginx 虚拟主机、证书、防火墙或数据库，除非用户明确要求且有独立验证/回滚方案。
5. 若本轮涉及手机免登录扫码上传，检查 COS STS 已签凭证可在撤销后覆写同 Key 对象的已知风险；**风险未修复时停止上线**，不要用“用户接受风险”代替技术修复。其他已知高危漏洞、缺失 COS CORS 或未经验证的迁移同样阻断相关发布。

## 1. 确认范围与预检

- 读取 `git status`、相关 diff、项目文档和 `apps/api/package.json` / `apps/web/package.json`。问清是否包括未提交和未跟踪文件；不能将仅 `git HEAD` 当作当前工作区，更不能静默遗漏新增路由或资产。不要擅自提交、推送或重置 Git。
- 只读查看目标实例 ID/地域、Node 版本、`systemctl` 单元、nginx 站点及 `/app/` alias/SPA 回退、当前目录真实路径、磁盘/内存和备份余量；证实健康检查及旧站状态。只检查配置文件路径/权限和需要的**非敏感键名**，禁止回显 `api.env` 内容。实例或路径与参考记录不符即停止核实。
- 核对 API/前端契约、是否需新 CORS Origin/COS 桶规则、是否有数据库迁移、PWA/SW/manifest 的缓存要求及静态深链接回退。不要将未完成的真实账号/手机直传验收说成已通过；功能有阻断风险先修再部署。

## 2. 构建与打包（仅选择的范围）

- API：在本地 `apps/api` 运行 `npm test`；仅将 `src/`、`package.json`、`package-lock.json` 等启动/测试必需文件复制到工作区内隔离的**临时白名单目录**。检查该目录树没有 `.env`、密钥、软链或多余文件后才将绝对路径交给 `deploy_project_preparation`。远端在独立 staging 目录执行 `npm ci`、`npm test`、`node --check`（按需），不要覆盖运行中服务。
- 主站：在 `apps/web` 跑测试/类型检查，以 `VITE_APP_BASE=/app/` 构建，完整保存 `dist/` 快照。分享站：独立以 `VITE_APP_BASE=/` 构建，默认保持分享站 PWA 关闭，另存**另一份完整** `dist/`；不能用第二次构建覆盖第一次待发布产物。按需显式配置 `VITE_API_BASE_URL=https://api.convenience.top`。仅把所选站点快照交给上传工具。
- 静态产物必须完整包含路由懒加载分片、`assets/`、图标、manifest 和主站 SW；不只上传 `index.html` 或它直接引用的文件。保留旧版本资源满足未刷新的浏览器/PWA 客户端，核对 nginx 对 `index.html`、SW、manifest 的禁缓存与 SPA 回退。不要在分享站意外启用主站 PWA。

## 3. 服务器暂存、验证、切换

- 在远端**另建**唯一的暂存/备份目录；确认磁盘足够，再备份将要替换的 API 或站点目录，保留清晰的原目录回滚映射。不动其他目录；不删除旧备份。敏感 env 仅在确实需要改变配置且获授权时，于服务器内备份并保持原权限，绝不上传本地 env。
- API 先在独立 staging 上安装依赖和测试；参考现有 systemd 单元、安全地引用原环境文件，在仅监听 `127.0.0.1:3011` 的预启动实例做 `/health` 检查，绝不把 3011 对公网开放。不能安全预启动时说明未验证项，不假报成功。切换前确认接口向后兼容前端；仅在验证通过后替换稳定 API 目录并重启既有 `movehome-api`，检查 `systemctl`、本机 3001 与公网 `https://api.convenience.top/health`。
- 多组件按兼容性规划顺序：通常先 API 后主站/分享站，但不假定兼容；逐个站点备份、切换完整产物，必要时 `nginx -t` 后才 reload。严格核实 `/app/` 和分享站的独立根目录；不要覆盖 `convenience.top`。服务启动/切换失败应先定位错误并使用该组件旧目录回滚，不继续发下一个组件。
- 不直接把环境或签名 COS URL 写进日志和回执；远端操作涉及不可逆删除、修改数据库、变更 nginx/证书、防火墙或销毁备份时先单独取得用户明确授权。

## 4. 验收与回滚

- API：`/health` 为 200；匿名受保护接口仍为 401；按变更范围核对相关公开接口和日志（仅摘取非敏感错误）。前端：主站 `/app/` 与所改深链接、分享站根路径与所改深链接及 JS/CSS 懒加载资源正常，无意外 PWA 缓存；检查另一站点仍可访问。
- 需要真实账号、私有 COS 或手机扫码/相册的验收时，由用户自行登录并使用授权样本；不能读取用户私有文件或制造真实数据测试。区分“自动检查通过”“真实用户流程待验收”。
- 有问题则停止后续切换；若可回滚，恢复该组件的旧目录并重启/校验健康，再核对新旧契约是否兼容；涉及迁移或新旧版本不兼容时不可盲目回滚，明确告知用户。
- 报告发布范围、产物来源、实际服务器实例、备份位置、各项验收结果、未验证项和回滚状态。**创建或修改本 Skill 本身不触发任何部署。**
