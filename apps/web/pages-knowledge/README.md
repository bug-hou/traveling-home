# pages-knowledge（页面知识库）

给后续的页面 Agent 读的"页面说明书"：每个页面（含全局外壳、弹层、抽屉）一个文件，描述这个页面有什么、能做什么、怎么操作。

## 维护原则

- **只写当前状态，覆盖式维护。** 页面改了就直接改对应文件，不写变更历史、不保留旧逻辑、不加"已废弃"标记。页面删除则删除对应文件和索引行。
- **文件名 = `pageId`**，与路由 `handle.agent.pageId` 一致，如 `files.md`、`map.md`。全局界面用下划线前缀：`_shell.md`、`_upload-queue.md`。
- 新增或修改页面时，**同一次改动里**同步更新本目录，不得事后补。
- 模板见 `_template.md`。

## 页面索引

| pageId | 路由 | 页面 | 文件 |
|---|---|---|---|
| `_shell` | 全站更新提示与登录后的私有工作区 | PWA 新版本提示、统一桌面/移动菜单、页面归属和来源返回规则 | `_shell.md` |
| `home` | `/` | 首页/仪表盘（真实素材及空间数据） | `home.md` |
| `login` | `/login` | 登录 | `login.md` |
| `register` | `/register` | 注册 | `register.md` |
| `account` | `/settings/account` | 账号与安全设置 | `account.md` |
| `upload` | `/upload` | 上传素材与队列（含电脑扫码授权、手机上传结果） | `upload.md` |
| `phoneUpload` | `/phone-upload/:id` | 手机免登录扫码、等待电脑批准及 COS 直传 | `phoneUpload.md` |
| `files` | `/files/:folderId?` | 文件浏览与管理，打开文件进入详情 | `files.md` |
| `map` | `/map` | 本人已定位素材点位与未定位列表 | `map.md` |
| `preview` | `/preview/:nodeId` | 私有素材预览、自动位置来源与手动标记 | `preview.md` |
| `shares` | `/shares`、`/shares/new?targetId=...`、`/shares/:id/edit` | 网盘式分享管理、状态筛选及配置 | `shares.md` |
| `publicShare` | `/s/:handle/:slug`、`/:handle/:slug` | 公开目录浏览与活动作品展示 | `publicShare.md` |

表中为应用内部路由；Lighthouse 部署在 `https://api.convenience.top/app/`，实际访问需在路由前添加 `/app`。本地开发仍使用根路径，不改变 pageId 和 Agent 埋点。现有正式页面已对齐 `design/` 的白底细框简约风格；视觉调整不改变 Agent 埋点、权限边界或业务状态。

## 埋点规范（Agent 定位元素用，全站统一）

### 属性

| 属性 | 必填 | 说明 |
|---|---|---|
| `data-agent-id` | 所有可交互元素必填 | 稳定的语义标识，Agent 靠它定位，不依赖文案、样式、DOM 层级 |
| `data-agent-label` | 无可见文字时必填 | 给 Agent 看的名称，如图标按钮 |
| `data-agent-desc` | 可选 | 补充说明，文案有歧义时才加 |
| `data-agent-danger="true"` | 不可逆/破坏性操作必填 | 删除、清空、彻底删除、取消分享等；Agent 执行前强制用户确认 |
| `data-agent-region` | 页面主要区域建议加 | 区域容器标识（如 `files.toolbar`），快照按区域分组，减少 token |
| `data-agent-ignore="true"` | 敏感内容必填 | 密码框、令牌、提取码等；快照不得包含其内容 |

### `data-agent-id` 命名

- 格式：`页面.区域.动作`，各段小驼峰，用点连接。例：`files.toolbar.upload`、`map.sidebar.yearFilter`、`login.form.submit`。
- 全局导航统一 `nav.*`，如 `nav.map`。弹层/抽屉用自己的前缀，如 `uploadQueue.header.pause`。
- 列表/表格行内的元素必须带业务 ID，**禁止用下标**：`files.row.${nodeId}.rename`。
- 同一页面内唯一；同一个动作在不同页面可以重名前缀不同。
- 位置不要埋。坐标由 Agent 运行时用 `getBoundingClientRect()` 实时计算。

