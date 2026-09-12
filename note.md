名词定义：底部小白条的是动态条（dynamic bar）, 折叠时常显示
展开的是动态岛 Dynamic island（ex panel）

# UI设计

## 动态条

```
|（左图标区）| 动态条 | （右图标区）
```

只有动态条常态显示，图标的位置会随着动态条长度变

# 行为规定与动态

在平时仅展示静态动态条的短状态，在渲染层就不要有动态岛的任何内容（减小负担）
当激活时/hover，动态条会变长（大概2倍），点击后展开动态岛

在设置页单独一页展示fine tune， 用于微调所有参数调整效果

## 设置页

Fine tune 之外的设置分为独立页面：Content 只保留功能开关、通知过滤与 Launcher 配置；快捷键位于独立的 Shortcuts 页，不与功能开关混排。每条快捷键显示人类可读的组合键标签，支持按键录入新增或修改、单独清空以及恢复默认。录入时拒绝无效组合与危险的单键绑定，只接受带 Ctrl/Alt/Super 修饰键的合法 accelerator；修改后无需注销即可生效。

弹出/收起动画有统一总开关。关闭时状态和最终几何必须与开启动画一致，只跳过过渡过程。

## 事件模型

Provider 不应直接决定整个动态条的生命周期。动态条统一接收三类事件：

- `progress`：连续进度，常驻在 dynamic bar，例如媒体播放进度。
- `status`：持续状态，常驻在左右图标区，例如已开启的 Caps Lock / Num Lock / Scroll Lock。
- `notification`：临时提示。提示结束后必须恢复到发送前的展开状态、内容和 dynamic bar 状态，不能一律折叠。

Provider 只通过 `DynamicBarApi` 发布上述事件；API 是动画、状态恢复和几何更新的唯一入口。外部功能不得直接修改 DynamicBar actor。媒体的 D-Bus 发现、播放器选择、属性规范化和控制由独立 `MprisService` 持有，UI Provider 只消费已规范化的快照。

`activity` 是左图标区专用的常驻活动状态 API；具体哪些功能算 activity 后续定义。渲染只使用直径等于 bar 高度的圆点，折叠布局按数量自然排列为 `━━━━`、`●━━━━`、`●●━━━━`。

左右留白属于具体功能的布局，不属于统一 API 的全局策略。每个 Provider 通过 `getLayoutOptions()` 声明自己的 `paddingX`、`paddingY` 和可选最小尺寸。

## 通用窄控制容器

Island 内容统一由 `dynamicBar.js` 持有的 `IslandCardDeck` 承载：Provider 只通过 `getCards()` 注册同级可切换卡片（媒体、Live Activity、Timer、Removable、Printing 等），通过 `getAttachedPage()` 注册底部展开页（默认 Launcher）；导航、圆点分页、展开/收回、命中与重新测量都由 deck 在 island 层实现，任何功能不得再自建 tab/分页逻辑，也不得自行组装 deck。切换到某张卡片或附加页时由 `DynamicBarApi.isShown()` 判定可见性；卡片集合变化用 `cardsChanged()` 通知 island 重建并保留当前选中的卡片。

Island 底部的小型开关、分页和常驻控件统一使用 `IslandCardDeck`，不得在各功能中重复实现导航和测量逻辑。容器负责自然尺寸变化、点击、滚轮、hover/focus 状态以及向统一 API 请求重新布局。其高度统一读取 Fine Tune 的 `compact-control-height`。

单个附加页面时只显示居中的粗圆 V 图标，常态无按钮底色且与上下内容间距为 0；hover/focus 可显示轻微背景反馈。多个附加页面时，中间使用类似 Ubuntu Multi Workspace 的圆点分页器，当前页高亮，支持点击圆点以及在整个窄区域使用普通滚轮或触控板平滑滚动切换。展开/收回按钮让出中央导航位置并右对齐；展开键为自绘的粗圆头 V 形，控制条整体上方留出间距、下方留白更小。附加页在展开键下方展开。

notification 可以独立声明：

