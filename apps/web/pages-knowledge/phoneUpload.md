# 手机扫码上传

- pageId：`phoneUpload`
- 路由：`/phone-upload/:id`（线上 `/app/phone-upload/:id`）
- 权限：无需登录；二维码的一次性密钥只能发起配对，电脑端批准后由单设备令牌获得指定文件夹的限时上传权限。
- 用途：用户用手机扫描电脑上传页的二维码，等待电脑核对六位配对码并确认，再主动从手机相册选择照片/视频直传迹光私有云。

## 页面区域

| region | 内容 |
|---|---|
| `phoneUpload.page` | 免登录上传页面与当前状态 |
| `phoneUpload.pairing` | 扫码连接、六位配对码、等待授权/批准/结束状态 |
| `phoneUpload.files` | 用户主动选择文件、开始上传及任务列表 |
| `phoneUpload.files.row.{itemId}` | 文件进度、登记状态、失败重试 |

## 可执行动作

| data-agent-id / 工具名 | 作用 | 参数 | 危险 |
|---|---|---|---|
| `phoneUpload.files.choose` | 打开系统相册/文件选择器；Agent 不得代用户选择本地文件 | 无 | 否 |
| `phoneUpload.files.start` | 顺序上传用户已选择的队列文件 | 当前队列 | 否 |
| `phoneUpload.files.row.{itemId}.retry` | 传输失败重新上传；登记失败只重试完成登记 | 文件任务 ID | 否 |
| `joinPhoneOnce`、`phoneUploadsApi.status` | 加入扫码会话、轮询电脑授权状态 | 扫码会话 ID/仅内存及本标签页保存的设备令牌 | 否 |
| `uploadFromPhone`、`phoneUploadsApi.complete` | 单文件 COS 直传、完成登记 | 当前设备授权、文件、可选自动 GPS | 否 |

## 页面可读状态

- 扫码加入成功前不能上传；等待确认时页面显示六位配对码，电脑端必须核对后批准。
- 已批准时显示目标文件夹名称、文件选择和上传按钮；电脑撤销或会话过期时禁止新上传，现有任务结果仍显示。
- 队列的“已完成”表示后端已 HEAD 校验 COS 对象并创建文件节点；“登记失败”可复用原 uploadId 重试。
- 网页只能访问用户主动选择的本地文件，无法枚举整个手机相册或后台同步。隐藏原生 file input 为 `data-agent-ignore`。

## 接口与安全边界

- `POST /api/v1/phone-uploads/:id/join`：提交二维码片段中的一次性密钥，成功返回设备令牌和六位配对码；密钥从地址栏立即移除。扫描时手机不携带电脑的 Cookie。
- `GET /api/v1/phone-uploads/:id/status`：设备 Bearer 查询授权状态；批准后才返回目标文件夹名称。
- `POST /api/v1/phone-uploads/:id/credentials`：设备 Bearer 请求单文件 COS STS，服务端固定目录与用户 ID；手机不能传 parentId。最多 100 次、单文件至多 5 GB。`POST /api/v1/phone-uploads/:id/complete`：同设备限当前配对上传任务登记与可选自动 GPS。
- 扫码加入有效期 5 分钟，批准后新文件授权 1 小时；已签发的单文件 STS 有自己的有效期，结束授权不能即时回收已发往 COS 的临时凭证。刷新会中断当前传输，但本标签页保存的设备令牌可继续查看状态和开始新任务。关闭标签页即失去设备令牌。