### 状态表达

开关、选中、展开等状态用标准 `aria-*`（`aria-pressed`、`aria-selected`、`aria-expanded`、`aria-checked`、`aria-disabled`），不要自造 `data-agent-state`。

### 结构要求

- 用语义化元素：`button`、`a`、`input`、`select`，不要用 `div` + `onClick` 冒充按钮。
- 图标按钮必须有 `aria-label`。
- 弹窗/抽屉/下拉在 Portal 中渲染，埋点同样要加，且弹层根节点要有 `data-agent-region`。

### Arco 组件埋点备忘

Arco 复杂组件（Select、DatePicker、Dropdown、Tabs、Upload 等）的 `data-*` 是否落在"应被点击的节点"上，**首次使用时必须实测**，并把结论补到这里（覆盖式维护）；落不到的，封装一层再埋点。

| 组件 | 实测结论 |
|---|---|
| 文件页 `Select` | 实测 `data-agent-id="files.toolbar.sort"` 落在可聚焦、可点击的 `div[role="combobox"]`；`Select.Option` 的 `data-agent-id` 落在实际 `li[role="option"]`。选项浮层挂载在 `.files-app` 内，外围 `data-agent-region="files.toolbar.sortOptions"`。 |
| 文件页 `Dropdown` + `Menu.Item` | 实测菜单触发器是 `button[data-agent-id]`，菜单项是 `button[role="menuitem"][data-agent-id]`，危险选项属性保留；Menu 根节点在 Portal 中带 `data-agent-region="files.row.{nodeId}.menu"`。 |
| 文件页 `Modal` | 实测 `data-agent-region` 落在 Portal 的 `.arco-modal-wrapper`，弹窗本体是 `[role="dialog"][aria-modal="true"]`；自定义关闭、确认、取消按钮在弹窗中，名称输入打开后获得焦点。关闭后文件页将焦点还给触发器。 |
| 素材预览页 `Modal` | 实测 `data-agent-region="preview.editor"` 落在 `.arco-modal-wrapper`，有名字的 `dialog` 中经纬度输入与保存/取消按钮均落在原生节点且有 `data-agent-id`；390px 手机弹层贴底，不横向溢出。 |
| 上传页 `Modal` | 实测 `data-agent-region="upload.destination.dialog"` 落在 Portal wrapper，内层为有名字的 `dialog`；关闭、目录按钮均保留原始 `data-agent-id`，取消后焦点回到“更改目录”。 |
| 上传页 `Progress` | 内部自带 `role="progressbar"` 与当前百分比；外部包装使用有名称的 `role="group"`，避免重复进度条语义。 |
| 认证与账号页 `Input` / `Input.Password` / `Button` | 实测 `data-agent-id` 与密码输入的 `data-agent-ignore` 落在原生 `input`；提交的 `data-agent-id` 落在原生 `button[type="submit"]`。密码显隐按钮继续使用独立埋点。 |
| 文件页 `Input.Search` / `Input` | 实测搜索框 `data-agent-id="files.toolbar.search"` 落在 `input[type="search"]`（`searchbox`，可用 ⌘/Ctrl+K 聚焦）；新建/重命名的 `data-agent-id="files.dialog.name"` 落在 Modal 内自动聚焦的原生 `input`。搜索聚焦只显示外层容器品牌焦点线，不叠加输入内层边框。 |

## 与业务代码的约定（摘要，完整规则见 `.codebuddy/rules/web-agent-ready.mdc`）

- 业务动作（筛选、搜索、创建、删除等）写成 `stores/` 或 `services/` 里的独立函数，UI 事件与 Agent 工具共用，不得把逻辑只写在组件事件回调里。
- 地图 canvas 等没有 DOM 可点的区域，必须提供工具函数，并在对应页面知识文件里列出。
- 标签页处于后台时，Agent 直接执行、跳过光标动画，因此被 Agent 触发的流程**不得依赖** `requestAnimationFrame`、`transitionend`、动画结束回调来推进状态。
