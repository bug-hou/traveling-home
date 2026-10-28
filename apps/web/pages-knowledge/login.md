# 登录页

- pageId：`login`
- 路由：`/login`（Lighthouse 访问地址为 `/app/login`）
- 权限：公开（登录后会自动跳转至 `/`）
- 用途：用邮箱与密码创建会话。认证凭证由服务端通过 HttpOnly Cookie 管理，页面不读取或保存 token。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `auth.header` | PC 顶部 | 品牌入口 |
| `auth.hero` | PC 左侧 | 产品介绍与装饰插画，不承载业务数据 |
| `auth.tabs` | 登录卡上方 | 登录与注册入口 |
| `login.form` | 主区 | 邮箱、密码、显示密码、提交；服务端反馈区 |

窄屏由 CSS media query 自动换成 H5 布局，和桌面共用路由、校验、接口与会话状态。后端不基于设备类型授权。

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `auth.header.brand` / `auth.mobile.brand` | 点击 | 回到登录页 | 无 | 否 |
| `auth.tabs.login` | 点击 | 打开登录页 | 无 | 否 |
| `auth.tabs.register` | 点击 | 前往注册页 | 无 | 否 |
| `login.form.email` | 输入 | 输入账号邮箱 | 邮箱 | 否 |
| `login.form.password` | 输入 | 输入密码（值为敏感信息，Agent 快照忽略） | 密码 | 否 |
| `login.form.togglePassword` | 点击 | 切换密码明文显示 | 无 | 否 |
| `login.form.submit` | 提交 | 调用 `POST /api/v1/auth/login`，成功后打开 `/` | 邮箱、密码 | 否 |
| `login.switch.register` | 点击 | 前往注册页 | 无 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 登录名和密码错误 | 服务端凭证校验失败，不区分邮箱不存在与密码错误 | `INVALID_CREDENTIALS` |
| 登录尝试过多 | 服务端账号锁定 15 分钟 | `TOO_MANY_ATTEMPTS` |
| 账号不可用 | 账号状态非 active | `ACCOUNT_DISABLED` |
| 网络错误 | 无法连接认证 API | 网络异常 |
| 正在登录 | 提交按钮禁用并显示忙碌状态 | 页面状态 |

## 跳转

- 可前往：`/register`。
- 成功登录前往用户原本访问的受保护路径及查询参数（如文件搜索、上传目标和分享创建）；只接受校验过的站内目标，缺失或无效时回 `/`。

## 特殊说明

- 认证接口使用 `credentials: include`；access/refresh Cookie 为 HttpOnly，浏览器脚本无法读取。
- 启动时调用 `GET /api/v1/auth/me` 恢复登录态；access 过期时客户端单飞调用 `/refresh` 再重试。
- 表单采用 Arco `Input`、`Input.Password`、`Button` 和 `Alert`，保持品牌布局与独立路由链接；密码显隐继续由有独立埋点的语义按钮控制。`data-agent-id` 与 `data-agent-ignore` 在 Arco 渲染后的原生输入节点上。
- PC/H5 已使用与首页一致的白色画布、细边框、低饱和绿与深色按钮；“走过的路，值得被记住”及左侧旅行插画仅是品牌展示，不承载用户真实足迹。
- 找回密码 API 尚未实现，所以页面不显示失效的“忘记密码”入口。
