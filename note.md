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

Island 底部的小型开关、分页和常驻控件统一使用 `IslandControlContainer`，不得在各功能中重复实现导航和测量逻辑。容器负责自然尺寸变化、点击、滚轮、hover/focus 状态以及向统一 API 请求重新布局。其高度统一读取 Fine Tune 的 `compact-control-height`。

单个附加页面时只显示居中的粗圆 V 图标，常态无按钮底色且与上下内容间距为 0；hover/focus 可显示轻微背景反馈。多个附加页面时，中间使用类似 Ubuntu Multi Workspace 的圆点分页器，当前页高亮，支持点击圆点以及在整个窄区域使用普通滚轮或触控板平滑滚动切换。展开/收回按钮让出中央导航位置并右对齐。

notification 可以独立声明：

- `timeout`：展示时间。
- `passive`：被动展开；保持 dynamic bar 原来的长度、颜色和 progress，不因提示而进入 hover/主动展开状态。
- `width` / `height`：提示伸出的目标尺寸；未声明时才按内容自然尺寸计算。
- `paddingX` / `paddingY`：内容与 island 左右/上下边缘的间距。左右必须保留可见留白；短条通知可以保持横向留白，同时不抬高约 10px 的目标高度。
- `pulse`：是否在左图标区显示绿色呼吸点。呼吸点直径等于默认 dynamic bar 高度。

短 notification 统一称为 `small notification`：它是不明显的低高度提示，预留约 10px 高度。文字使用约 8px 字号；单行过长时滚动，不能用省略号代替关键信息。例如媒体切歌后，短暂显示“艺术家 - 曲名”，结束后恢复发送前状态。

dynamic bar 始终以屏幕/Panel 中心为中心改变宽度。左右图标区锚定到 bar 的两端，必须在 bar 动画的每一帧跟随移动；图标区宽度按内容自然尺寸计算，不能用固定窄框裁成 `...`。

收起使用二段式动画：第一段只把 Dynamic island 收回，bar 保持收回开始时已经显示的水平位置和实际长度，不能强制切换到预设长宽。第一段结束后清空 island 内容并重新测量 root，同时把 bar 的屏幕坐标换算回新 root 的局部坐标，避免 root 尺寸变化造成跳动。第二段再根据当前 hover/折叠状态判断是否需要改变长度并从中心动画到目标。第二段结束时必须按 primary monitor 中心重新写入精确的 x/width/y。

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

灵动条恢复默认的长条状态

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

扩展库内提供无 Python 依赖的 C++ 命令包装器 `tools/island`。用户把它软链接到 `~/.local/bin/island` 后，可使用 `island [run] [--title TITLE] COMMAND [ARGS...]`；`run` 默认且可省略，title 可选，省略时使用完整命令文本。`island help` 显示语法，`island list` 从适配器注册表列出当前安装的兼容支持；裸 `island` 因没有待执行命令而显示 help。若扩展/D-Bus 暂时不可用，原命令仍必须执行，只跳过 Live Activity 上报。包装器必须直接执行参数而不是再次交给 shell 解析，透传输出和退出码，并通过 session D-Bus 向扩展发送 Start、Update、Complete。

命令输出进度解析属于独立兼容层 `tools/progressAdapters.hpp`。适配器通过稳定的具名注册 API 提供 id、匹配命令、说明与解析规则，`island list` 直接读取同一注册表。首版提供 CMake/Make/Ninja、APT/DPKG 和通用百分比适配；未来 SCP 等兼容只注册新 Adapter，不修改命令执行、输出转发、D-Bus 或 UI 层。无法识别时显示不确定进度，不能因此阻止 activity、完成状态或原命令执行。

开始时发送 small notification 并在左图标区创建 activity 圆点。运行中圆点为橙色；完成为绿色并带白色边框，同时发送带勾的 completed notification，失败则显示错误和退出码。点击圆点会约 1.8 秒临时把 bar 切换到该任务进度，颜色使用 GNOME 风格的主题强调色，随后恢复原 progress。

展开列表每行按“左侧 title、右侧进度条、百分比”排列。常态无背景，hover 才显示背景。点击行尝试按启动终端 PID 激活对应窗口；无法关联终端时静默退化，不影响任务。媒体和 Live Activity 同时存在时注册为可通过底部圆点切换的常驻卡片；附加 Launcher 仍复用通用容器。

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