- `timeout`：展示时间。
- `passive`：被动展开；保持 dynamic bar 原来的长度、颜色和 progress，不因提示而进入 hover/主动展开状态。
- `width` / `height`：提示伸出的目标尺寸；未声明时才按内容自然尺寸计算。
- `paddingX` / `paddingY`：内容与 island 左右/上下边缘的间距。左右必须保留可见留白；短条通知可以保持横向留白，同时不抬高约 10px 的目标高度。
- `pulse`：是否在左图标区显示绿色呼吸点。呼吸点直径等于默认 dynamic bar 高度。

短 notification 统一称为 `small notification`：它是不明显的低高度提示，预留约 10px 高度。文字使用约 8px 字号；单行过长时滚动，不能用省略号代替关键信息。例如媒体切歌后，短暂显示“艺术家 - 曲名”，结束后恢复发送前状态。

dynamic bar 始终以屏幕/Panel 中心为中心改变宽度。左右图标区锚定到 bar 的两端，必须在 bar 动画的每一帧跟随移动；图标区宽度按内容自然尺寸计算，不能用固定窄框裁成 `...`。

收起使用二段式动画：第一段只把 Dynamic island 收回，bar 保持收回开始时已经显示的水平位置和实际长度，不能强制切换到预设长宽。第一段结束后清空 island 内容并重新测量 root，同时把 bar 的屏幕坐标换算回新 root 的局部坐标，避免 root 尺寸变化造成跳动。第二段再根据当前 hover/折叠状态判断是否需要改变长度并从中心动画到目标。第二段结束时必须按 primary monitor 中心重新写入精确的 x/width/y。

展开使用单段生长动画：island 上沿固定在与 Panel 底边相接的位置，只向下改变高度；内容 holder 与 island 同步裁剪，bar 和左右状态区跟随 island 底沿移动。禁止再用整体 `translation_y` 滑入，否则 island 基部会上下移动。关闭弹出动画总开关时只跳过过渡过程，最终状态与几何必须与开启动画完全一致。

左右状态 actor 在各自区域内朝 bar 一侧对齐。图标与 bar 的视觉距离不得受对称占位区影响；SVG 自身留白与 actor 分配留白需要分别排查。

状态图标与 dynamic bar 必须共享同一条水平中线，包括折叠过程和最终折叠态。展开态可以为正常尺寸状态区在 Panel 底边上方预留顶部空间；折叠态不得因为状态图标把 bar 推离 Panel，锁图标在收岛时通过淡出/淡入过渡成直径等于 bar 高度的实心圆点，并取消折叠态顶部预留。

横向中心以 primary monitor 为准，不能使用可能被 Dash to Panel 改写的 `panelBox.width`。折叠态和展开态的 bar 中心必须相同。progress 的轨道和填充都使用圆角路径，填充在任意百分比处的末端也必须是圆的。

# 功能

## 0. 默认

在默认情况下，点击白条会展开动态岛，在panel中展示一排按钮圆角矩形
固定的应用们| 固定的功能按钮|dynamic extension 设置， 动态岛的宽度随着固定内容而定。单独一页设置页用于自定义内容

## 1. 媒体播放 Now Playing

#### 折叠时

静态条进入激活态，显示一个小白条，有轨道颜色和播放进度颜色（默认可以是不同透明度的白色）
切换媒体时，会有一个很快的动画，把进度条从末尾变到开头；同时发送一个约 10px 高的被动 notification，滚动显示“艺术家/作曲家 - 曲名”，等 fade_time 后恢复此前状态。媒体切歌不默认显示绿色呼吸点。

### 展开态

灵动条仍是长条状态，并继续显示当前播放的轨道与进度；暂停时保留最后一帧进度而不回落。进度刷新用快速缓动衔接，不能每次刷新都瞬跳。

显示：

-   歌名
-   艺术家
-   播放进度
-   暂停/下一首
-   播放源

灵动岛显示一个进度条（控件），布局是如果有封面数据，一个圆角正方形块显示封面，旁边是大一些的歌名。下面是暗一些的字体，艺术家 | 专辑 ，再下面是播放控件和进度条控件。

媒体面板文字区左对齐，顺序为标题、艺术家/专辑、播放控制、进度条；播放控制在文字区下方并相对文字区水平居中，播放源独立右对齐，不能把按钮组挤离中心。有封面时，封面位于上述内容左侧。点击上一首/播放暂停/下一首属于面板内交互，至少保持展开一段时间，不能因 hover 瞬时变化马上消失。播放器同时提供 `CanSeek`、track id 与有效时长时，进度条可按下拖动并在释放时调用 MPRIS `SetPosition`；条件不满足时仍绘制只读进度条并完整显示其他媒体信息。

