# 文件管理

- pageId：`files`
- 路由：`/files/:folderId?`（Lighthouse 对应 `/app/files/:folderId?`）
- 权限：登录
- 用途：按目录浏览当前用户已登记素材，搜索、排序、上传并整理文件与文件夹。

## 页面区域

| region | 内容 |
|---|---|
| `files.nav`、`files.mobileNav` | PC 与首页共用首页、全部文件、足迹地图、旅行、我的分享、回收站菜单；H5 共用首页、文件、上传、我的底栏；足迹/旅行/回收站禁用。当前文件夹快速访问仍为文件页专属 |
| `files.header`、`files.intro` | 账号入口、上传入口与整理提示 |
| `files.breadcrumbs` | 当前目录路径与新建文件夹 |
| `files.library`、`files.toolbar`、`files.row.{nodeId}` | 搜索/排序、视图切换、分页节点与单项操作；合格图片在接近视口时显示原图预览 |
| `files.toolbar.sortOptions`、`files.row.{nodeId}.menu` | 排序选项与文件行操作菜单；浮层挂载在文件页根节点 |
| `files.dialog` | 创建/重命名/移动/软删除操作弹层 |
| `files.preview` | 文件短期签名地址预览及下载；签名 URL 所在区域 `data-agent-ignore` |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `nav.files`、`nav.mobile.files` | 回文件根目录；PC 的全部文件入口可接收站内节点拖放 | 无 | 否 |
| `nav.home.brand`、`nav.home`、`nav.mobile.home` | 打开正式首页 | 无 | 否 |
| `nav.map`、`nav.trips`、`nav.trash` | 尚未实现的目的地禁用 | 无 | 否 |
| `nav.account`、`nav.mobile.account`、`files.header.account` | 前往账号页 | 无 | 否 |
| `files.header.upload`、`files.empty.upload` | 前往上传页，当前目录作为上传目标 | `parentId` | 否 |
| `nav.mobile.upload` | 前往上传页，默认进入上传页选择的目标目录 | 无 | 否 |
| `files.path.{folderId}`、`files.nav.folder.{folderId}` | 返回目录或移动目标 | `folderId`、根目录为 `root` | 否 |
| `files.toolbar.search`、`files.toolbar.sort`、`files.toolbar.sortOption.{sort}`、`files.toolbar.grid`、`files.toolbar.list` | 搜索名称（支持 ⌘/Ctrl+K 聚焦）、展开排序并选择 `name/updated/size/created`、切换网格/列表 | 名称/排序/视图 | 否 |
| `files.toolbar.createFolder`、`files.empty.createFolder` | 新建文件夹 | 名称 | 否 |
| `files.row.{nodeId}.open` | 打开目录或申请文件预览 | `nodeId` | 否 |
| `files.row.{nodeId}.more`、`.rename`、`.move`、`.share` | 打开菜单、改名、移动，或前往 `/shares/new?targetId=...` 配置分享 | `nodeId` | 否 |
| `nav.shares` | 打开我的分享管理页 | 无 | 否 |
| `files.row.{nodeId}.delete`、`files.dialog.submit`（删除时） | 软删除文件或整棵目录到回收站 | `nodeId` | 是 |
| `files.library.loadMore`、`files.library.retry`、`files.library.goRoot` | 分页、重试、回根目录 | 无 | 否 |
| `files.dialog.name`、`.folder.{folderId}`、`.path.{folderId}`、`.loadMore`、`.submit`、`.cancel`、`.close` | 编辑/选择目标/确认或关闭弹层 | 名称、目标目录 ID | 删除时是 |
| `files.preview.download`、`files.preview.close` | 下载原片或关闭预览 | 文件 ID | 否 |
| `tool: nodesApi.list/search/detail/createFolder/rename/move/remove/access` | 页面共用的独立业务请求方法 | 用户所有的节点 ID | 删除时是 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `loading` / `error` | 列表加载中或失败；失败时不显示假空目录 | `GET /api/v1/nodes` 或 `/nodes/search` |
| `path` | 用户拥有的当前活动文件夹与祖先 | `GET /api/v1/nodes/:id` |
| `items` / `total` | 当前目录或跨目录搜索的分页结果 | `GET /api/v1/nodes`、`/nodes/search` |
| `query` / `sort` / `view` | 名称搜索/目录排序/视图；搜索结果由后端固定按名称排序 | 当前页面状态 |
| `action`、`targetPath` | 当前文件操作与移动目标目录 | 当前页面状态，目标文件夹逐级查询 |
| `preview` / `access` | 按需申请的私有链接；离开预览即清除状态 | `GET /api/v1/nodes/:id/url` |

## 跳转

- 从 `/upload` 和账号页进入 `/files`，也可直接访问 `/files/:folderId`（通过服务端核对目录祖先）。
- 前往 `/upload?parentId=...` 上传当前目录；前往 `/settings/account` 管理账号。
- 未登录访问受保护路由会跳到 `/login`，成功后返回原路径。

## 特殊说明

- 文件工作台已对齐极简设计稿的白底、细边框与深绿按钮；首页/文件共用侧栏仍保留。Arco `Select`、`Dropdown/Menu` 和 `Modal` 承载通用排序、菜单和弹层交互；排序选项、菜单项与弹层按钮均保留 Agent 埋点，菜单和弹层关闭后恢复触发按钮焦点。排序在跨目录搜索期间禁用，结果由服务端固定按名称排序。手机端控制字号与触控目标，文件卡片和站内拖放仍为专用业务视图。
- 页面绝不使用设计稿里的虚构文件、风景缩略图或示例时间；网格与列表视图只对 `ready`、JPEG/PNG/WebP/GIF、源文件不超过 30 MiB 的图片，在进入视口附近后逐项申请私有签名 URL（最多 3 个签名请求并行）。≤2 MiB 的小图使用原图，2–30 MiB 只请求固定 320px 的云端处理缩图，服务未启用/失败时回退图标，绝不下载大原图；仍需在实际 COS 桶验证 CI 后才能打开服务端开关。目录排序仅应用于目录列表；全局搜索是按文件名的固定顺序。
- 桌面主菜单与首页共用同一组件；文件页专有的当前文件夹快速访问和拖放目标保留。拖动站内节点可移动到文件夹、路径或根目录，但移动端使用“更多→移动到”；所有写入仍须经过后端归属校验。外部文件拖入不作为移动操作，应前往上传页。
- 预览地址为有效期 10 分钟的私有签名 GET URL，包含签名参数；不要写入持久化存储、日志或页面 Agent 快照。卡片图片 DOM 包裹在 `data-agent-ignore` 中，离开列表时销毁，过期前清除 URL，仅可见时才重新申请；关闭预览弹层会清除 URL。浏览器默认 COS 域名可能强制下载，在线预览须配置受信任的自定义读取域名。只允许图片/视频/音频安全 MIME 内联，其余仅下载。视频 HLS、持久化缩略图及地理元数据尚未实现。原片签名接口已上线；云端图片处理功能仍需验收和单独启用，不可把未验证的 CI 签名当成已经可用。
- 软删除文件夹将递归进入回收站；回收站正式页面尚未实现。用户可能继续通过已经签发、尚未到期的 URL 访问对应对象，软删除不会立即撤销旧链接。
- 当前上传队列仅在上传页组件内保存；离开上传页时由现有离页保护提示中断，不能声称跨页继续上传或刷新恢复。后续需将队列迁移到应用级状态管理。
