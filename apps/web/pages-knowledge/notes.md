# 随手记

- pageId：`notes`
- 路由：`/notes`（线上主站 `/app/notes`）
- 权限：必须登录；笔记仅本人可读写。
- 用途：创建、搜索、编辑、删除纯文本笔记；为单条笔记发起手机短时读取配对，或单独创建可配置的公开分享。

## 页面区域

| region | 内容 |
|---|---|
| `notes.sidebar`、`notes.header`、`notes.mobileNav` | 共用桌面菜单、顶栏与手机底栏；当前高亮随手记 |
| `notes.list` | 当前用户笔记列表、标题/内容搜索与新建 |
| `notes.editor` | 当前选中笔记的标题、正文和保存/删除/分享操作 |
| `notes.pair` | Arco Modal 手机扫码、六位码核对确认、取消授权和结束提示 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `nav.home.brand`、`notes.header.shares`、`notes.header.account`、`nav.*`、`nav.mobile.*` | 打开首页、分享管理、设置和共用导航 | 无 | 否 |
| `notes.list.create`、`.search`、`.more`、`notes.row.{noteId}.open` | 开始写新笔记、搜索已加载笔记标题、分页加载、按需读取本人笔记正文；未保存时切换需确认 | 标题关键词、笔记 ID、页偏移 | 否 |
| `notes.editor.title`、`.content`、`.save` | 编辑并保存标题和纯文字正文 | 标题/内容 | 否 |
| `notes.editor.pair` | 为已保存且未修改的当前笔记开启独立短时扫码授权 | 笔记 ID | 否 |
| `notes.editor.share` | 前往分享配置，为当前笔记创建公开链接（必须先保存） | 笔记 ID | 否 |
| `notes.editor.delete` | 确认后删除笔记并使关联访问失效 | 笔记 ID | 是 |
| `notes.pair.approve` | 核对手机六位码后确认只读访问 | 配对 ID | 否 |
| `notes.pair.revoke`、`.close` | 结束短时授权，关闭弹层时先撤销仍有效的会话，失败保留弹层 | 配对 ID | 是 |
| `tool: notesApi.list/detail/create/update/remove` | 后端鉴权的本人笔记分页摘要、按需详情和读写操作 | 笔记 ID、标题、正文、分页偏移 | 删除是 |
| `tool: notePairsApi.active/create/read/approve/revoke` | 单条笔记的独立匿名手机配对会话 | 笔记 ID、配对 ID | 撤销是 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `notes`、`selected`、`query`、`total` | 分页摘要、当前已加载的本人笔记详情、标题筛选词和总数 | `GET /api/v1/notes`、`GET /api/v1/notes/:id` 和本地状态 |
| `dirty`、`busy` | 编辑内容是否未保存、正在提交 | 当前草稿和保存状态 |
| `pairStatus.status` | 待扫码、待电脑确认、已批准、撤销或过期 | 私有配对状态接口轮询 |

## 跳转

- 从工作空间主菜单进入；点击“创建公开分享”前往 `/shares/new?targetId={noteId}&targetType=note`，分享设置取消返回笔记，保存后返回分享管理。
- 手机扫码访问同站点 `phone-note/{pairId}#secret`；`/app/` 部署下保留 `/app/` 前缀。公开分享使用独立 `share.convenience.top/{handle}/{slug}`，二维码仅编码该公开 URL。

## 特殊说明

- 私人扫码二维码含片段中的短期加入密钥，应仅展示给本人手机；不代表任何公开分享授权。手机六位码需要与电脑显示的码一致，电脑主动批准后只允许读取当前笔记；笔记内容绝不写入二维码。
- 当前版本是**手动保存**：按钮和状态明确提示未保存草稿，切换笔记/刷新标签会警告；未承诺自动保存。标题上限 80 字、正文上限 10000 字，列表接口不返回正文且分页加载，筛选只覆盖已加载标题；选择笔记后才按需请求详情。
- 本页不缓存笔记到 localStorage；私有正文输入、敏感扫码二维码及配对码均 `data-agent-ignore`。删除和撤销带危险标识。页面正文使用 Arco `Input.TextArea`，不解析 HTML，避免脚本注入；CRUD 在服务中复用。恢复旧扫码只拿会话 ID、不取回加入 secret，无法再次显示旧二维码，可结束后重建。
