# 注册页

- pageId：`register`
- 路由：`/register`（Lighthouse 访问地址为 `/app/register`）
- 权限：公开（注册后自动登录）
- 用途：用邮箱和密码创建账号；昵称可选。第一个注册账号由服务端赋予 admin 角色，此后当前配置默认关闭注册。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `auth.header` | PC 顶部 | 品牌入口 |
| `auth.hero` | PC 左侧 | 产品介绍与装饰插画，不承载业务数据 |
| `auth.tabs` | 注册卡上方 | 登录与注册入口 |
| `register.form` | 主区 | 昵称、邮箱、密码、显示密码、提交；注册状态反馈区 |

H5 与 PC 使用同一套表单和 API，按 CSS 媒体查询切换页面布局。

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `auth.header.brand` / `auth.mobile.brand` | 点击 | 前往登录页 | 无 | 否 |
| `auth.tabs.login` | 点击 | 前往登录页 | 无 | 否 |
| `auth.tabs.register` | 点击 | 打开注册页 | 无 | 否 |
| `register.form.nickname` | 输入 | 设置昵称（可省略，最多 30 字） | 昵称 | 否 |
| `register.form.email` | 输入 | 设置邮箱 | 邮箱 | 否 |
| `register.form.password` | 输入 | 设置密码（值为敏感信息，Agent 快照忽略） | 8–128 位密码 | 否 |
| `register.form.togglePassword` | 点击 | 切换密码明文显示 | 无 | 否 |
| `register.form.submit` | 提交 | 调用 `POST /api/v1/auth/register`，成功后打开 `/` | 昵称、邮箱、密码 | 否 |
| `register.switch.login` | 点击 | 前往登录页 | 无 | 否 |
| `register.closed.backToLogin` | 点击 | 注册关闭时返回登录页 | 无 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 邮箱已注册 | 可改为登录 | `EMAIL_TAKEN` |
| 注册已关闭 | 第一个管理员注册后服务端拒绝新注册 | `REGISTRATION_CLOSED` |
| 表单字段错误 | 邮箱格式、昵称长度或密码校验未通过 | 本地 / `INVALID_INPUT` |
| 正在创建 | 提交按钮禁用并显示忙碌状态 | 页面状态 |

## 跳转

- 可前往：`/login`。
- 成功注册后，如由受保护页面跳转而来则回原站内路径及查询参数；否则前往 `/`。返回地址经站内校验，后端会设置 Cookie 并返回公开用户资料。

## 特殊说明

- PC/H5 与登录页共用已确认的极简视觉；品牌插画为静态装饰，不代表真实用户素材或已开通能力。
- 当前没有“查询注册开关”接口，注册是否开放以注册 API 的响应为准。
- 注册页不会在前端假定一定开放；遇到 `REGISTRATION_CLOSED` 会显示关闭状态。
- 表单采用 Arco `Input`、`Input.Password`、`Button` 和 `Alert`，昵称/邮箱/密码错误分别关联真实输入节点，校验失败时聚焦首个错误；密码显隐继续使用独立埋点按钮。
- 密码字段已标记 `data-agent-ignore="true"`，禁止页面 Agent 读取或回显密码。
