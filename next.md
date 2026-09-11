# Dynamic Bar 下一步功能选单

本文用于选择后续实现方向，不代表所有项目都要实现。选择时优先考虑 Dynamic Bar 的定位：

> 展示正在发生、会结束、值得短暂关注并且可以操作的事情。

不重复已有 Panel、Quick Settings 和其他扩展已经做好的常驻功能。暂不考虑 CPU/内存/温度/网速仪表、天气、普通电量、麦克风/摄像头常驻提示、完整通知中心、Todo 和新闻。

## 选单

在准备实现的项目左侧填写 `[x]`。建议每轮只选择一个基础设施项目和一至两个用户功能。

### 基础设施

- [x] `A1` Activity 生命周期、恢复与清理
- [x] `A2` Activity Action 与安全回调协议
- [x] `A3` 任务日志、失败摘要与 Retry
- [x] `A4` 不确定进度与阶段式进度
- [x] `A5` Activity 分组、优先级与卡片排序
- [x] `A6` 第三方 SDK、协议文档与调试工具

### 系统事件

- [x] `B1` Timer / Pomodoro
- [x] `B2` 打印任务
- [x] `B3` U 盘、挂载与安全弹出
- [ ] `B4` VPN、热点与网络异常事件
- [ ] `B5` 软件更新、安装与重启需求
- [ ] `B6` 防止休眠任务与 inhibitor 状态
- [ ] `B7` 截图完成后的快捷操作
- [x] `B8` 通知转接

### 开发者与创作工作流

- [ ] `C1` 浏览器下载桥接
- [ ] `C2` Dev Server / localhost 服务
- [ ] `C3` 测试结果卡片
- [ ] `C4` Git 操作与冲突状态
- [ ] `C5` Docker / Podman Compose 任务
- [ ] `C6` ffmpeg / Blender / 渲染任务适配器
- [ ] `C7` systemd user job 接入

### 暂缓区

以下方向只有在用户明确需要且现有插件无法满足时再考虑：

- 日历和会议：可能与日历扩展重复，并引入 EDS、CalDAV 或 OAuth。
- 手机联动：优先由 GSConnect/KDE Connect 提供，只考虑消费其 Activity 事件。
- Slack、邮件、GitHub 通知：容易变成第二个通知中心。
- 剪贴板历史和敏感信息识别：隐私风险高，也常与剪贴板扩展重复。
- 系统性能异常：现有监控插件已经覆盖，除非未来只接收它们主动上报的告警。
- 麦克风、摄像头和屏幕共享：Panel 已有提示，除非提供 Panel 没有的明确操作或来源信息。

---

# 各选项设计

## 本轮实现记录

已勾选的 A1–A6、B1–B3、B8 已落入代码：Activity v2 协议与持久化、回调动作、分组排序和四类进度位于 `providers/liveActivity.js`；CLI、日志和适配器位于 `tools/`；协议与 SDK 位于 `protocol/`、`sdk/`；Timer、CUPS、VolumeMonitor 和通知转接分别由对应 Provider 提供。

本轮补做：island 展开改为上沿固定的高度生长动画、收起保持二段式；新增独立 Shortcuts 设置页与按键录入校验；`island run` 失败卡片提供由 wrapper 分离监听进程执行的 Retry；provider 自有 activity 使用 `heartbeat: false` 避免误判 orphaned；用户点选的卡片短时间内保持优先；CUPS 按 notifier 真实的 6/11 参数信号解析；Activity JSON Schema 补齐输入字段。

第二轮 UI 修复：媒体展开态保留 bar 进度并在刷新时缓动；activity 进度条与媒体播放器复用 `progressBar.js` 同一绘制实现；activity 行改为单行“title | 进度条 | 百分比 | 控件”；不确定/无进度任务默认滚动高亮；暂停保留进度；activity 圆点改为外环并由 Fine Tune Activity 组配置尺寸、颜色、hover 放大与命中范围；完成后 notification 补上模块声明的左右留白；多页控制条展开键改为贴右对齐。

第三轮：新增统一容器 `providers/cardDeck.js`（`IslandCardDeck`），媒体与 Live Activity 改为同级可切换卡片，Launcher 为底部附加页；展开键改为自绘粗圆头 V 形并调整控制条上下留白；`IslandControlContainer` 删除。测试清单见 `new.md`。

第四轮：把 `IslandCardDeck` 提升到 `dynamicBar.js`（island 层），provider 只实现 `getCards()`/`getAttachedPage()`；Timer/Removable/Printing 有独立卡片页；U 盘改用一般 notification、圆点外环区分挂载状态并可配置、安全移除/拔出提示；notification 忽略列表改为可增删；activity 行与固定 bar 进度使用状态色+暗色动态斜纹；普通点击圆点切换并高亮对应行，Shift+点击固定 bar 进度并在圆点下显示小三角。测试清单见 `new.md`。

