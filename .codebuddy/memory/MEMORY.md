# movehome 长期记忆

## 项目
- 为旅游博主做的个人网盘 + 足迹地图网站（替代大疆云盘）。第一版仅网页、仅国内、先不做多博主/收费，但账号系统完整。
- 仓库：/Users/bughou/Desktop/console/movehome，方案文档 docs/需求与技术方案.md，页面目录 docs/前端页面目录.md，首页接口契约 docs/首页接口契约.md，后端 apps/api，前端 apps/web（认证/账号/上传/文件管理/首页已在本地实现）。2026-10-28 Lighthouse 后端现已发布首页、分享、私有签名 URL、手动定位、上传时可选 EXIF/SRT 位置入库及下载文件名修复；签名缩略图处理仍默认关闭。最新前端改动未随此次后端发布，真实用户图片和定位保存仍待本人登录验收。

## 技术选型
- 前端：Vite 8 + React 18（Arco 需 React≤18）+ TypeScript 5.9 + Tailwind v4 + Arco Design + react-router-dom 7；2026-10-28 核实 `convenience.top` 当前是另一站点，旧“前端已部署 Makers/域名 convenience.top”记录不实，故在 Lighthouse 通过 `https://api.convenience.top/app/` 独立子路径发布，不覆盖主站。样式层顺序 theme/base/components/utilities，Arco CSS 放 components 层、不引入 Tailwind preflight，保证工具类能覆盖 Arco。路径别名 @ → src；环境变量统一从 src/config/env.ts 读取（VITE_API_BASE_URL、VITE_TENCENT_MAP_KEY）。
- 前端流程约定：用户先设计页面，确认后才实现对应的前端业务；本阶段已确认登录页设计，可继续后续素材/地图页面，但需按功能分步推进。
- 品牌与登录稿：用户认可暂定品牌名「迹光」及登录稿，选定 Logo C「行迹」（虚线路径汇入定位点），位于 design/assets/logo.svg；用户后续自行替换图片素材。正式 PC/H5 认证页已在 apps/web 实现，剩余素材/地图业务页待设计与开发。首页静态稿需保持 PC 最近素材/最近旅行卡片等高、动画丰富但克制，并尊重 prefers-reduced-motion。
- 后端：Node.js（Fastify 5，ESM，zod 校验，argon2id，jose JWT）；MongoDB 原生驱动；地图正式版拟用腾讯地图 JS API GL。2026-10-29 地图阶段调整：第一版仅本人已定位素材点位、回到私有预览和未定位提示，PC/H5 静态原型 `design/map.html` 已完成，`apps/api` 本地已实现本人私有分页 `GET /map/points` 和 `/map/unlocated`，后端经官方 WebService 临时将 WGS-84 转 GCJ-02；正式 `apps/web` 本地已接入登录保护的 `/map`、腾讯 JS GL 底图和私有预览回跳，均未部署。真实底图需分别配置服务端 `TENCENT_MAP_SERVER_KEY` 和前端 `VITE_TENCENT_MAP_KEY`，未以真实账号/Key 验收；县界来源/许可及坐标口径核实后再做 2dsphere 县级判定、点亮与省市县统计。
- IP 粗定位选型（2026-10-29 用户确认）：使用 EdgeOne Makers Edge Functions 的内置 GEO 信息，不再考虑部署根目录 `ipv4.ipdb` 或 `ipv4_cn.txt.zip`；目前仅确定选型，具体使用场景/入口尚待确认，未实现或部署。IP 归属地不能替代素材 EXIF/SRT/GPS 精确坐标。
- 认证接口：`/api/v1/auth/{register,login,refresh,logout,change-password,me}`，另加 `PATCH /auth/handle` 设置全站唯一、可修改的公开用户名（旧别名保留，内部 Mongo `_id`/JWT `sub`/COS 路径不变）。
- 分享与展示型活动页（2026-10-28 后端与分享域名已部署；本地新版前端未随本轮发布）：只做展示，不接受访客投稿；公开链接采用固定 `share.convenience.top/{公开用户名}/{自定义路径}`，不用 `{用户名}.convenience.top`；下载限额按“签发下载链接次数”计数，不等于真实下载完成次数。数据集合 `shares` 与 `handles`；公开接口为 `POST /public/shares/:handle/:slug/browse` 和 `/files/:nodeId/access`；每次签发都按当前父链重新判定分享范围，撤销不能立即收回已签发链接。DNS、证书与 nginx SPA 回退均已配置；主站 `/app/` 与分享域名分别用 `VITE_APP_BASE=/app/` 与 `/` 构建；细节见 `docs/分享域名部署.md`。勾选“必须登录”的分享在分享域名上会因跨站 Cookie（SameSite=Lax）无法携带会话，这类分享改用提取码。
- 含分享的后端（052651e）与主站 `/app/` 前端已于 2026-10-28 部署；备份 `/opt/movehome/api-previous-20261028-share`、`api.env.previous-20261028-share`、`/opt/movehome/www-app-previous-20261028-share`。部署通道经验：服务器 `git clone` GitHub 会挂住，改用 codeload 的 tar.gz；本机无 SSH 权限，只能用 Lighthouse 集成 `execute_command`；前端产物可用 Cloud Studio 沙箱预览 URL 作中转由服务器 curl 下载。
- 分享域名已上线（2026-10-28 部署）：`share.convenience.top` 证书由 certbot webroot 管理（到期 2027-01-26，deploy-hook 同步到 `/etc/nginx/ssl/share.convenience.top.{crt,key}`）；`sites-available/movehome-share` 提供 `/var/www/movehome-share`，`try_files` 回退到 index.html；安全头写在 `location = /` 与 `location = /index.html`（`add_header` 不跨内部重定向继承）。`CORS_ORIGINS` 已含 `https://share.convenience.top`。公开分享接口已在 Lighthouse 上线；分享站点的真实账号端到端流程仍待验收。
- 服务器 nginx 现状（2026-10-28 只读核对）：`/etc/nginx/sites-enabled/movehome` 服务 `api.convenience.top`，80 端口保留 `/.well-known/acme-challenge/`（root `/var/www/html`）其余跳 HTTPS，443 反代 127.0.0.1:3001 并 include `snippets/movehome-web.conf`（`/app/` alias `/var/www/movehome-app`）。证书在 `/etc/nginx/ssl/api.convenience.top.{crt,key}`（手动管理，到期 2027-01-14），`certbot.timer` active 但无 renewal 配置。本机无法免密 SSH 到 Lighthouse，需要服务器操作时只能用 Lighthouse 集成的 `execute_command`。前端统一 API client 在 `apps/web/src/services/api.ts`，所有会话请求 `credentials: include`，Cookie 由 API 设置为 HttpOnly；受保护路由由前端路由守卫处理，后端仍每次校验认证和资源归属。
- 本地开发：Vite `/api` 代理默认目标 `https://api.convenience.top`，对生产 API 请求代设 Origin `https://convenience.top`；本地有效注册、改密、登出会影响线上账号。通过 `VITE_API_PROXY_TARGET` / `VITE_API_PROXY_ORIGIN` 可改为本地 Node API。部署 Makers 时设置 `VITE_API_BASE_URL=https://api.convenience.top`。
- 存储：腾讯云 COS，桶 test-cos-1312827847（ap-chengdu，私有），统一前缀 movehome/users/{userId}/...；视频转码用数据万象。2026-10-28 用户已绑定自定义源站域名 `assets.convenience.top`（默认源站、HTTPS 证书、强制 HTTPS、上线）；实测 DNS CNAME 指向该桶默认域名、HTTPS 证书校验通过，匿名根路径返回 403 符合私有桶预期；文件访问仍需单独验证签名 URL。
- 文件字节不经后端，浏览器直连 COS（STS 临时凭证 / 签名 URL）；预览/下载后端签名时需使用自定义域名 Host，桶保持私有。
- 2026-10-29 用户确认跨设备上传需求：电脑上传界面生成二维码，手机免登录扫码，电脑端核对配对码并确认后，手机从相册选择文件上传到电脑指定的迹光云端目录，电脑端自动显示结果；二维码不含登录凭据。本地 `apps/api` 与 `apps/web` 已实现，尚未部署/真实 COS 验收；上线前检查 COS 桶 CORS，且要处理已签发 COS STS 在授权撤销后仍可覆写同 Key 文件的风险（考虑隔离上传暂存区并服务端转存或版本化）。2026-10-29 因完成本地实现而更新状态。
- 2026-10-29 新的文本便签/跨设备获取需求：电脑保存文字后手机获取，用户明确手机不必登录，确认沿用扫码上传的验证方向（手机显示六位配对码、电脑核对并确认），仅短时只读指定笔记；与显式创建可配置公开分享分开，扫码上传令牌不可复用为读取授权。用户进一步认可笔记与文件分享链接均可绘制二维码用于传播，二维码应只编码现有公开分享 URL，不包含正文、提取码或会话凭证；撤销/到期等现有规则继续生效。因用户后续确认，纠正此前“配对码验证方向待确认”的记录。本地 `apps/api` 已实现独立笔记私有 CRUD、手机短时扫码核码批准后仅该笔记只读、笔记公开分享创建时正文快照及删除后拒绝阅读，并新增数据索引；笔记公开分享另有可选 `maxViews` 成功正文领取次数上限，错误提取码及类型探测不计次，文件分享继续使用 `maxDownloads` 下载链接签发额度；本地后端 54/54、前端 typecheck/build/5 项媒体与 4 项导航测试均通过，均未部署/真实账号和设备验收。用户原先的登录手机同步建议不适用于扫码场景。2026-10-29 因完成本地实现和新增阅读限额更新。
- 新上传素材自动定位约定（2026-10-28 用户确认；后端位置入库已发布，前端解析与上传交互仍仅本地实现）：仅 JPEG/JPG EXIF GPS；MP4/MOV 只关联同一次选择中唯一同名主体（忽略大小写）的 DJI SRT，重名/缺失/跨批不猜测；支持方括号纬经度和 GPS(lat,lon,alt)，跳过 HOME，只取首个有效 GPS 帧，轨迹留到以后；解析失败正常上传并显示“未定位”，可手动补充。后端仅凭认证上传会话入库可选 WGS-84 元数据，重复完成不覆盖用户手动位置。具体限制和契约见 `docs/需求与技术方案.md`；本期不做存量回扫、地图和县级点亮；自动定位前端未发布，后端已发布。
- 媒体检索需求（2026-10-28 用户确认）：自建索引与检索链路，不使用 MetaInsight；原始图片/视频仍在私有普通 COS 桶，COS 向量桶可作独立向量索引候选但需核实地域（目前不支持成都）与邀测资格。需要关键词、自然语言描述、以图搜图（只找照片）、地点/时间；视频只返回整个文件，无片段定位；仅对后续新上传素材解析，不处理存量；音频首期不解析。Embedding 采用外部 API 还是自部署、视频抽帧预算与索引时效尚待用户确认。此前讨论的 MetaInsight 计价不适用该自建方案。

