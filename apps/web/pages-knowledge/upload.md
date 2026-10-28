# 上传素材

- pageId：`upload`
- 路由：`/upload`（Lighthouse 对应 `/app/upload`；COS 桶需允许该页面 Origin 才能直传）
- 权限：登录
- 用途：用户选择图片、视频、音频或无人机素材，设置目标文件夹，直传私有 COS 并查看本次页面会话的队列状态。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `upload.nav` | PC 侧栏 | 统一工作空间导航，高亮上传；分享可用，未实现的足迹/旅行/回收站显示为禁用项 |
| `upload.header` | 顶栏 | 面包屑、私密传输提示、账号入口 |
| `upload.intro` | 主区顶部 | 上传标题与返回个人空间入口 |
| `upload.destination` | 主区 | 当前上传目标与文件夹选择器 |
| `upload.destination.dialog` | Arco Modal 弹层 | 按层级浏览当前用户的活动文件夹、选择目标目录；关闭后焦点返回更改目录按钮 |
| `upload.dropzone` | 主区 | 用户主动选择或拖放文件、格式说明、私密存储提示 |
| `upload.queue` | 主区 | 队列总进度、逐文件进度、上传控制与完成/失败状态 |
| `upload.tips` | 队列旁/下方 | 私有 COS、暂停限制与地点识别状态说明 |
| `upload.mobileNav` | H5 底栏 | 当前上传入口与可用的账号入口 |

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `nav.home.brand`、`nav.home`、`nav.mobile.home` | 点击 | 返回正式首页 | 无 | 否 |
| `nav.upload`、`nav.mobile.upload` | 点击 | 上传菜单当前项 | 无 | 否 |
| `nav.files`、`nav.mobile.files`、`nav.shares`、`nav.mobile.shares`、`nav.account`、`nav.mobile.account` | 点击 | 前往其它已实现的工作区页面 | 无 | 否 |
| `upload.header.account`、`upload.header.workspace` | 点击 | 打开账号设置 / 工作空间首页 | 无 | 否 |
| `upload.header.back` | 点击 | 返回进入上传页前的站内页面；直接访问时回初始目录或文件根目录，不随目标选择改变 | 无 | 否 |
| `upload.destination.open` | 点击 | 打开目录选择弹层 | 无 | 否 |
| `upload.destination.breadcrumb.{folderId}` | 点击 | 浏览目录祖先层级 | `folderId` | 否 |
| `upload.destination.openFolder.{folderId}` | 点击 | 进入子文件夹 | `folderId` | 否 |
| `upload.destination.selectCurrent` / `upload.destination.confirm` | 点击 | 将当前目录设为上传目标 | `parentId` 或 `null`（根目录） | 否 |
| `upload.destination.loadMore` | 点击 | 加载更多直接子文件夹 | offset | 否 |
| `upload.destination.close` / `upload.destination.cancel` | 点击 | 关闭目录弹层，不更改目标 | 无 | 否 |
| `upload.destination.retryList` | 点击 | 重试加载目录 | 无 | 否 |
| `upload.dropzone.chooseFiles` | 点击 | 打开系统文件选择器 | 用户亲自选择的本地文件 | 否 |
| `upload.dropzone.dropFiles` | 拖放 | 将用户主动拖入的文件加入队列 | File[] | 否 |
| `upload.queue.start` | 点击 | 顺序上传等待中的任务 | 队列任务 ID | 否 |
| `upload.queue.pauseAll` | 点击 | 暂停或继续正在传输的任务 | 无 | 否 |
| `upload.queue.row.{itemId}.pause` / `.resume` | 点击 | 暂停或继续单个任务 | 队列任务 ID | 否 |
| `upload.queue.row.{itemId}.cancel` | 点击 | 中止正在传输的任务并从页面队列移除；COS 可能保留未完成分片 | 队列任务 ID | 是 |
| `upload.queue.row.{itemId}.retryAction` | 点击 | 失败项的“重新上传”按钮会重传文件；若云端已上传而登记失败，则按钮显示“重试登记”、仅重试登记 | 队列任务 ID | 否 |
| `upload.queue.row.{itemId}.remove` | 点击 | 从页面队列移除尚未开始或失败的任务；不删除云端文件 | 队列任务 ID | 否 |
| `upload.queue.row.{itemId}.preview` | 链接 | 已完成照片/视频前往该文件的私有预览页，查看位置或手动标记 | 完成响应中的节点 ID | 否 |
| `upload.queue.clearCompleted` | 点击 | 清除已完成的队列展示项；不删除云端文件 | 无 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 当前目标目录 | 选中的文件夹名称与 ID | 当前页面状态；提交凭证时传 `parentId` |
| 排队/上传/暂停 | 本标签页内 COS SDK 传输状态 | 浏览器队列与 COS JS SDK |
| 校验入库 | COS 上传已完成，服务端正验证对象并创建文件节点 | `POST /api/v1/uploads/complete` |
| 上传失败 | 凭证申请或 COS 直传失败 | API 错误或 COS JS SDK 错误 |
| 登记失败 | COS 文件已上传，但完成登记失败；可重试同一个 `uploadId` | 完成接口错误 |
| 已完成 | 后端已校验对象并幂等登记文件节点；照片/视频展示是否检测到 GPS，未检测到显示“未定位”并可进入预览页手动补充 | 上传完成接口响应、本地解析结果 |
| 位置解析 | 每个照片/视频独立解析并绑定到本批文件；SRT 只在同一次选择中唯一同名时关联 | 用户选择的 File 和本地解析服务；最终位置以 GET 预览接口为准 |
| 空队列 | 当前页面会话中没有队列任务 | React 页面状态 |

