# 上传素材

- pageId：`upload`
- 路由：`/upload`（Lighthouse 对应 `/app/upload`；COS 桶需允许该页面 Origin 才能直传）
- 权限：登录
- 用途：用户选择图片、视频、音频或无人机素材，设置目标文件夹，直传私有 COS 并查看本次页面会话的队列状态。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `upload.nav` | PC 侧栏 | 工作空间导航、当前账号；未实现的业务页显示为禁用项 |
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
| `nav.upload` | 点击 | 打开当前上传页面 | 无 | 否 |
| `upload.nav.brand` | 点击 | 返回上传页面 | 无 | 否 |
| `nav.home`、`nav.mobile.home` | 点击 | 打开正式首页 | 无 | 否 |
| `upload.nav.account` | 点击 | 打开账号设置 | 无 | 否 |
| `nav.files` / `nav.mobile.files` / `upload.header.workspace` / `upload.header.back` | 点击 | 前往正式文件页；返回按钮指向当前目标目录 | 目录 ID | 否 |
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
| `upload.queue.clearCompleted` | 点击 | 清除已完成的队列展示项；不删除云端文件 | 无 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 当前目标目录 | 选中的文件夹名称与 ID | 当前页面状态；提交凭证时传 `parentId` |
| 排队/上传/暂停 | 本标签页内 COS SDK 传输状态 | 浏览器队列与 COS JS SDK |
| 校验入库 | COS 上传已完成，服务端正验证对象并创建文件节点 | `POST /api/v1/uploads/complete` |
| 上传失败 | 凭证申请或 COS 直传失败 | API 错误或 COS JS SDK 错误 |
| 登记失败 | COS 文件已上传，但完成登记失败；可重试同一个 `uploadId` | 完成接口错误 |
| 已完成 | 后端已校验对象并幂等登记文件节点 | 上传完成接口响应 |
| 空队列 | 当前页面会话中没有队列任务 | React 页面状态 |

## 跳转

- 未登录访问 `/upload` 会跳转到 `/login`，登录后返回原路径。
- 可前往：`/files/:folderId?`、`/settings/account`；从文件页携带 `?parentId=` 返回上传页时将该目录设为初始目标，并先查询归属/状态。
- 首页已在本地 React 实现（`/`），可从上传页导航进入；地图、旅行、分享及回收站的正式页面路由尚未接入。本地首页和新 API 尚未重新部署线上。

## 特殊说明

- 目录通过登录保护的 `GET /api/v1/nodes` 按层级加载；只展示活动文件夹。上传凭证接口会再次校验目标文件夹归属与状态。
- 每个文件分别调用 `POST /api/v1/uploads/credentials`，浏览器使用 COS JS SDK 分片直传，不把文件字节发给应用 API；上传后仅将 `uploadId` 交给 `POST /api/v1/uploads/complete`。
- COS 临时凭证约 30 分钟有效。当前版本只支持当前页面会话中的暂停/继续；刷新页面或离开此页后，本地 File 授权和队列不会恢复，也没有会话续签/查询 API。刷新或离开时，浏览器会提示仍有活动任务；确认离开后任务会中止。失败后重试会重新申请凭证并重新上传。
- 如果文件已上传但完成登记失败，重试操作会复用原 `uploadId`，不重复传文件。
- 取消传输只停止浏览器任务并移除当前队列项，不能保证立即清理 COS 未完成分片；尚无服务端取消/孤儿分片清理接口。
- 单文件大小上限为 5 TB；当前没有配额、秒传、EXIF GPS / DJI SRT 解析或地区识别能力。文件页已有按需签名访问接口代码，需在后端部署后才能预览/下载；界面明确显示地点识别尚未接入。
- 文件选择器只能由用户点击“选择本地文件”后主动操作；隐藏的原生 file input 标记为 `data-agent-ignore`，Agent 不得代替用户选择、读取或上传本地文件。
- 目录选择使用 Arco Modal，批量与逐文件进度使用 Arco Progress；在手机端队列按钮另起一行、文本和任务操作扩大以避免缩成微小字号。弹层和进度只负责展示，不代替原有 COS 分片与完成登记逻辑。
- PC/H5 断点由 CSS 处理；后台标签页不依赖动画回调推进上传业务状态。
