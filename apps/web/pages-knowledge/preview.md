# 素材预览与定位

- pageId：`preview`
- 路由：`/preview/:nodeId`（Lighthouse `/app/preview/:nodeId`）
- 权限：登录；接口再次校验当前用户归属和文件活动状态。
- 用途：查看私有素材、真实文件信息及手动标记的拍摄位置；无位置的照片/视频可输入 WGS-84 经纬度。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `preview.nav`、`preview.mobileNav` | 桌面侧栏 / 手机底栏 | 共用工作空间导航；足迹、旅行、回收站仍禁用 |
| `preview.header` | 顶部 | 返回原目录、下载原文件 |
| `preview.media` | 主区 | 短时签名图片/视频/音频；不支持的格式或访问失败提示；媒体节点 `data-agent-ignore` |
| `preview.details` | 右侧 / 手机下方 | 真实文件类型、大小、上传时间；拍摄时间及设备明确显示“待解析” |
| `preview.location` | 右侧 / 手机下方 | 用户设置的位置和经纬度；地图仅为明确标注的占位，不是真实点位或县界 |
| `preview.editor` | Arco 弹层 | 手动经纬度/可选地点名称编辑（最多 60 字）；仅照片和视频展示入口 |

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `nav.home.brand`、`nav.home`、`nav.files`、`nav.shares`、`nav.mobile.*`、`nav.account` | 导航 | 在既有工作空间页面间跳转，禁用入口不可点击 | 无 | 否 |
| `preview.header.back`、`preview.load.back` | 链接 | 返回该文件所在目录 / 文件根目录 | 无 | 否 |
| `preview.load.retry` | 按钮 | 重新读取文件详情和私有位置 | nodeId | 否 |
| `preview.header.download` | 按钮 | 另行签发下载链接并下载原文件 | nodeId | 否 |
| `preview.media.retry` | 按钮 | 预览签名失败/过期后重新申请链接 | nodeId | 否 |
| `preview.location.edit` | 按钮 | 打开位置编辑器 | nodeId | 否 |
| `preview.editor.placeName`、`preview.editor.longitude`、`preview.editor.latitude` | 输入 | 编辑地点名、WGS-84 经度/纬度；0 合法，负值有效 | 字符串/数值 | 否 |
| `preview.editor.cancel`、`preview.editor.save` | 按钮 | 取消，或提交并持久化用户自己文件的位置 | nodeId + 坐标 | 否 |
| `tool: nodesApi.detail/location/access/saveLocation` | 服务 | 校验归属后读取文件/位置，按需签名媒体链接或保存位置 | nodeId + WGS-84 坐标 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `loading` / `loadError` | 节点详情和位置读取中/失败；不填充设计稿示例 | `GET /api/v1/nodes/:id`、`GET /nodes/:id/location` |
| `node` / `ancestors` | 当前用户的文件信息与父目录路径 | 节点详情 |
| `location` | `null` 为无位置；有值时显示手动坐标、可选地点名称 | `GET/PATCH /nodes/:id/location` |
| `access` / `accessError` | 短时签名链接只保存在组件内存；失效时清除并提示重试 | `GET /nodes/:id/url?purpose=preview` |
| `editor` / `saving` / `formError` | 编辑弹层状态、保存中/校验或接口错误 | 页面状态及 `PATCH /nodes/:id/location` |

## 跳转

- 从 `/files/:folderId?` 的文件卡片、首页最近素材进入；目录卡片仍进入目录。
- `preview.header.back` 依文件详情的真实 `parentId` 返回所在目录；不可用时可回 `/files`。
- 未登录深链接先进入登录页；成功后回原预览路径。

## 特殊说明

- 切勿把 `access.url` 放入路由、日志或 Agent 快照：媒体区域 `data-agent-ignore`，签名 URL 离页取消请求并移除，过期前约 30 秒清除；下载必须重新签名。短期已签发链接在其剩余有效期内仍可访问，不等于撤销。
- 自定义读取域名、浏览器播放能力或大视频网络状况会影响原片在线播放；HLS 转码、EXIF/SRT 自动解析、GCJ-02 转换、真实地图、县级归属与首页足迹统计都未接通。地名是用户自行填写的纯文本，不据此推断行政区。
- 手动更新位置不是不可逆操作，可再次修改；敏感的私有签名 URL 不应被 Agent 读取。位置表单用原生语义化 `input`（支持小数负数/移动端数字键盘），弹层复用 Arco `Modal`，与既有文件页 Modal 的 Portal 埋点方式一致。