## 页面 Agent（规划中，2026-10-27 起）
- 方案：后端 LLM 决策，浏览器当前标签页内执行（虚拟光标+高亮+模拟点击），不用无头浏览器；标签页在后台时跳过动画直接执行。
- 约定：开发 apps/web 页面/组件必须遵守 .codebuddy/rules/web-agent-ready.mdc；页面知识库在 apps/web/pages-knowledge/（README 含埋点规范与索引，_template.md 为模板），一页一文件、覆盖式维护、不写历史。
- 埋点：data-agent-id（页面.区域.动作，列表项带业务 id）、label/desc/danger/region/ignore；业务动作抽成 stores/services 函数；路由 handle.agent.pageId 对应知识文档文件名。
- 待用户确认：LLM 厂商、面板形态、是否允许 Agent 执行危险操作、上传文件需用户自选的限制。

## 服务器（Lighthouse lhins-bunuz1ke，ap-shanghai，111.229.110.233，2核/1.9G）
- 后端：/opt/movehome/api，systemd 服务 movehome-api，监听 127.0.0.1:3001，nginx（sites-enabled/movehome）反代 api.convenience.top；前端静态文件在 `/var/www/movehome-app`，通过该域名 `/app/` 提供，未触及其它站点。证书 /etc/nginx/ssl（非 certbot，到期时间未核查）。
- 环境变量文件 /opt/movehome/api.env（ubuntu，600），含 COS/地图/Mongo/JWT 等；密钥不得写入仓库、文档、记忆、聊天回显。
- MongoDB 已启用认证；库 movehome，用户 movehome_app；管理员 mhadmin 密码在 /root/.mongo-admin。
- aishangli 已废弃并停用，备份在 /opt/backup/aishangli-20261027-1549。
- 部署方式：Lighthouse 集成上传后端源码，独立暂存并运行测试及 3011 预启动，再备份切换 systemd `movehome-api` 并验公网；保留可回滚目录。2026-10-28 最新后端 `/opt/movehome/api` 含首页汇总、分享、下载文件名修复、手动定位 API 和上传时可选 EXIF/SRT 位置入库；`COS_IMAGE_PROCESSING_ENABLED` 仍默认 false。旧版备份 `/opt/movehome/api-previous-20261028-location`、环境备份 `/opt/movehome/api.env.previous-20261028-location`（600）；本地、服务器和发布后 36/36 测试通过，公网 `/health` 200、匿名定位 GET/PATCH 与上传完成 401、缺失分享 404。未以真实账号验证上传/签名文件/位置保存。服务器 Node 20.20.2 对 `cookie@2.0.1` 提示 Node >=22，当前运行正常，后续升级并回归。现有 CORS 包含 `https://share.convenience.top`；Makers 新域名若启用需单独补后端及 COS 来源。Lighthouse 的旧前端 `/app/` 可用，本轮未发布新版前端；Makers 推荐根 `apps/web`、输出 `dist`、`VITE_APP_BASE=/ npm run build`、`npm ci`、Node 22 和同站点域 `app.convenience.top`。COS 子账号历史上读取桶 CORS 返回 403，不要假设可修改桶策略。

## 用户偏好/约定
- 2026-10-28 用户喜欢 `usehook.cn` 的简约风格，要求迹光设计稿与正式 `apps/web` 都参考白底、大留白、细边框、低饱和点缀，保留迹光旅行主题，不照搬 useHook 页面；已明确确认落地正式页面，本地代码已完成，是否发布需另行要求。
- 前端页面设计与开发希望优先评估并复用已选的 Arco Design 通用控件（选择器、菜单、弹窗、表单等），再做品牌视觉定制；特色业务组件可自定义，但需说明不用组件库的原因。2026-10-28 用户指出已安装 Arco 却未在正式页面落地，建议通过项目规则固化；尚未修改规则文件。
- 不确定时先向用户确认；用户在聊天里发过明文密钥，已多次建议轮换（待办：COS 子用户密钥与 WebServiceAPI Key 轮换）。
- 腾讯位置：server-key（WebServiceAPI，应绑服务器 IP）仅后端；web-key（公开，前端地图，需白名单 convenience.top）。
