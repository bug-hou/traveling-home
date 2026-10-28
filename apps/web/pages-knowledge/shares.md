# 我的分享与配置

- pageId：`shares`
- 路由：`/shares`、`/shares/new?targetId=...`、`/shares/:id/edit`
- 权限：登录。创建前需在账号页设置公开用户名。
- 用途：管理文件/文件夹的分享链接，并配置作品活动页的展示与访问规则。

## 页面区域

| region | 内容 |
|---|---|
| `shares.header` | 品牌、文件页与账号页导航 |
| `shares.list`、`shares.row.{shareId}` | 有效/过期/已取消分享与签发量、复制、打开、编辑、取消 |
| `shares.editor` | 创建或编辑分享的展示、链接、访问规则、封面与保存 |
| `shares.cover` | 活动展示从分享目录中的图片中选择封面 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `shares.header.brand`、`.files`、`.back` | 返回文件或分享列表 | 无 | 否 |
| `shares.header.account`、`shares.handle.setup`、`shares.editor.setupHandle` | 前往公开用户名设置 | 无 | 否 |
| `shares.empty.files` | 前往文件页选择分享对象 | 无 | 否 |
| `shares.row.{shareId}.copy`、`.open`、`.edit` | 复制、打开或编辑特定分享 | 分享 ID | 否 |
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
| `shares` | 当前用户最多 200 条分享，含已取消项 | `GET /api/v1/shares` |
| `target` / `selected` | 分享目标或当前编辑中的分享 | 节点详情或分享列表 |
| `mode` / `allowPreview` / `allowDownload` | 展示样式与访问规则 | 表单状态 |
| `downloadCount` / `maxDownloads` | 签发链接次数 / 总额度，非 COS 真实完成下载数 | 分享列表 |

## 跳转

- 从文件菜单“分享文件/文件夹”进入创建页；从账号页进入列表；公开链接指向分享域名。
- 编辑的自定义路径变更后旧路径失效；修改公开用户名后保留旧用户名映射。

## 特殊说明

- 提取码输入 `data-agent-ignore`，原提取码不回显；取消分享标为危险操作。已签发的 COS 链接最久约 60 秒内仍有效。
- 封面仅支持活动页分享范围内已就绪图片；封面浏览当前每级最多 100 项。活动页只能展示，不接受访客投稿。访问者已经看到的预览无法被浏览器禁止保存。
- 通用输入与操作使用 Arco `Input`、`Input.Password` 和 `Button`（已有账号页实测真实输入/按钮埋点）；日期时间使用原生 `datetime-local`，明确按访客设备本地时区转换为 ISO，避免日期选择器的时区歧义。特色作品卡与目录封面选择器为业务组件。