播放模式下，媒体面板最底部常驻一个窄而扁的控制条。单个附加常驻控件时，中间只显示较粗、圆润的 V 图标，不绘制常态按钮背景；hover/focus 时保留轻微背景反馈。图标与上下内容间距为 0。点击后在媒体内容下方展开默认 Launcher Provider 的按钮内容，再次点击收回；展开内容必须复用默认 Provider，不能复制 launcher 配置或按钮创建逻辑。附加内容的自然宽度参与 island 重新测量，因此 launcher 应用数量、按钮尺寸或默认布局变化时，整个 island 的宽度与高度同步变化。

媒体必须有故障兜底：MPRIS 初始化失败不能阻止整个扩展启用；媒体 Provider 创建 UI 失败时，点击 dynamic bar 自动回退到默认 launcher。播放器正在播放但没有提供 `mpris:length` 时，bar 仍显示激活的静态轨道，媒体面板仍可展开。

MPRIS registry 使用 `NameOwnerChanged` 事件增删播放器，不能每秒扫描 session bus。只有 active player 处于 Playing 时才启动约 2 秒一次的位置刷新；Paused/Stopped 时停止该计时器。

从没有播放器变为检测到播放器时，播放一次快速 activation 动画：bar 边框显示旋转渐变光效，同时进度从 0 增长到当前进度。后续位置刷新不得打断动画；切歌仍使用 small notification。

媒体标题、艺术家、专辑等字段不得因为过长而显示省略号。每个字段使用单一完整 Label 放入严格裁剪的单行 viewport，超出宽度时往返滚动；禁止拼接或复制下一条媒体文字，因此未轮到播放的内容不能从裁剪边缘露出。

## Launcher 配置

Launcher 使用结构化项目配置。设置页可逐项增加、删除，并编辑名称、是否显示名称、Desktop file ID、覆盖启动命令和 Desktop Action。图标来源分为 Desktop 原有图标、主题图标和自定义图片；主题图标通过棋盘格选单选择，自定义图片通过文件选择器设置。默认不显示名称。旧 `launcher-apps` 仅作为尚未建立结构化配置时的兼容回退。

## Live Activity

扩展库内提供无 Python 依赖的 C++ 命令包装器 `tools/island`。用户把它软链接到 `~/.local/bin/island` 后，可使用 `island [run] [-t|--title TITLE] COMMAND [ARGS...]`；`run` 默认且可省略，title 可选，省略时使用完整命令文本。`-t` 与 `--title` 完全等价，也适用于 timer。工具随附 Bash、Zsh、Fish 的 Tab 补全定义，覆盖子命令、选项、duration 示例和被包装命令。`island help` 显示语法，`island list` 从适配器注册表列出当前安装的兼容支持；裸 `island` 因没有待执行命令而显示 help。若扩展/D-Bus 暂时不可用，原命令仍必须执行，只跳过 Live Activity 上报。包装器必须直接执行参数而不是再次交给 shell 解析，透传输出和退出码，并通过 session D-Bus 向扩展发送 Start、Update、Complete。

命令输出进度解析属于独立兼容层 `tools/progressAdapters.hpp`。适配器通过稳定的具名注册 API 提供 id、匹配命令、说明与解析规则，`island list` 直接读取同一注册表。首版提供 CMake/Make/Ninja、APT/DPKG 和通用百分比适配；未来 SCP 等兼容只注册新 Adapter，不修改命令执行、输出转发、D-Bus 或 UI 层。无法识别时显示不确定进度，不能因此阻止 activity、完成状态或原命令执行。

开始时发送 small notification 并在左图标区创建 activity 圆点。圆点直径默认等于 bar 高度，完成态的白色环绘制在圆点外围而不是内侧；可挂载/已移除等状态用可配置的外环颜色区分（Fine Tune 的 Removable 色项）。圆点周围保留更大的命中区域，指针靠近并停留一小段后圆点带缓动放大，hover 时显示外圈反馈，方便点击。运行中为橙色；完成为绿色并带白色外环，同时发送带勾的 completed notification，失败则显示错误和退出码。普通点击圆点会切换到对应卡片并高亮闪烁该行；Shift+点击圆点把 bar 固定在该任务的进度上，并在圆点下方显示向上指的小三角，再次 Shift+点击取消。临时预览约 1.8 秒，颜色使用主题/状态强调色，随后恢复原 progress。

