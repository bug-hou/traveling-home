# 账号页

- pageId：`account`
- 路由：`/settings/account`（Lighthouse 对应 `/app/settings/account`；`/` 是首页）
- 权限：登录
- 用途：显示当前账号与会话状态，提供上传素材入口、退出登录和修改密码操作。

## 页面区域

| region | 位置 | 内容 |
|---|---|---|
| `account.header` | 顶部 | 品牌入口、退出登录 |
| `account.profile` | 主区上方 | 当前用户邮箱、昵称、角色、登录状态 |
| `account.next` | 主区中部 | 前往文件空间或上传素材页面 |
| `account.security` | 主区下方 | 打开修改密码表单 |
| `account.passwordForm` | 账号安全区内 | 当前密码、新密码、取消、保存 |

## 可执行动作

| data-agent-id / 工具名 | 类型 | 作用 | 参数 | 危险 |
|---|---|---|---|---|
| `account.header.brand` | 点击 | 返回首页 | 无 | 否 |
| `account.header.logout` | 点击 | 调用 `POST /api/v1/auth/logout` 并清除本地用户态 | 无 | 否 |
| `account.next.openFiles` | 点击 | 前往 `/files` 浏览当前用户的文件 | 无 | 否 |
| `account.next.openUpload` | 点击 | 前往 `/upload` 开始添加素材 | 无 | 否 |
| `account.security.openPasswordForm` | 点击 | 展开密码修改表单 | 无 | 否 |
| `account.passwordForm.currentPassword` | 输入 | 输入当前密码（敏感值被忽略） | 密码 | 否 |
| `account.passwordForm.newPassword` | 输入 | 输入新密码（敏感值被忽略） | 8–128 位新密码 | 否 |
| `account.passwordForm.cancel` | 点击 | 收起密码修改表单并清空当前/新密码输入状态 | 无 | 否 |
| `account.passwordForm.submit` | 提交 | 调用 `POST /api/v1/auth/change-password` | 当前密码、新密码 | 否 |

## 页面可读状态

| 状态 | 含义 | 来源 |
|---|---|---|
| 已登录 | Cookie 会话有效 | `GET /api/v1/auth/me` |
| 管理员 / 个人账号 | 用户角色展示 | `user.role` |
| 密码更新成功 | 当前浏览器保持登录，其他现有会话被撤销 | change-password API |
| 当前密码错误 | 密码修改被拒绝 | `WRONG_PASSWORD` |

## 跳转

- 未登录访问本页会跳到 `/login`，登录成功后返回原受保护路径。
- 退出 API 成功后清除本地认证状态并前往 `/login`；网络失败时保留当前会话并提示重试，不假装已退出。

## 特殊说明

- 改密输入使用 Arco `Input.Password`（显隐切换关闭），操作使用 `Button`，成功/错误状态使用 `Alert`；真实输入框保留 `data-agent-ignore`，取消改密立即清空密码状态，保存中禁止取消。
- 修改密码时不要读取或复述输入字段值。
- 移动端和桌面端由 CSS 响应式布局适配，不通过 User-Agent 判断设备，也不把设备类型当作权限条件。