仍需注销登录 Wayland GNOME 50 实机验证：展开/收起动画的每帧锚点、快捷键修改即时生效、Retry 完整链路、心跳与功耗、CUPS 与打印开关、真实 U 盘与通知转接。媒体卡片与 Live Activity 卡片目前仍是“媒体内容 + 底部附加页”结构，尚未改成同级可切换卡片。打印任务暂无法从 notifier 载荷区分提交用户，只能消费广播任务。

## A1 Activity 生命周期、恢复与清理

### 目的

让 Live Activity 在 GNOME Shell 重启、扩展重载或上报进程异常退出后仍保持一致，而不是留下永久圆点或直接丢失任务。

### 模型

状态统一为：

- `running`
- `paused`
- `success`
- `warning`
- `error`
- `cancelled`
- `orphaned`
- `expired`

每项包含 `createdAt`、`updatedAt`、可选 `expiresAt` 和来源实例标识。运行方定期发送低频 heartbeat；超过期限转为 `orphaned`，不能擅自标记失败。

### UI

- running：橙色圆点。
- paused：灰色圆点。
- success：绿色圆点，延迟后自动清理。
- error：红色圆点，用户确认或超时后清理。
- orphaned：黄色圆点，卡片提供 Dismiss。

### 实现边界

只持久化 Activity 元数据，不保存敏感环境变量和完整命令输出。

## A2 Activity Action 与安全回调协议

### 目的

统一 Pause、Resume、Cancel、Open、Retry 和 Dismiss，不让 Shell UI 直接执行来源提供的任意命令字符串。

### 协议

来源注册 action：

```json
{"id":"cancel","label":"Cancel","icon":"process-stop-symbolic","kind":"callback"}
```

点击后，扩展只通过 D-Bus 回传 `activityId + actionId`。由任务所有者决定具体行为。内部只允许白名单 action，例如 `dismiss` 和 `open-settings`。

### UI

主动作最多两个，其余进入菜单。危险动作使用 destructive 样式并要求第二次确认。

## A3 任务日志、失败摘要与 Retry

### 目的

让 `island run` 在任务失败时给出有用信息，而不只是 exit code。

### 数据

- 在运行时写入独立日志文件。
- D-Bus 只传输最后一条摘要和日志路径。
- 默认限制文件大小并轮转。
- 自动过滤常见 ANSI 控制序列。

### UI

失败卡片显示 title、exit code、最后一条非空输出，并提供 Open Log、Retry、Dismiss。

### 风险

日志可能包含 token 或路径。默认不把正文写入 GSettings，也不在 notification 中显示未经处理的多行内容。

## A4 不确定进度与阶段式进度

### 目的

处理 npm、测试、压缩等没有可靠百分比的任务，避免进度永远停在 0%。

### 类型

- `determinate`：0–100%。
- `indeterminate`：循环流动光带。
- `steps`：第 N/M 阶段。
- `elapsed`：只显示运行时间。

兼容器只能在有可靠证据时输出 determinate，不能伪造百分比。

## A5 Activity 分组、优先级与卡片排序

### 目的

避免同时运行大量任务时出现一排圆点和过长列表。

### 规则

- 默认按 `source + type` 分组。
- 折叠态每组一个圆点，而不是每个任务一个圆点。
- 卡片内展示组摘要和任务列表。
- error、需要交互、即将结束的项目优先。
- 用户手动选择的卡片短时间内保持，不被低优先级事件抢走。

## A6 第三方 SDK、协议文档与调试工具

### 目的

让其他程序接入 Activity，而不要求理解 GNOME Shell 内部实现。

### 交付物

- 稳定的版本化 D-Bus XML。
- `island start/update/done/fail/dismiss` 命令。
- JSON Schema。
- Bash、C++ 示例。
- `island inspect` 查看当前 Activity。
- `island demo` 生成可重复测试数据。

协议必须声明版本和 capability，旧客户端不能因为新增字段失效。

## B1 Timer / Pomodoro

### 行为

- 创建倒计时、番茄钟或秒表。
- 折叠态圆点和临时进度。
- 展开显示剩余时间、Pause、Resume、Skip、End。
- 完成时发送 notification，可选择播放声音。

### 实现

使用 monotonic time 计算，不依赖每秒累加，系统休眠或 Shell 卡顿后仍保持准确。没有活动计时器时完全停止刷新。

### 重复控制

如果用户已有 GNOME Clocks/Pomodoro 扩展，优先做成接收其 D-Bus Activity，而不是再实现一套计时器。

## B2 打印任务

### 数据源

CUPS/IPP。只监听当前用户提交或明确可见的打印任务。

### UI

- 文档名、打印机、页数或状态。
- Pause、Resume、Cancel。
- 缺纸、离线、卡纸时发送高优先级 notification。

