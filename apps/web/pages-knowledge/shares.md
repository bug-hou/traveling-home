# 我的分享与配置

- pageId：`shares`
- 路由：`/shares`、`/shares/new?targetId=...`、`/shares/new?targetId=...&targetType=note`、`/shares/:id/edit`
- 权限：登录。创建前需在账号页设置公开用户名。
- 用途：管理文件、文件夹及笔记的分享链接与二维码，并配置访问规则。

## 页面区域

| region | 内容 |
|---|---|
| `shares.sidebar`、`shares.header`、`shares.mobileNav` | 共用桌面工作区菜单与手机七项底栏；列表/创建/编辑都高亮“我的分享”，顶栏显示当前层级 |
| `shares.overview` | 全部、生效中、累计访问概览 |
| `shares.list`、`shares.filters`、`shares.row.{shareId}` | 分享状态分栏、名称/路径搜索、表格式列表；手机显示卡片操作 |
| `shares.handle` | 尚未设置公开用户名时的入口 |
| `shares.editor`、`shares.editorSummary` | 创建/编辑的分组表单与不含真实私有文件的设置概要 |
| `shares.cover` | 活动展示从分享目录中的图片中选择封面 |
| `shares.qr` | 已保存分享的公开 URL 二维码 Modal，提供二维码下载；不包含提取码或私有正文 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `nav.home.brand`、`shares.header.files`、`shares.header.back` | 返回首页/文件空间；创建详情返回发起目录，编辑详情返回分享列表 | 无 | 否 |
| `nav.*`、`nav.mobile.*`、`shares.sidebar.pickFiles` | 共用桌面/手机主菜单，选择要分享的文件；当前项为“我的分享” | 无 | 否 |
| `shares.editor.pickFiles` | 创建页缺少分享目标时前往文件空间选择文件 | 无 | 否 |
| `shares.header.account`、`shares.handle.setup`、`shares.editor.setupHandle` | 前往公开用户名设置 | 无 | 否 |
| `shares.list.create`、`shares.empty.files` | 前往文件页选择分享对象 | 无 | 否 |
| `shares.filters.all`、`.active`、`.expired`、`.revoked`、`.search` | 按状态及标题/路径筛选已加载分享 | 状态、关键词 | 否 |
| `tool: filterShares/shareStatus` | 共用分享列表筛选与状态归类函数 | 分享条目、状态、关键词 | 否 |
| `shares.row.{shareId}.copy`、`.open`、`.edit`、`.qr` | 复制、打开、编辑特定分享或显示公开链接二维码 | 分享 ID | 否 |
| `shares.qr.download`、`.close` | 下载二维码 PNG、关闭二维码 Modal | 当前分享 | 否 |
| `shares.row.{shareId}.revoke` | 确认后取消分享，不删除文件 | 分享 ID | 是 |
| `shares.editor.standard`、`.activity`、`.title`、`.description` | 选择简洁/活动模式，设置文案 | 标题/介绍 | 否 |
| `shares.editor.slug` | 编辑该用户名下的唯一路径，留空自动生成 | 路径 | 否 |
| `shares.cover.root`、`.folderPath.{id}`、`.folder.{id}`、`.image.{id}`、`.clear` | 逐级浏览分享范围内的图片，选择或清除封面 | 节点 ID | 否 |
| `shares.editor.requireLogin`、`.allowPreview`、`.allowDownload` | 限制访客登录、预览及下载 | 布尔值 | 否 |
| `shares.editor.password`、`.removePassword` | 设置、保留或清除分享提取码，原值不可读取 | 4–128 位提取码 | 否 |
| `shares.editor.neverExpires`、`.expiresAt`、`.unlimited`、`.maxDownloads` | 设有效期与下载链接签发上限 | 本地时间或次数 | 否 |
| `shares.editor.submit`、`.cancel` | 保存或放弃分享设置 | 当前表单 | 否 |
| `tool: sharesApi.list/create/update/revoke`、`tool: shareLink` | 共用业务接口及分享地址生成 | 分享 ID、配置 | 撤销时是 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `shares` / `activeCount` | 当前用户最多 200 条分享、其中生效的数量 | `GET /api/v1/shares`，本地状态推导 |
| `listFilter` / `listQuery` / `filteredShares` | 状态分栏、标题/路径关键词与当前可见列表（空结果不作空账户） | 页面状态及 `filterShares` |
| `target` / `noteTarget` / `selected` | 文件节点或笔记摘要目标、当前编辑中的分享 | 节点详情、本人笔记列表或分享列表 |
| `mode` / `allowPreview` / `allowDownload` / `isNote` | 文件展示模式与访问设置、是否笔记只读分享 | 表单及 targetType 状态 |
| `downloadCount` / `maxDownloads` | 仅文件：签发链接次数 / 总额度，非 COS 真实完成下载数 | 分享列表 |

## 跳转

- 从文件菜单“分享文件/文件夹”进入创建页，返回/取消时优先回原目录或搜索结果；缺失 `targetId` 时提示先去文件空间选择，直接打开创建页则回分享列表。编辑详情固定回分享列表，保存后也回列表。账号页可进入列表；公开链接指向分享域名。
- 从随手记进入笔记分享创建页时，`targetType=note` 让页面读取本人笔记标题，提交时使用 `{noteId,...settings}`，不发送文件的 `targetId`；编辑笔记分享时沿用同一表单但只提交路径、标题、介绍、提取码及到期时间。保存后回分享列表，取消创建回随手记。
- 编辑的自定义路径变更后旧路径失效；修改公开用户名后保留旧用户名映射。

## 特殊说明

- 桌面版采用与首页一致的白色细框侧栏 + 分享概览 + 可筛选的表格式列表，手机隐藏侧栏并提供固定底部导航；单行操作在手机改为 2×2 按钮区，埋点不变。配置页采用分组表单与右侧设置概要（不展示或请求私有素材）；手机底部提供保存栏。
- 提取码输入 `data-agent-ignore`，原提取码不回显；取消分享标为危险操作。已签发的 COS 链接最久约 60 秒内仍有效。二维码由现有公开 URL 生成，既不携带正文、提取码，也不改变过期和撤销规则；二维码图片下载后无法远程回收。
- 笔记分享不能要求登录（分享域跨站 Cookie 不可用）、没有活动封面和下载；配置中隐藏这些字段及签发计数，公开阅读采用创建分享时的正文快照。需要限制访问请设置提取码/到期时间，取消和二维码传播遵循现有链接规则。
- 封面仅支持活动页分享范围内已就绪、不超过 2 MiB 的 JPEG/PNG/GIF/WebP 图片；封面浏览当前每级最多 100 项。活动页只能展示，不接受访客投稿。访问者已经看到的预览无法被浏览器禁止保存。
- 通用输入与操作使用 Arco `Input`、`Input.Password` 和 `Button`（已有账号页实测真实输入/按钮埋点）；日期时间使用原生 `datetime-local`，明确按访客设备本地时区转换为 ISO，避免日期选择器的时区歧义。特色作品卡与目录封面选择器为业务组件。