## 跳转

- 未登录访问 `/upload` 会跳转到 `/login`，登录后返回原路径。
- 从文件页携带 `?parentId=` 进入时先校验目录归属并设为初始上传目标；顶部返回优先去来源页面，直接打开则回初始目录或文件根目录，上传中仍受离页确认保护。上传完成的预览链接返回实际保存目录，不恢复已卸载的队列。
- 首页、文件、上传、分享与账号均已接入统一菜单；足迹地图、旅行及回收站仍禁用。

## 特殊说明

- 目录通过登录保护的 `GET /api/v1/nodes` 按层级加载；只展示活动文件夹。上传凭证接口会再次校验目标文件夹归属与状态。
- 每个文件分别调用 `POST /api/v1/uploads/credentials`，浏览器使用 COS JS SDK 分片直传，不把文件字节发给应用 API；完成时仅提交 `uploadId` 和可选的 WGS-84 `{latitude,longitude,source:'exif'|'srt'}`。仅 JPEG/JPG 读 EXIF GPS，MP4/MOV 可读取同一次文件选择内、与视频唯一同名主体（不区分大小写）的 `.srt`；重名、跨批次、缺失、不受支持格式或解析失败时无自动位置，上传照常完成。SRT 支持方括号纬经度与 `GPS(lat,lon,alt)`，忽略 `HOME`，只取首个有效字幕帧，限制 4 MiB、UTF-8/UTF-16 BOM，不生成轨迹。SRT 文件仍作为原始文件单独上传。
- COS 临时凭证约 30 分钟有效。当前版本只支持当前页面会话中的暂停/继续；刷新页面或离开此页后，本地 File 授权和队列不会恢复，也没有会话续签/查询 API。刷新或离开时，浏览器会提示仍有活动任务；确认离开后任务会中止。失败后重试会重新申请凭证并重新上传。
- 如果文件已上传但完成登记失败，重试操作会复用原 `uploadId` 和本任务已解析的 GPS，不重复传文件或重新关联其他视频的 SRT。自动位置仅在首次创建文件时保存，不能覆盖已有的手动标记。
- 取消传输只停止浏览器任务并移除当前队列项，不能保证立即清理 COS 未完成分片；尚无服务端取消/孤儿分片清理接口。
- 单文件大小上限为 5 TB；当前没有配额、秒传、存量回扫或地区识别能力。预览页显示实际来源和“未定位”，地图与县级归属仍未实现；本期代码未上线。
- 文件选择器只能由用户点击“选择本地文件”后主动操作；隐藏的原生 file input 标记为 `data-agent-ignore`，Agent 不得代替用户选择、读取或上传本地文件。
- 目录选择使用 Arco Modal，批量与逐文件进度使用 Arco Progress；在手机端队列按钮另起一行、文本和任务操作扩大以避免缩成微小字号。弹层和进度只负责展示，不代替原有 COS 分片与完成登记逻辑。
- 正式上传页已采用与首页一致的白底、细边框与深色主按钮；队列和目录弹层交互不变。PC/H5 断点由 CSS 处理；后台标签页不依赖动画回调推进上传业务状态。