### 价值

打印是会结束、有进度且需要处理错误的后台过程，通常不会与 Panel 功能重复。

## B3 U 盘、挂载与安全弹出

### 数据源

`Gio.VolumeMonitor`，事件驱动，不扫描设备目录。

### UI

- 接入时 small notification。
- 卡片显示卷名、容量、Open、Unmount/Eject。
- 正在写入时不能虚构复制进度；只显示 Busy。
- 安全弹出成功后显示完成提示。

### 风险

不能把“卸载完成”当成设备已经物理断电；需区分 unmount、eject 和 drive stop。

## B4 VPN、热点与网络异常事件

### 数据源

NetworkManager D-Bus。

### 只展示事件

- VPN 连接或意外断开。
- 热点启动/关闭。
- Captive Portal 需要认证。
- 网络从在线变成离线。

不常驻显示 Wi-Fi 名称、信号和网速，避免与 Quick Settings 及网络监控插件重复。

## B5 软件更新、安装与重启需求

### 数据源

优先 PackageKit 和 Flatpak transaction；发行版命令由 `island run` 兼容层处理。

### UI

- 下载、安装和清理阶段。
- 错误摘要。
- Open Software、Restart、Later。

### 限制

扩展自身不提权、不保存密码、不直接执行未经用户确认的系统升级。

## B6 防止休眠任务与 inhibitor 状态

### 行为

显示当前由 Live Activity 持有的 suspend inhibitor，以及明确阻止休眠的应用。

### UI

```text
Rendering video
Keeping the system awake · 38 min
```

任务结束或失败时必须释放 inhibitor。只有用户或 Activity 明确要求时才阻止休眠。

## B7 截图完成后的快捷操作

### 行为

截图完成后短暂显示 Copy、Open、Show in Files、Annotate。

### 实现边界

优先使用 portal 或稳定公开接口。若只能依赖 GNOME Shell 私有截图接口，则放入版本兼容层，并允许单独关闭。

## B8 通知转接

### 行为

所有的通知都发一个small notification（可以设置开启/关闭）

### 实现边界

把gnome的通知转发，并可以设置filter（比如不想看从某个应用发的可以屏蔽）

## C1 浏览器下载桥接

### 架构

Firefox/Chromium WebExtension → Native Messaging Host → Activity D-Bus。

### UI

文件名、来源、已下载/总大小、Pause、Resume、Cancel、Open。

### 风险

需要分别维护浏览器扩展和原生桥接，不应通过轮询 Downloads 目录猜测状态。

## C2 Dev Server / localhost 服务

### 行为

通过 `island run` 或编辑器插件显式注册服务地址、项目名和停止回调。

### UI

```text
Vite · project-name
localhost:5173 · Running
Open · Copy URL · Stop
```

不默认扫描所有监听端口，避免误报系统服务或泄露其他用户进程。

## C3 测试结果卡片

### 兼容层

优先读取 JUnit XML、pytest JSON、Cargo JSON 和 TAP；纯终端文本解析仅作兜底。

### UI

- 运行中：已完成/总数。
- 成功：passed、skipped 和耗时。
- 失败：failed 数量、首个失败测试、Open Report、Retry。

## C4 Git 操作与冲突状态

### 行为

只跟踪通过 `island run git ...` 或编辑器主动上报的操作，例如 clone、fetch、push、rebase。

不根据活动窗口猜测工作目录，不做常驻 branch/dirty 状态栏。

## C5 Docker / Podman Compose 任务

### 行为

- compose pull/build/up 的过程。
- 服务 unhealthy、重启循环或异常退出。
- Open Logs、Restart、Stop。

### 安全

容器 socket 权限很高。数据收集应放在用户侧 helper 中，Shell 扩展只消费规范化 Activity。

## C6 ffmpeg / Blender / 渲染任务适配器

### 行为

- ffmpeg 读取 `-progress pipe:1`，不解析面向人的动态终端输出。
- Blender 使用脚本或渲染回调。
- 显示帧数、预计剩余时间和输出路径。
- 完成后提供 Open Output。

## C7 systemd user job 接入

### 行为

允许选定的 user unit 主动映射为 Activity：starting、running、failed、restarting。

默认不展示全部 user unit。用户必须显式选择或由 unit 添加 Dynamic Bar 元数据，避免与系统服务监控重复。

---

# 选择建议

如果优先完善平台，建议选择：

```text
A1 + A2 + A4 + A6
```

如果优先做一个普通用户能立即感知、且不与 Panel 重复的版本，建议选择：

```text
B2 + B3
```

如果优先强化开发者定位，建议选择：

```text
A3 + A4 + C2 + C3
```

如果只想先做一个低风险功能验证完整交互，建议选择：

```text
B1
```