展开列表每行固定为单行水平布局：左侧 title，接着进度条，再是百分比，最后是常驻控件区。进度条必须与媒体播放器复用同一个圆角绘制实现（轨道/填充均为圆角，填充末端也是圆的），不得另写一套；暂停时保留当前进度不回落，进度变化用快速缓动过渡而不是突变；运行中的任务使用状态/主题色加暗色动态斜纹，能读取到百分比才画 determinate，否则显示持续滚动的不确定高亮条，steps 无总数时显示 `N/?`。控件区包含任务自身动作和“停止追踪”按钮：停止追踪只把任务移出追踪列表，不结束对应进程；点击行的 hover 区域尝试把对应终端窗口提到最前，无法可靠关联时静默退化。常态无背景，hover 才显示背景。Timer、Removable、Printing 各有独立的卡片页。

notification 与 Island 内容必须由模块声明 `paddingX`/`paddingY`；completed 等 notification 不得省略左右留白。底部圆点分页器居中时，展开/收回按钮必须让出中央并贴右对齐，单页时保持居中。媒体和 Live Activity 同时存在时注册为可通过底部圆点切换的常驻卡片；附加 Launcher 仍复用通用容器。

## 2. 充电提示

接入电源、断开电源（decharge/discharging）或跨过低电量阈值时发送 notification，临时替换当前内容
灵动岛显示内容，当前电量
一段时间（notification_decay）后恢复 notification 发送前的状态；发送前已展开时不能直接折叠

## 蓝牙提示

通过 BlueZ system D-Bus 对象和属性事件监听设备，不轮询。设备连接状态变化时发送两行 notification：第一行为设备名，第二行为 `Connected` / `Disconnected`，左侧使用对应的蓝牙连接/断开图标。插件级请勿打扰开启时不弹出。

## 3. 按键提示

主要是在切换大写锁定/插入键/滚动锁定/数字键盘锁定时被动展开，只展示本次发生变化的键及开启/解除状态。Shift 等普通修饰键不得触发。

其中，Caps Lock、Scroll Lock、Num Lock 启用时在右图标区分别显示独立的小锁：锁头内使用镂空描边的 `A`、滚动符号、`1`。锁和字形均由同一个绘制控件定位，不依赖主题 symbolic icon 与 Label 叠加。不显示文字缩写，图标即使在折叠态也常驻，直至对应锁定取消。

Dynamic island notification 使用原先的实心主题图标：锁定为 `changes-prevent-symbolic`，解除为 `changes-allow-symbolic`；常驻右图标区的小锁仍使用缩小后的自绘镂空锁。

## Panel 融合色

Island 使用 Panel 靠近 Island 那一侧的最终色。安装并启用 Dash to Panel 且开启自定义渐变时，应读取 `trans-gradient-bottom-color` 与 `trans-gradient-bottom-opacity`，把底部加深层（例如 20%）合成到基础 Panel 色中，而不是只复制基础背景色。

Primary monitor 上存在最大化窗口，或窗口横向铺满并贴住顶端时，Island 的最终融合色强制使用不透明 alpha；窗口离开该状态后恢复 Panel 当前透明度。

最大化背景分别提供深色与浅色两个可配置颜色，按 `org.gnome.desktop.interface color-scheme` 选择；颜色无效时才回退到当前 Panel 合成色并强制不透明。

Fine Tune 中的颜色项必须使用 GNOME/GTK 原生颜色选择面板，不能要求用户手写颜色字符串。

## Activity v2 与系统事件标准

Activity 使用版本化 session D-Bus 协议，状态统一为 running、paused、success、warning、error、cancelled、orphaned、expired。运行方以低频 heartbeat 续期；Shell 重启后仅恢复非敏感元数据，并把未结束项标为 orphaned。折叠态按 group 合并为一个状态圆点，展开态先按错误/交互需要，再按 priority 和更新时间排序。

