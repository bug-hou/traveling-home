# 足迹地图

- pageId：`map`（路由 `handle.agent.pageId`）
- 路由：`/map`（Lighthouse `/app/map`，仅本地实现，未部署）
- 权限：登录；后端按当前用户过滤文件归属、未删除及已就绪状态。
- 用途：展示本人有 GPS 或手动标记位置的照片/视频点位，在真实腾讯地图上定位并进入私有素材预览；未定位的素材单列且明确提示。县级点亮不是本版功能。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `map.nav`、`map.mobileNav` | 桌面侧栏 / 手机底栏 | 统一工作空间菜单，当前项为足迹地图 |
| `map.heading`、`map.overview` | 标题及概览 | 上传入口、已定位与未定位素材数量、县级点亮下一步提示 |
| `map.workspace`、`map.canvas` | 主区 | 腾讯底图及当前用户有效点位；Key 缺失、转换不可用或地图服务异常时明确提示，不展示假坐标 |
| `map.media` | 右侧 / H5 下方 | 已定位与未定位切换、本人素材列表与加载更多 |
| `map.selected` | 素材列表下方 | 当前点位素材、按需私有缩图、来源与进入独立预览页 |

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `nav.map`、`nav.mobile.map`、`nav.home.brand` | 链接 | 当前地图/返回首页 | 无 | 否 |
| `map.heading.upload`、`map.media.upload`、`map.canvas.upload` | 链接 | 上传照片或视频 | 无 | 否 |
| `map.load.retry`、`map.media.retry` | 按钮 | 后端加载失败时重新获取点位/未定位素材 | 无 | 否 |
| `map.canvas.retry` | 按钮 | 腾讯底图脚本加载失败时重试 | 无 | 否 |
| `map.media.located`、`map.media.unlocated`、`map.after.unlocated` | 按钮 | 切换本人已定位/未定位素材列表 | 无 | 否 |
| `map.point.{nodeId}.select` | 按钮 | 从 DOM 列表选择点位并居中地图（Canvas 点击也会触发相同操作） | nodeId | 否 |
| `map.point.{nodeId}.preview`、`map.unlocated.{nodeId}.preview` | 链接 | 打开本人素材独立预览；未定位素材可在该页手动标记 | nodeId | 否 |
| `map.media.loadMore` | 按钮 | 分页读取下一批未定位素材 | 无 | 否 |
| `tool: mapApi.allPoints / mapApi.unlocated` | 服务 | 获取本人素材分页，前者遍历各页且标明超出分页上限的截断 | AbortSignal / offset | 否 |
| `tool: focusMapPoint / fitMapPoints` | 地图工具 | Agent 不点 Canvas 时，通过代码对选中点居中或适配当前点集合视野；仅使用后端返回的 `mapLocation` | map、SDK、点位/点集 | 否 |
| `tool: nodesApi.access` | 服务 | 仅对当前选中且符合大小限制的图片按需签发私有短期预览/缩图链接 | nodeId、purpose | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| `pointTotal`、`unlocatedTotal` | 本人已定位、未定位照片和视频总数；接口失败不伪造 0 | 地图两个私有接口 |
| `points`、`selectedId`、`tab` | 当前已加载点位、选择的素材 ID 与列表视图 | `GET /map/points`、UI 状态 |
| `mapStatus` | `ready` 才允许绘图；`not_configured`、`unavailable` 仅显示提示与本人素材列表，不把 WGS-84 当 GCJ-02 | 服务端坐标转换状态 |
| `loading`、`loadError`、`unlocatedError`、`truncated` | 首次加载、局部读取失败或分页上限提示 | 地图接口/页面状态 |

## 跳转

- 首页足迹卡、桌面侧栏与手机底栏均可进入；未登录访问 `/map` 需先登录。
- 从点位或未定位列表进入 `/preview/:nodeId` 时携带已校验的 `/map` 来源，预览页可返回地图。预览页已定位素材亦可跳地图；未定位素材手动保存后返回地图会重新读取。

## 特殊说明

- 地图 Canvas 中的 marker 不作为 Agent 唯一操作入口：右侧已定位列表有独立原生按钮与业务 ID；服务 `focusMapPoint`、`fitMapPoints` 可操作已创建地图实例。
- 后端只保存 WGS-84 GPS/手动坐标；服务端使用腾讯官方 WebService `type=1` 转成 GCJ-02 的 `mapLocation`，失败则不绘制。需分别配置后端 `TENCENT_MAP_SERVER_KEY`（服务端 IP 白名单）和前端 `VITE_TENCENT_MAP_KEY`（网页域名白名单）；无 Key 时列表可浏览但地图明确不可用。不展示虚构地图或县级数量。
- 腾讯 JS GL 仅加载公开浏览器 Key；素材与原始坐标仅向当前用户返回。选中图片才申请短期私有签名 URL，链接仅保存在内存和 `data-agent-ignore` 的媒体区域，过期清除，不进入路由、日志或页面知识文档。大图缩图服务未启用时只显示占位，不回退大原图。
- 状态切换按钮使用原生语义化控件以维持与设计稿一致的地图专属两段切换和稳定 DOM 埋点；重试/加载更多复用 Arco `Button`，未新增需检测 Portal 埋点的复杂 Arco 组件。
