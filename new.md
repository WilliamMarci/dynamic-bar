# Dynamic Bar 新增内容测试清单（new.md）

> 使用方式：注销并重新登录 Wayland GNOME 50 后，从 A 到 I 逐项测试，通过打 `[x]`，失败在旁边写现象。schema 已重新编译；本清单覆盖前几轮全部新增内容，不只本轮。
>
> 快速准备：
> - `make -C ~/.local/share/gnome-shell/extensions/dynamic-bar@william-marci/tools`
> - 确认软链接：`ls -l ~/.local/bin/island`
> - 查看日志：`journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i 'dynamic bar'`

## A. 基础加载

- [x] 重新登录后扩展自动加载，journal 无 JavaScript 异常。
- [x] 折叠态只显示短白条；hover 时变长约 2 倍；点击展开动态岛。

    >   ~~[!NOTE]~~
    >
    >   ~~变长1.5倍既可~~ → 已修复：`bar-long-width` 默认改为 108（1.5×），可在 Fine tune 调整。
- [x] 再次点击 / 点击外部可收起；全局快捷键（默认 `<Super><Shift>b`）能开关。

## B. 动画与几何（第 1、3 轮）

- [x] 展开时 island 上沿始终贴在 Panel 底边固定不动，只有下沿向下“生长”。
- [x] 展开过程中动态条与左右状态图标始终跟随 island 底沿移动，无横向跳动。
- [x] 收起第一段：island 高度收回，bar 保持当时的水平位置和长度。
- [x] 收起第二段：内容清空后 bar 才决定最终宽度并从中心动画到位；结束位置精确居中。
- [x] 在 Fine tune 关闭 “Popup animations” 后，最终状态与几何和开启动画时完全一致，只是不过渡。

## C. Shortcuts 设置页（第 2 轮）

- [x] 设置里出现独立的 **Shortcuts** 页，Content 页不再有快捷键区。
- [ ] 点击快捷键行可录入新组合键；显示为人类可读（如 `Shift+Super+B`）。

    >   ~~[!WARNING]~~
    >
    >   ~~此处没法录入一些组合,如Shift+Super+A之类的,推测是下面的修饰逻辑出错(至少等用户按完吧)~~ → 已修复：录入器现在只按最终非修饰键判定，按住修饰键时不再报错；新增手动输入框（如 `<Super><Shift>b`）绕开被 Shell 抢先的 Super 组合。
- [ ] 只按普通字母（无修饰键）被拒绝，并显示明确原因。
- [ ] 只按修饰键、或非法组合被拒绝。
- [x] `+` 可新增一条；重复组合会提示已占用；垃圾桶清空；撤销按钮恢复默认。
- [x] 修改后不注销即可生效。

## D. 媒体播放（第 2、3 轮）

- [x] 折叠态：bar 显示轨道与播放进度（不同透明度白色）。
- [x] **展开态：bar 仍然显示进度**（这是本轮 #1/#3 修复点）。

    >   ~~还是改回去, 但是从不显示进度到显示进度的过程中, dynamic bar需要有生长动画.~~ → 已修复：展开态恢复为纯长条不画进度；进度重新可见（收起/被动展开）时填充从 0 生长出来。
- [x] 暂停时 bar 保留最后进度，不回落；进度刷新是快速缓动而不是每 2 秒瞬跳。
- [x] 切歌：进度从末尾快速回到开头；出现约 10px 高的滚动 small notification“艺术家 - 曲名”。

    >   ~~small notification 的高度改成可调, 字体, 大小,也是可调.~~
    >   ~~然后需要注意, 媒体播放时需要在notification的文字前面加个音乐字符~~
    >
    >   已修复：Fine tune 新增 Notifications 组（高度、字号）；媒体切歌 small notification 前缀改为 `♪`。 
- [x] 展开面板显示歌名、艺术家/专辑、播放控制、进度条、播放源；文字不省略号，超长往返滚动。
- [x] 可 seek 时拖动进度条释放会调用 MPRIS SetPosition；不可 seek 时只读进度条仍显示其他信息。
- [x] 无封面时布局正常；有封面时封面在左侧。
- [x] 播放器缺失 `mpris:length` 时 bar 仍显示激活轨道，面板仍可展开。