Activity action 必须是 `activityId + actionId` 回调，Shell 不执行第三方传入的命令字符串。主动作最多两个，其余进入 More 区；危险动作二次确认。进度明确时才使用 determinate，否则使用流动的 indeterminate、`N/M` steps 或 elapsed。Provider 自有 activity（timer、打印、挂载）声明 `heartbeat: false`，不因缺少心跳被误判 orphaned；用户手动点选的卡片在短时间内保持优先，不被低优先级更新挤走。

`island run` 直接 exec 参数、透传输出和退出码，在插件不可用时照常执行原命令。失败卡片提供 Retry：由 wrapper 的分离监听进程收到 `ActionRequested(id, "retry")` 后自行重启原始参数，Shell 不生成本命令字符串。日志去除 ANSI 后写入用户 cache，单文件上限 1 MiB 并保留一份轮转；D-Bus 只保存摘要与路径。协议、JSON Schema、Bash/C++ 示例及 inspect/demo 调试命令必须同步维护。

Timer 使用 monotonic time；暂停时停止刷新，恢复后按剩余时间重建 deadline，没有计时器时不得保留一秒刷新源。打印只消费 CUPS notifier 明确广播的可见任务，不扫描队列；按 notifier 的 11 参数 Job 信号与 6 参数 Printer 信号解析，job-state 用 IPP 枚举（processing/held/stopped/canceled/aborted/completed）；页数未知显示 `N/?`，不得伪造百分比。U 盘只由 `Gio.VolumeMonitor` 事件驱动，并区分 unmount/eject 与物理断电。GNOME 通知转接默认关闭，使用独立开关与 application ID 过滤表，且只生成 small notification，不实现第二个通知中心。

Dynamic bar 与 island 内的 progress bar 是两个内部差异很大的独立组件，不能共用绘制函数、actor 或动画状态。`barBackground.js` 独立负责 bar 的几何、激活光效、常驻进度和 Activity 预览；`progressBar.js` 只负责 island 卡片内部的进度控件。两者可以遵循一致的圆角视觉语言，但实现依赖必须单向停留在各自模块内。Media 保留原来的白色视觉、4/6px 状态高度与 seek，Timer、Live Activity、Removable 和 Printing 在 island progress 控件上参数化主题色、斜纹和状态。新增卡片的标准动作统一使用 `controls.js` 的圆形图标按钮，常态不显示文字背景，hover/focus 才显示圆形反馈和动作提示。动作集合必须随状态裁剪，例如 Timer running 只显示 Pause，paused 只显示 Resume，结束后不再显示运行控制。

Activity dot 的 hover 与点击属于统一的进度预览入口：hover 延迟触发后，底部 dynamic bar 从 0 生长到该 Activity 当前进度，并在指针仍停留于圆点区时保持；Activity 已完成部分使用主题色填充并覆盖主题色对应的暗色动态斜纹。running 时斜纹移动，paused 时保留在当前位置但停止移动。Shift+点击仍用于持久固定，普通点击用于打开并聚焦对应卡片。

Timer 的 running activity dot 使用独立的 `timer-dot-color` Fine Tune 设置，不继承通用 Activity running 色；paused、success、warning 和 error 仍使用统一状态色，保证状态语义一致。

通过 Activity dot 切换到 Timer 卡片时，必须在卡片展开完成后再应用 Activity bar 绘制，避免展开流程把它覆盖成普通白条。这里只切换主题色进度与动态斜纹，不改变 dynamic bar 当时的宽度、高度和水平位置。

Island 是迷你控件。常驻 page 使用 200–500px 的统一可调总宽度（默认 350px），左右安全边距包含在该宽度内；所有 page 必须从扣除边距后的可用宽度动态排列控件，禁止 Media 等模块写死内部宽度。notification、small notification 与 Launcher 仍按自身内容独立改变 island 宽度。Activity、Timer、Removable、Device、Printing 等列表保持紧凑单行 `title | progress | value | actions`；Activity 行以约 25%/43%/最多 5%/剩余空间分配标题、进度条、可选百分比和圆形按钮。Media progress 必须保留 Git 历史中的语义尺寸：可拖动时 6px，不可拖动的兜底态 4px；不可拖动的 Activity/Timer/List progress 继承同一细条外观。Device 指标不能伪装成 Activity progress：存储设备显示容量占用条、磁盘图标与容量色；支持 BlueZ Battery 的设备显示电量条、电池图标，并按电量改变颜色。图标按钮默认约 22px、圆形、只在 hover 时显示提示；内容必须避开顶部融合圆角，hover/按钮边框不得越出可见背景。专用任务只进入对应 page，不能重复出现在总 Activity page。

