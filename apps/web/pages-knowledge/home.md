# 首页 / 仪表盘

- pageId：`home`
- 路由：`/`（Lighthouse 对应 `/app/`；本地实现尚未重新部署）
- 权限：登录
- 用途：汇总当前用户的素材、空间、足迹和旅行概况，提供上传与各业务页面入口。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `home.header` | 顶部 | 文件名称搜索、上传素材 |
| `home.nav` | PC 侧栏 / H5 底栏 | PC 与文件页共用首页、全部文件、足迹地图、旅行、我的分享、回收站菜单；H5 共用首页、文件、上传、我的底栏；足迹/旅行/回收站禁用 |
| `home.welcome` | 主区顶部 | 当前日期、当前用户昵称、欢迎文案与首次上传入口 |
| `home.onboarding` | 已确认为零文件时 | 首次上传引导，不显示编造的统计 |
| `home.overview` | 欢迎区之后 | 已入库素材数、真实用量；足迹/旅行准备中 |
| `home.footprint` | 内容区 | 足迹处理未就绪的明确提示，不显示假地图 |
| `home.storage` | 内容区 | 已用空间与类型分布，配额尚未启用 |
| `home.recentFiles` | 内容区 | 最近四个真实文件，按需获取私有图片访问链接 |
| `home.recentTrips` | 内容区 | 旅行处理未就绪的明确提示 |
| `home.profile` | PC 侧栏 / H5 我的 | 当前用户与账号设置入口 |
| `home.preview` | 弹层 | 私有素材预览/下载；签名 URL 隐藏于 Agent 快照之外 |

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `nav.home.brand`、`nav.home`、`nav.mobile.home` | 链接 | 回到首页 | 无 | 否 |
| `nav.files`、`nav.mobile.files`、`home.recentFiles.all` | 链接 | 打开文件页 | 无 | 否 |
| `nav.map`、`nav.trips`、`nav.trash` | 禁用按钮 | 足迹/旅行/回收站待实现，不能误跳转 | 无 | 否 |
| `nav.shares` | 链接 | 打开我的分享管理页 | 无 | 否 |
| `home.header.search`、`home.header.searchSubmit` | 输入/提交 | 用文件或文件夹名称搜索并跳转到文件页 | query | 否 |
| `home.header.upload`、`home.hero.upload`、`home.welcome.upload`、`home.onboarding.upload`、`nav.mobile.upload` | 链接 | 进入已有上传页 | 无 | 否 |
| `nav.account`、`nav.mobile.account` | 链接 | 账号设置 | 无 | 否 |
| `home.storage.viewFiles` | 链接 | 查看已入库文件 | 无 | 否 |
| `home.recentFiles.open.{nodeId}` | 按钮 | 按需预览真实最近文件 | nodeId | 否 |
| `home.preview.close`、`home.preview.download` | 按钮 | 关闭弹层/重新签名下载原片 | nodeId | 否 |
| `home.summary.retry` | 按钮 | 整页请求失败时重新拉取汇总 | 无 | 否 |
| `tool: homeApi.summary` | 服务 | 按登录用户获取首页各模块汇总数据 | recentLimit | 否 |
| `tool: nodesApi.access` | 服务 | 根据当前用户权限签署缩略图/原片预览/下载地址 | nodeId, purpose | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 当前用户 | 昵称、邮箱、角色 | `GET /api/v1/auth/me` |
| 各模块 `ready` | 显示当前用户已入库活动文件的真实数据 | `GET /api/v1/home/summary`（后端已上线；前端待发布） |
| 各模块 `empty` | 数据能力已实现且当前用户确实无数据；计数为 0 | 汇总 API 模块状态 |
| 各模块 `not_ready` | 后端能力/数据源尚未实现；显示“准备中”，不把未知计数当 0 | 汇总 API 模块状态 |
| 各模块 `unavailable` | 暂时获取失败；显示局部错误与重试 | 汇总 API 模块状态 |

## 跳转

- 未登录访问 `/` 会转到 `/login`；成功登录后保留并返回原受保护路径。
- 可前往：文件、我的分享、上传、账号设置；足迹地图、旅行列表和回收站仍禁用。
- 登录用户访问 `/login` 或 `/register` 会转到 `/`。

## 特殊说明

- 首页不请求完整县界/轨迹几何；地图操作在独立地图页。
- 汇总 API 只返回当前用户的数据，不暴露 COS Key、对象存储内部 key 或长期访问 URL。
- 短期签名 URL 仅在需要展示对应私有素材时提供；首页缩略图数量应限制。
- 数据空状态与后端能力未就绪是不同状态，不能用同一个零值表达。
- 正式页视觉已对齐确认的简约设计稿：白底留白、细边框、低饱和绿和山景相纸；相纸纯 CSS 装饰，绝不代表真实用户图片。设计原型 `design/home.html` 的示例数据是虚构的，地图是示意插画、不是行政边界数据；正式页仍按实际 API 显示真实统计和“准备中”状态。
- 当前本地 `/` 为 React 首页，`/settings/account` 为账号页；首页汇总与缩略图签名后端已在 Lighthouse 上线，前端新版本待通过 Makers 部署。图片不超过 2 MiB 时卡片可按需使用签名原图；2–30 MiB 的缩略图需经云端 CI 验收并启用 `COS_IMAGE_PROCESSING_ENABLED` 才能显示，失败回退图标，绝不回退加载大原图。
