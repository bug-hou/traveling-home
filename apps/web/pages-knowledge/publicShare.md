# 公开分享与作品活动页

- pageId：`publicShare`
- 路由：分享域名 `/:handle/:slug`，本地兼容 `/s/:handle/:slug`；实际主站构建位于 `/app/` 子路径。
- 权限：默认公开；具体分享可要求登录和/或提取码，访问每个文件均重新校验。
- 用途：浏览分享者授权的文件或文件夹，活动模式用封面/文案/画廊展示作品。

## 页面区域

| region | 内容 |
|---|---|
| `publicShare.gate` | 登录提示或提取码输入 |
| `publicShare.hero` | 活动页主视觉、标题介绍、有效期 |
| `publicShare.gallery`、`publicShare.row.{nodeId}` | 只读目录、素材与操作 |
| `publicShare.preview` | Arco Modal 私有短效签名媒体预览，媒体区域忽略 Agent 快照 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `publicShare.header.brand` | 返回站内首页 | 无 | 否 |
| `publicShare.gate.login` | 跳主站登录后手动返回分享地址 | 无 | 否 |
| `publicShare.gate.password`、`.submit` | 输入并验证提取码（敏感值不读、不留存） | 提取码 | 否 |
| `publicShare.error.retry` | 网络或分享异常时重试 | 无 | 否 |
| `publicShare.gallery.root`、`.path.{nodeId}`、`.more` | 返回分享根、切换文件夹或分页 | 文件夹 ID | 否 |
| `publicShare.row.{nodeId}.open`、`.preview`、`.download` | 浏览目录、签发私有预览/下载链接 | 节点 ID | 否 |
| `publicShare.preview.close` | 销毁当前媒体预览和临时签名地址 | 无 | 否 |
| `tool: sharesApi.browse/access` | 共用公开分享目录与文件权限业务接口 | 公开用户名、路径、密码、节点 ID | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `needsLogin` / `needsPassword` | 分享要求登录或提取码 | 公开浏览 API 的 401/403 |
| `data.items` / `data.breadcrumbs` | 当前分享文件夹及路径内的项目 | `POST /api/v1/public/shares/:handle/:slug/browse` |
| `downloadCount` / `maxDownloads` | 下载链接签发次数及上限，非真实下载完成次数 | 公开分享响应 |
| `accessError` | 签发预览或下载地址失败 | 公开文件访问 API |

## 跳转

- 来源为分享者生成的 `share.convenience.top/{公开用户名}/{自定义路径}`；仅允许浏览分享根目录的当前后代，移动到范围外立即不能继续请求新地址。
- 被要求登录时前往主站登录页，再返回同一分享链接；旧的公开用户名仍指向原拥有者。

## 特殊说明

- 密码仅存在当前页面内存、不放 URL 或本地存储；刷新需重新输入。禁下载并不防止浏览器保存已经预览的素材；COS 已签发链接到期前仍可重复使用。
- 活动画廊仅对当前页前六张 ≤2 MiB 图片限量申请原图预览，不自动下载大型媒体；视频/音频仅在点击预览后加载。媒体及封面 DOM 带 `data-agent-ignore`，签名 URL 不写入 Agent 可读内容。
- 预览使用已有文件页验证过的 Arco `Modal`；文件/活动作品画廊是专用业务视图，不适合通用组件。
