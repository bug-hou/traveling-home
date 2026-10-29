# 公开分享与作品活动页

- pageId：`publicShare`
- 路由：分享域名 `/:handle/:slug`，本地兼容 `/s/:handle/:slug`；实际主站构建位于 `/app/` 子路径。
- 权限：默认公开；具体分享可要求登录和/或提取码，访问每个文件均重新校验。
- 用途：浏览授权的文件或文件夹、活动画廊，或阅读由分享者创建时固定正文快照的纯文本笔记。

## 页面区域

| region | 内容 |
|---|---|
| `publicShare.header` | 品牌入口，生产环境指向主站 `/app/` |
| `publicShare.gate` | 登录提示或提取码输入 |
| `publicShare.hero` | 分享者信息、标题介绍、有效期和封面/占位图 |
| `publicShare.gallery`、`publicShare.row.{nodeId}` | 面包屑、列表/网格切换、只读目录、素材与操作 |
| `publicShare.preview` | Arco Modal 私有短效签名媒体预览，媒体区域忽略 Agent 快照 |
| `publicShare.note` | 笔记分享的标题、分享介绍、纯文本正文及复制操作；仅识别笔记目标后加载正文 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `publicShare.header.brand` | 返回站内首页 | 无 | 否 |
| `publicShare.gate.login` | 跳主站登录后手动返回分享地址 | 无 | 否 |
| `publicShare.gate.password`、`.submit` | 输入并验证提取码（敏感值不读、不留存） | 提取码 | 否 |
| `publicShare.error.retry` | 网络或分享异常时重试 | 无 | 否 |
| `publicShare.gallery.back`、`.root`、`.path.{nodeId}`、`.more` | 嵌套文件夹返回上一级、回分享根目录、切换路径或分页 | 文件夹 ID | 否 |
| `publicShare.gallery.listView`、`.gridView` | 切换网盘式列表和作品网格；活动模式默认网格，普通分享默认列表 | 视图 | 否 |
| `publicShare.row.{nodeId}.open`、`.preview`、`.download` | 浏览目录、签发私有预览/下载链接 | 节点 ID | 否 |
| `publicShare.preview.close` | 销毁当前媒体预览和临时签名地址 | 无 | 否 |
| `publicShare.note.copy` | 复制已授权的公开笔记快照纯文本正文 | 无 | 否 |
| `tool: sharesApi.browse/access/readNote` | 共用公开分享目录与文件权限业务接口 | 公开用户名、路径、密码、节点 ID | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `needsLogin` / `needsPassword` | 分享要求登录或提取码 | 公开浏览 API 的 401/403 |
| `data.items` / `data.breadcrumbs`、`noteData` | 文件分享返回目录，笔记分享返回 `targetType: note` 和 `root:null`；仅再请求笔记正文 | `POST /api/v1/public/shares/:handle/:slug/browse` 与笔记专用 `/note` |
| `currentView` | 文件列表/网格切换，不改变访问权限或后端查询 | 页面状态，初始取分享模式 |
| `downloadCount` / `maxDownloads` | 下载链接签发次数及上限，非真实下载完成次数 | 公开分享响应 |
| `accessError` | 签发预览或下载地址失败 | 公开文件访问 API |
| `VIEW_LIMIT` | 笔记成功阅读次数达到 `maxViews` 后，公开正文接口返回 429；页面清空旧正文并提示联系分享者 | 公开笔记 `/note` API |

## 跳转

- 来源为分享者生成的 `share.convenience.top/{公开用户名}/{自定义路径}`；深入目录时有“返回上一级”与分享根目录面包屑，预览弹层可关闭。仅允许浏览分享根目录的当前后代，移动到范围外立即不能继续请求新地址。
- 被要求登录时前往主站登录页，再返回同一分享链接；旧的公开用户名仍指向原拥有者。

## 特殊说明

- 提取码使用 Arco `Input.Password`（保留 `data-agent-ignore`），密码仅存在当前页面内存、不放 URL 或本地存储；刷新需重新输入。禁下载并不防止浏览器保存已经预览的素材；COS 已签发链接到期前仍可重复使用。
- 仅在网格视图对当前页前六张 ≤2 MiB 图片限量申请原图预览，列表视图不自动下载图片或大型媒体；视频/音频仅在点击预览后加载。公开页采用与工作空间一致的白底细框布局，顶部以分享者、标题、权限摘要为主，文件区域提供面包屑与名称/大小/操作分列，活动模式默认画廊。媒体及封面 DOM 带 `data-agent-ignore`，签名 URL 不写入 Agent 可读内容。
- 打开公开链接先调用 `/browse` 校验分享目标和提取码；仅当 `share.targetType === 'note'` 时，再带同一提取码调用 `/note` 读取正文快照。错误密码不会得到笔记元数据/正文，撤销或到期仍由服务端拒绝。笔记内容按 React 纯文本渲染并标记 `data-agent-ignore`，复制进剪贴板后不能远程撤回。
- 预览使用已有文件页验证过的 Arco `Modal`；文件/活动作品画廊是专用业务视图，不适合通用组件。