Activity 创建后延迟到 small notification 结束附近，在不改变 bar 几何的情况下短暂展示缩小版 Activity 进度；首次从 0 生长。Shift 固定 dot 后持续显示，后续上报从当前动画帧缓动到新值，不能每次重置到 0。running/warning 的暗色斜纹移动，paused 和终态保留静止斜纹。

Launcher 的整组内容始终按 page 中线居中，不能因为右侧 disclosure 锚点改变而偏移。卡片通过滚轮、页点或按钮左右切换时，旧页沿切换反方向滑出、新页从切换方向滑入；快速连续切换必须先安全收束前一动画，不能残留 actor 或触发两次销毁。

Media 启动光效只绘制饱和色的旋转边框，不能在渐变中点产生白色亮块。Dynamic bar 的斜纹动画由当前进度所有者的运行状态控制：running 时移动，paused 时立即停在当前相位，恢复后从该相位继续。

第三方能力放在 `extensions/<id>/`，每项包含 `manifest.ini`，并通过 `sdk/live_activity.hpp` 的 v2 D-Bus 客户端发布 Activity；不得导入 Shell 内部对象。所有扩展的公共入口统一为 `island -e EXTENSION ...`，扩展内部 executable 不单独加入 PATH。`island list` 统一枚举内置 progress adapter 与扩展 manifest。首个参考扩展注册为 `file`，通过 `island -e file help` 查看帮助，并以明确的 `copy FROM TO`、`move FROM TO`、`remove PATH` 子命令执行文件操作。与 Linux 工具一致，copy/remove 操作目录时必须显式使用 `-r` 或 `--recursive`，move 目录不要求该参数；跨文件系统移动必须完整复制成功后才删除源路径，Dynamic Bar 不在线时文件操作仍可独立完成。

Activity 完成后的生命周期由 `Automatically remove completed activities` 和过期秒数统一控制；关闭自动移除时终态保留到用户 Stop tracking。显式由兼容 API 提供的 `expiresAt` 优先于全局默认。Island 已经展开时切歌只更新 Media page，不再发送重复的 small notification。固定 Activity 后它独占 dynamic bar 绘制层：Media 可以继续缓存播放进度，但 position 刷新、切歌 reset 和 activation 动画均不得覆盖固定进度；取消固定或固定任务消失后恢复最新 Media progress。

卡片左右边距必须由真实几何 frame 保证，不能依赖 `Clutter.BinLayout` 子项的 CSS margin。`card-page-width` 表示包含左右边距的总宽度。紧凑列表先计算最右侧实际按钮数量与宽度，再从剩余宽度按设计比例分配标题、progress 和 value；按钮始终右对齐，标题左对齐并只在空间确实不足时省略。列表 progress 厚度是 Fine Tune 的独立设置。Timer started 使用普通两行 notification，不使用 small notification。Dynamic bar 的 Media、Activity、Timer、Device 分别具有可配置颜色和斜纹开关，固定与临时预览都必须遵守当前类型的绘制设置。

Island Card Deck 的整个可见区域都接收滚轮事件：上/左切到前一 page，下/右切到后一 page，平滑滚动按主轴方向判定；事件只由根容器处理一次。统一 progress DrawingArea 必须显式垂直居中，否则横向 `St.BoxLayout` 会把 surface 拉伸到整行高度，使 Fine Tune 的厚度设置看似失效。

Activity dot 列表以 dynamic bar 左侧图标区的右边缘为锚点，最新增加的 dot 从最右槽弹入，已有 dots 向左让位。删除中间 dot 时，只让空位左侧的 dots 平滑向右补位，右侧项目保持原位；进度或颜色更新不得触发布局位移动画。新增使用缩放与透明度回弹，补位使用连续位移，并统一服从 animations 开关。

Activity dot 列表的最终锚点必须来自当前帧 dynamic bar progress track 的实际左端，而不是目标 bar 宽度、左右区最大自然宽度或动画结束后的预测位置。dot box 在 left zone 内右对齐，最右 dot 与当前 progress 左端之间始终保留 `ZONE_GAP`；bar 的 x/width 动画每帧变化时左右图标区同步跟随。

