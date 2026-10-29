# 手机取笔记

- pageId：`phoneNote`
- 路由：`/phone-note/:id`（线上主站 `/app/phone-note/:id`）
- 权限：无需登录；必须通过专属短时二维码加入，电脑核对六位码后逐次授权。
- 用途：手机读取、复制电脑指定的一条笔记，不具备修改、列表浏览、访问其他笔记或使用扫码上传令牌的能力。

## 页面区域

| region | 内容 |
|---|---|
| `phoneNote.main` | 品牌头、扫码加入与待授权状态、单条纯文本正文和复制按钮 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `phoneNote.content.copy` | 获批后复制当前笔记正文 | 无 | 否 |
| `tool: notePairsApi.join/status/content` | 设备加入、轮询批准状态、获批后短时读取单条内容 | 配对 ID、短时加入密钥、仅该设备的随机令牌 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `status.status` | 待批准、已批准、撤销或过期；撤销或过期后不再提供正文 | 匿名 Bearer 设备状态接口 |
| `code` | 手机显示给电脑核对的六位码；不进入页面 Agent 快照 | 仅首次加入响应，同标签页临时保留；状态接口不返回配对码 |
| `note`、`copied` | 仅获批后读取的一条笔记正文、是否复制成功 | 匿名正文接口、本地状态 |

## 跳转

- 仅从电脑端笔记扫码二维码进入主站，不通过分享域名访问，也不显示私有工作区导航。

## 特殊说明

- URL 片段中的加入密钥在加载后立即清除，只留在本标签页 sessionStorage 等待加入；随机设备令牌仅在本标签页 sessionStorage 使用，匿名请求 `credentials: omit`、`cache: no-store`、`referrerPolicy: no-referrer`。
- `code` 显示标记 `data-agent-ignore`；配对过期/撤销后 UI 清除正文，不再允许复制。复制进入手机系统剪贴板后无法被远程撤回。正文是 React 纯文本、保留换行，不执行 HTML。
