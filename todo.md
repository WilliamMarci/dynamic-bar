# Dynamic Bar 待办事项

> 2026-09-11 暂停点。当前工作树包含尚未提交的修改；继续开发前先运行 `git status` 和 `git diff`，不要覆盖这些改动。基线提交为 `e74d95f feat: establish dynamic bar activity platform`。
>
> 实现 pass 已完成：动画锚点、Shortcuts 页面、Retry、心跳语义、CUPS 信号、Schema 与静态检查。所有标 `[ ]` 的项目均需要在 Wayland GNOME 50 注销重登后由用户实机反馈。

## P0：恢复开发后首先处理

- [x] 修复 island 展开动画的锚点：展开/“生长”时，与 Panel 底边相接的上沿必须固定，不能让整个 island 基部上下移动。建议把当前整体 `translation_y` 滑入改为以上沿为 pivot 的裁剪/高度或 `scale_y` 动画；背景和内容必须同步，收回的二段式 bar 动画不能退化。
- [x] 新增独立的 **Shortcuts** 设置页，将现有快捷键区从 Content 页移走。
- [x] 快捷键页面允许录入、修改、清空和恢复默认全局快捷键；显示人类可读的组合键，并使用 `Gtk.accelerator_parse` / `Gtk.accelerator_valid` 拒绝无效或危险的单键绑定。
- [ ] 修改动画后重点回归：展开时 island 上沿固定、bar 跟随 island 底沿、折叠第一段不横跳、第二段才决定 bar 最终宽度、左右状态区始终跟随 bar。

## 当前未提交功能：完成与审查

- [x] 审查 `providers/liveActivity.js` 的 Activity v2 生命周期：running、paused、success、warning、error、cancelled、orphaned、expired；确认 heartbeat 超时只转 orphaned，Shell 重启恢复不误报失败。Provider 自有任务使用 `heartbeat: false`，暂停中的 timer 与挂载不会被误判。
- [x] 完成 Action 协议：主动作最多两个，其余进入 More 区；危险动作二次确认；第三方 action 只回传 `activityId + actionId`，Shell 不执行任意命令。
- [x] 为 `island run` 的失败卡片实现真正可用的 Retry。Retry 必须由任务所有者/安全回调重新启动，不能让 Shell 执行客户端传入的命令字符串。实现方式：wrapper 失败后留下分离监听进程，收到 `ActionRequested(id, "retry")` 后自行重启原参数。
- [x] 验证日志行为：过滤 ANSI、最后一条非空摘要、日志目录 `~/.cache/dynamic-bar/logs/`、1 MiB 上限、一份轮转、Open Log。已用 >1 MiB 输出实测轮转。
- [x] 验证四类进度：determinate、indeterminate 流动光带、steps 的 `N/M` 或 `N/?`、elapsed；无可靠证据时不得伪造百分比。
- [x] 验证按 `source + type` 分组后的折叠圆点、组内任务列表、状态/priority/更新时间排序；补齐“用户手动选择卡片后短时间不被低优先级事件抢走”。
- [ ] 确认媒体卡片、Live Activity 卡片和 Launcher 附加卡片在通用窄容器中是同级可切换页面，并且内容自然宽度变化会重新测量 island。当前仍是“媒体内容 + 底部附加页”结构，未完成同级卡片改造。

## CLI、协议与 SDK

- [ ] 回归构建 `tools/island`，验证裸 `island`、`help`、`list`、`inspect`、`demo`、`start/update/done/fail/dismiss`、`timer`。构建、裸命令、`help`、`list` 与不可用退化已通过；D-Bus 命令待扩展运行时验证。
- [x] 验证 `island [run] COMMAND` 在 D-Bus/扩展不可用时仍直接执行原命令、透传输出并保留退出码。
- [x] 验证 15 秒低频 heartbeat 不阻塞退出，不在 pipe/fork/fdopen 失败路径留下可 join 的线程；fdopen 失败已改为安全跳过读取。
- [x] 核对版本化 D-Bus XML、JSON Schema、Shell 内嵌接口三者一致；未知 JSON 字段必须向后兼容。已用脚本比对 12 个方法/信号签名，Schema 补齐输入字段。
- [x] 构建并运行 Bash、C++ SDK 示例；确认脚本可执行位已纳入 Git。`bash -n`、C++ 编译与可执行位（100755）均通过。
- [x] 检查 CMake/Make/Ninja、APT/DPKG、通用百分比适配器，确保 `island list` 与注册表来自同一数据源；已用单元断言验证解析。

## 已勾选系统功能

- [ ] Timer/Pomodoro：monotonic time；Pause 时停止一秒刷新，Resume 重建 deadline；Skip/End 正确清理 source；无活动 timer 时无刷新源；完成通知正常。
- [ ] 打印任务：验证 GNOME 50/CUPS notifier 信号签名；只消费当前用户或明确可见的任务；Pause/Resume/Cancel 可用；未知总页数显示 `N/?`；缺纸、离线、卡纸等发高优先级通知；设置开关实时生效或明确要求重载扩展。信号已按真实 6/11 参数签名重写，开关已支持实时生效；提交用户过滤无法从 notifier 载荷获得，待实机确认范围。
- [ ] U 盘/挂载：用 `Gio.VolumeMonitor` 事件驱动；Open、Unmount/Eject 可用；不得虚构写入进度；区分 unmount、eject、drive stop 与物理拔出。
- [ ] 通知转接：默认关闭；独立开关与 application ID 过滤生效；只发 small notification，不形成第二个通知中心；核对 GNOME 50 `MessageTray` API。API 已核对（`getSources`、`notification-added`），行为待实机验证。

## GNOME Shell 50 实机验收

- [ ] 注销并重新登录 Wayland GNOME 50，确认扩展能加载且 journal 中无 JavaScript 异常。
- [ ] 逐项测试 Activity demo、长命令 heartbeat、成功/失败/孤儿恢复、分组圆点、动作和日志。
- [ ] 测试 Timer 的暂停/恢复/完成和功耗，确认没有无任务时的一秒轮询。
- [ ] 有条件时测试真实 CUPS 打印机/队列、U 盘挂载与安全弹出、GNOME 原生通知转接。
- [ ] 测试设置页新快捷键：修改后无需注销即可生效；冲突或非法组合键给出明确反馈。

## 文档与 Git 收尾

- [x] 动画锚点和快捷键设计确认后同步更新 `note.md`。
- [x] 根据最终实现修订 `next.md` 的本轮实现记录，不能把未完成的 Retry、卡片选择保持或未实机验证项目描述为完成。
- [x] 重新运行：`git diff --check`、所有 JS 的 `node --check`、`glib-compile-schemas --strict --dry-run schemas`、XML/JSON 校验、`make -C tools clean all`、C++ SDK 编译。全部通过；`glib-compile-schemas schemas` 已重新生成 `gschemas.compiled` 以包含新键。
- [x] 检查 `git diff`，确保没有误改用户文件或纳入生成物（`tools/island`、`schemas/gschemas.compiled`）。
- [ ] 将本轮功能作为独立 Git 提交；提交后工作树应干净，并在交付信息中记录 commit id 与仍需用户注销登录验证的事项。等待实机反馈后再提交。