所有折叠态状态圆点——`island run`、`island -e` 扩展任务、普通 Activity、Timer 和 Device——必须以“一任务一圆点”通过 `DynamicBarApi.activityDot()` 进入同一个动态 registry 与 `_activityBox` 容器，不得在发布前按 group 合并。圆点槽位从右向左编号，最右为 index 0；新任务插入所属组的最右槽，同组旧任务向左顺延。Device 固定占据最大的若干 index（视觉上位于队列最左侧）。删除任意圆点后，仅空位左侧的圆点向右滑动补位，右侧圆点位置不变；所有点统一继承间距、hover 进度预览、点击精确聚焦对应任务、Shift 固定及销毁动画。旧 `activity()` 只保留为兼容别名。CardDeck 底部的 page 导航圆点表达页面位置，不是 Activity 状态，因此继续由 CardDeck 独立管理。

新增 Device dot 仍遵循通用组内插槽位移，只把自身入场方式替换为从 dynamic bar 下方向上进入并淡入；其他组不得因 Device 入场产生额外的反向位移。该动画只由 registry 成员新增触发，电量、容量、颜色和连接状态刷新不得重复播放。

Dot 排列与进入动画必须由统一 policy 描述，布局主循环不得按 Provider 名称写死分支。Placement 至少提供 `leading`、`normal`、`index-zero` 三个区域，Insertion 至少提供 `pop` 与 `rise-and-shift`。Device 使用 `leading + rise-and-shift`；普通 Activity 使用 `normal + pop`；Timer 使用 `index-zero + pop`。因此 Timer 区始终位于最右侧，多个 Timer 中最新创建者严格占据 index 0，其余向左排列。新增类型只需声明 policy 即可复用槽位计算和补位动画。

Dot tray 的分组顺序显式定义为 `[Device | Activity | Timer]`（视觉从左到右），而不是依靠零散的 placement 数字排序。Tray 整体右对齐，因此 Timer 组的最右项就是全局 index 0。新增 Timer 插入 Timer 组右端，原有非 Timer dots 按一个真实槽位向左移动；各组内部顺序不因其他组成员变化而重排。

所有 dot 类型都遵循同一个组内插入规则：新成员插入所属组的第一个（该组最右槽），该插入点左侧的旧成员整体向左移动一个槽位；删除时反向补位。Timer 位于最右组，所以新增 Timer 会推动整个既有列表向左，不能向 progress bar 方向生长。Left zone 宽度必须从当前子 actor（尤其 dot tray）的真实宽度重新计算，不得读取上一次显式 allocation 作为 preferred width。

多 page 模式的 disclosure toggle 必须完全位于 island 内：左右控制 cell 对称包含 `card-page-edge-padding`，右侧按钮占固定 38px 并放在 right cell 的左侧，cell 尾部留下真实边距且裁剪主题绘制。GNOME 主题的按钮最小宽度不得把 hover/focus 背景撑出 island；动画或展开计算仍以按钮自身右上角为基点。

Island 或 attached Launcher 展开时，点击 island、dynamic bar 或左右状态区以外的任意位置必须立即收回（显式 pinned 状态除外）。Outside-click 不能只依赖 event actor 父链；GNOME top chrome 下必须同时用 stage 坐标命中 island/bar/zone 的真实 transformed rectangle。Launcher 属于 island 矩形内部，点击其控件不得触发误收回。

所有 Card page 在功能自己的 `paddingX` 之外再叠加统一的 `Extra page side padding`，并通过固定总宽度且居中的几何 frame 分配，不能使用 CSS margin。展开/收回按钮移动到右侧单元格后，以按钮实际右上角为对齐点和变换 pivot；其背景或动效只能向左、向下占用空间，不能越过 island 的右边界。

Stop tracking 必须能删除最后一项；最后一项消失后对应 page 立即从 deck 移除，若没有其他卡片则回退到 Launcher。Island 自动收回必须同时检查背景、内容 holder 和 bar 的 hover，鼠标位于任何 island 内容上时不得收回。可恢复错误统一用 `[Dynamic Bar][模块]` 结构写入 GNOME Shell journal，并携带对象 ID 或配置项上下文，禁止吞掉解析、图标、卡片创建和设备操作异常。