## E. 卡片与控制条（第 3 轮，重点）

- [x] media + Live Activity 同时存在时，底部圆点可在两者间切换，切换后 island 重新测量宽高。
- [x] 单卡片时展开键居中；多卡片时圆点居中、展开键让位并**贴右对齐**。

    >   ~~[!WARNING]~~
    >
    >   ~~并不会, 这几个需要在~~ → 已修复：控制条改为「固定 38px 左右边格 + 中间自适应」三段布局，圆点恒居中、展开键恒贴右（多卡片时）；另加了控制条上下留白。
- [x] 展开键是**更粗、圆头**的 V 形（自绘 chevron），不是细线 symbolic。
- [x] 控制条整体在卡片内容**上方留出间距**、下方留白更小。
- [ ] 点击展开键在卡片下方展开默认 Launcher 按钮；再次点击收回；launcher 改动后宽度随之变化。

    >   ~~[!CAUTION]~~
    >
    >   ~~这里做反了,实际上应该是点击按钮后在这个按钮的下方展开默认 Launcher~~ → 已修复：deck 顺序改为「卡片 → 控制条 → 附加页」，Launcher 现在在展开键下方展开。
- [ ] 滚轮在窄控制条上可切换卡片。
- [ ] 卡片 API：新增卡片只提供 `createActor` 工厂（`providers/cardDeck.js` 的 `addCard`/`setAttached`），没有为每种部件重写导航/测量。

## F. Live Activity / island CLI（第 1、2、3 轮）

- [ ] `island demo`：圆点出现，展开列表行是单行 `title | 进度条 | 百分比 | 控件`，进度条与播放器同款圆角。

    >   ~~[!CAUTION]~~
    >
    >   ~~打开后没有列表，按道理来说应该和播放器控件一个行为，但是现在什么都没有~~ → 已修复（待复测）：activity 进度条改为与媒体一致的普通 `St.DrawingArea` 工厂，移除了导致列表创建失败的 GObject 子类。

    >   [!TIP]
    >
    >   ~~demo再加一个progress demo, 时长20s,方便测试~~ → 已加：`island demo progress`（20 秒）。
    >   已实现（待复测）:
    >   ~~Shift+点击任意一个Activity dot, 需要将dynamic bar固定层现在这个. 然后对应的dot下方有个小白三角(8px等腰, 淡影子)指着它~~ → Shift+点击固定该任务进度，dot 下方出现向上指的小三角；再次 Shift+点击取消。
    >
    >   ~~点一下dot, 会弹出list, 然后在list中闪一下那个对应的选项(并框选中)~~ → 普通点击优先切到对应卡片（timer/removable/printing/live）并让该行高亮闪烁约 1.4 秒。
    >
    >   ~~这种任务执行时的dynamic bar的进度条,已完成部分是主题色+主题色对应的暗色的动态斜纹进度条(主题色可设置)~~ → activity 行与固定的 bar 进度都使用主题/状态色 + 暗色动态斜纹，颜色由 Fine tune 的 Activity 颜色控制。
- [x] `island run` 一个无进度输出的命令：进度条显示持续滚动的**不确定高亮**，而不是停在 0%。
- [ ] 命令行输出 `50%` 之类：进度条变为 determinate，且百分比变化带缓动。
- [ ] 暂停中的任务保留进度，不回落。
- [x] 完成行：圆点绿色、白色外环绘制在圆点**外侧**；`completed` notification 有左右留白。
- [ ] 失败/`island run` 退出非 0：卡片显示 exit code、最后一行摘要、Open Log、Retry。
- [ ] 点 Retry：由 wrapper 自己重启原命令（Shell 只回传 activityId+actionId），任务卡片重新变 running。
- [ ] 停止追踪按钮：只把任务移出列表，不影响正在运行的进程；`Dismiss` 后进程仍在。
- [ ] 点击行 hover 区域尝试把终端窗口提到最前（见 I 的限制）。
- [ ] 危险动作（End/Cancel/Eject）第一次点击变 Confirm，2.5 秒内二次确认才执行。
- [ ] `island` 在扩展未运行时仍执行原命令、透传输出并保留退出码。
- [ ] `island help/list` 正常；日志写入 `~/.cache/dynamic-bar/logs/`、去 ANSI、超过 1 MiB 轮转一次。

## G. Activity 圆点 / Fine Tune（第 3 轮 #5）

- [x] Fine tune 出现 “Activity dots” 组：尺寸、命中范围、hover 放大、外环宽度、running/success/paused/warning/error 颜色。
- [x] 指针靠近圆点附近并稍作停留后，圆点带缓动放大；移开恢复，hover 有外圈反馈。
- [x] 修改颜色/尺寸后圆点与 activity 进度填充颜色同步变化。
- [x] 运行中橙色、完成绿色带白外环、暂停灰色、warning/orphaned 黄色、error/cancelled 红色。

    ~~点击dot后,如果鼠标没有移开, 那进度就应该一直在.~~ → 已修复：指针停留在 activity 圆点上时预览进度持续刷新，不移开就不结束。~~待办：Timer 自己的 island page。~~ → 已加：有 timer 任务时 Live Activity 提供独立 `timer` 卡片页（同理还有 `removable`、`printing` 页）。

## H. 系统事件（第 1 轮，开关默认见 schema）

- [x] Timer：`island timer 1m`，Pause 后一秒刷新停止，Resume 按剩余时间重建，Skip/End 清理且完成/取消通知正常；无 timer 时无刷新源。
- [ ] 打印（需真实 CUPS）：开关实时生效；任务显示 `N/?`，Pause/Resume/Cancel 可用；缺纸/离线/卡纸发高优先级通知。
- [x] U 盘（需真实设备）：插入 small notification；Open、Unmount/Eject 可用；不虚构写入进度。

>   ~~[!NOTE]~~
>
>   ~~这里要改成一般的notification, 而且它的activity dot应该是外面有一圈颜色(能读取是一种, 未挂载成功的是另一种颜色,  比如蓝/绿, finetune中应该有)~~
>   ~~由于没有他的island page(类似于media control和activity list )~~
>   ~~另外拔出时没有提示~~
>
>   已实现：插入/安全移除/拔出都发一般 notification；圆点外环用 `removable-mounted-color`（默认蓝，已挂载）与 `removable-unmounted-color`（默认绿，已移除），Fine tune 可改；Live Activity 新增独立的 Removable 卡片页；安全移除会提示“可以拔出”。

- [x] 通知转接：默认关闭；打开后只发 small notification，忽略列表内的 app 不转发。

    >   没法编辑忽略列表 → 已修复：Content 页新增 “Notification filter” 分组，可逐条增删 application ID（`notification-filter`）。
- [x] 蓝牙连接/断开两行通知；充电/放电/低电量通知与呼吸点；锁定键通知与右图标区小锁。
- [ ] `notifications-enabled` 关闭后不再弹扩展 notification（Launcher 的铃铛按钮可切换）。

## I. 已知限制与失败解释

- [ ] 终端激活失败是预期的：通过 `/proc` 祖先链匹配窗口 PID。SSH/远程、部分 Flatpak 沙箱终端、tmux 分离窗口时 PID 对不上，会静默不动作（不影响任务）。若本地终端也点不动，请记录终端类型。
- [ ] 打印无法从 CUPS notifier 载荷区分提交用户，目前消费广播任务。
- [x] media + Live Activity 已成为同级卡片；默认 Launcher 仍是底部展开的附加页（沿用规范 line 115）。
- [ ] Activity JSON Schema 已补齐输入字段；未知字段仍被忽略。

## J. 回归检查

- [x] `git diff --check`、所有 JS `node --check`、`glib-compile-schemas --strict --dry-run schemas`、`make -C tools clean all`、C++ SDK 编译均通过。

# 已知问题

-   带activity dot的时候,small notification会位移 → 待复测；本轮未定位到根因，若仍在请记录展开内容与是否含 media。
-   ~~activity list 未能正常加载任何内容~~ → 已修复（待复测）：进度条子类导致创建异常，已改为普通 DrawingArea 工厂。
-   ~~island tab没有能正常管理, 另外那几个“默认 Launcher”展开控件应该是在island层来管理行为, 不然tab出错排版就乱了.~~ → 已重构：`IslandCardDeck` 提升到 `dynamicBar.js`（island 层），各 provider 只实现 `getCards()` / `getAttachedPage()`，导航/对齐/测量统一由 island 管理。
-   暂时没法测试打印机

## K. 统一控件复测（第 4 轮）

- [ ] Media 与新增卡片已改用同一进度条底层；重构后的 Media 仍保持原来的白色圆角视觉、4/6px 状态高度和 seek，新增卡片以此为基准且不越过 island 边界。
- [ ] Media 可拖动时仍能 seek；不可 seek 时仍按原设计只读显示。
- [ ] Activity dot hover 约 320ms 后，底部 dynamic bar 从 0 生长到对应进度；鼠标停留期间保持，移开后恢复原进度。
- [ ] Timer running 只显示 Pause/Skip/End，paused 只显示 Resume/Skip/End；完成后不显示运行控制。
- [ ] Activity 动作均为圆形图标按钮，常态透明，hover/focus 才显示背景与文字提示；危险按钮第一次点击改为警告图标，第二次才执行。
- [ ] Timer、Live Activity、Removable、Printing 卡片使用相同的标题/百分比/动作头部和下方全宽进度条节奏，不再出现单行内容横向溢出。
- [ ] Timer/Activity 的底部 dynamic bar 使用主题色填充和暗色斜纹；running 时斜纹移动，paused 时进度与斜纹位置均冻结。
- [ ] 点击 Activity dot 切换到 Timer 卡片后，底部 dynamic bar 仍显示该 Timer 的主题色动态斜纹进度，但 bar 宽度、高度和位置不发生额外变化。
- [ ] `barBackground.js` 与 `progressBar.js` 没有绘制依赖；dynamic bar 和 island progress 分别维护自己的 actor、绘制路径与动画状态。

## L. 紧凑列表、边界与错误处理（第 5 轮）

- [ ] Activity、Timer、Device、Printing 每个条目均为单行 `title | progress | value | actions`，各列中线对齐。
- [ ] 常驻 page 总宽度可在 200–500px 调整（默认 350px），左右边距包含在宽度内；Activity 行按约 25% 标题、43% 进度、最多 5% 百分比、其余按钮排列；Media progress 保持可拖动 6px/兜底 4px，Activity/Timer/List 使用同一细条外观。notification、small notification、Launcher 独立改变 island 宽度，所有 hover 背景、进度条和按钮均位于可见背景内。
- [ ] 专用 Timer/Device/Printing 任务不在总 Activity page 重复出现；只有 Timer 时只有一个分页圆点。
- [ ] Stop tracking 可删除最后一个条目；对应 page 消失，没有其他卡片时立即显示 Launcher。
- [ ] Launcher 能容错解析简写 desktop ID（例如 `Nautilus.desktop`），优先显示 Desktop 图标；无效 desktop ID、自定义图标和启动失败均写入 journal。
- [ ] 鼠标位于 island 背景、任意卡片内容、按钮或控制条时不会触发自动收回。
- [ ] `journalctl --user -o cat /usr/bin/gnome-shell | grep '\[Dynamic Bar\]'` 能看到带模块与上下文的错误，而不是静默失败。
- [ ] 新 Activity 在开始后的前几秒让 dynamic bar 显示缩小版主题色/斜纹进度；Shift 固定 dot 后持续显示，连续更新不回零、不跳帧，暂停时仅冻结斜纹。
- [ ] Timer started 显示普通两行 notification；列表 progress 厚度可在 Fine Tune 调整；Media/Activity/Timer/Device 的 dynamic bar 颜色和斜纹可分别设置。
- [ ] Activity dots 右侧锚定：新增项在最右槽弹入并推动旧项向左；删除中间项时仅左侧 dots 向右滑动补位；普通进度更新不产生位置动画。
- [ ] Activity dots 最右端按当前帧 dynamic bar progress 的实际左端定位，展开、收缩和宽度动画中始终保持间距且不覆盖 track。
- [ ] 鼠标位于 island 任意 page 区域时可滚轮切页，单次滚动只切一次；列表 progress 垂直居中，实际 surface 高度与 Fine Tune 设置一致，不被整行拉伸。
