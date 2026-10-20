# Reader V3 主题语义令牌

版本 v3.1 · 2026-10-20 · 对应线上原型“Reader V3 · 统一设计系统与完整原型”

## 1. 概述

主题 = 一组语义令牌的取值。组件只引用语义令牌，不写死颜色；换主题只换这一组值，界面结构、间距、字号完全不变。

Reader V3 内置 4 个主题，每个主题含浅色和深色两套取值，共 8 套配色：

| 主题 | 定位 | 色相 |
| --- | --- | --- |
| 暖陶 | 默认应用主题 | 陶土橙 |
| 雾蓝 | 应用主题 | 蓝 |
| 青绿 | 应用主题 | 绿 |
| 黑白灰 | 阅读专用主题，只在阅读器内生效 | 无彩色 |

设计原则：

- 同色系：每个主题的底色、卡片、描边、文字、按钮都从同一个色相派生，只调明暗和浓淡。
- 四个频道（阅读、影视、音乐、听书）取主色相邻的色相，明度和彩度保持一致，只做小面积色标。
- 浅色主题整体提亮，按钮用柔和的浅色底配同色相的近黑文字；深色主题底色不用纯黑。
- 组件之间不直接比较颜色，只引用令牌。

## 2. 令牌角色与命名

原有 13 个角色，另新增 2 个文字色角色（brand-text、ch-\*-text），共 15 类。CSS 变量名如下。

| 角色 | CSS 变量 | 用途 |
| --- | --- | --- |
| bg | `--color-bg` | 页面底色 |
| surface | `--color-surface` | 卡片、抽屉、导航栏 |
| surface-2 | `--color-surface-2` | 分段控件、输入框底、悬停 |
| ink | `--color-ink` | 正文与标题 |
| muted | `--color-muted` | 次要文字、图标 |
| line | `--color-line` | 分隔线、描边 |
| brand | `--color-brand` | 主按钮底色、选中态、进度条填充（只作填充，不作文字色） |
| brand-soft | `--color-brand-soft` | 选中底色、标签底色 |
| on-brand | `--color-on-brand` | 品牌色填充上的文字和图标 |
| brand-text | `--color-brand-text` | 品牌色的文字、图标、链接（新增） |
| ch-{read\|video\|music\|audio} | `--color-ch-read` 等 | 频道图标底色、进度条填充 |
| ch-\*-soft | `--color-ch-read-soft` 等 | 继续卡片、频道入口底色 |
| ch-\*-text | `--color-ch-read-text` 等 | 频道色的文字（新增） |
| on-ch | `--color-on-ch` | 频道色填充上的图标和字 |
| scrim | `--color-scrim` | 抽屉遮罩 |

新增 brand-text 和 ch-\*-text 的原因：浅色主题的 brand 和频道色已改为柔和的浅色，直接当文字用对比度不够，所以文字和图标改用更深的同色相取值。

## 3. 主题取值

### 3.1 暖陶

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| bg | `#FDF9F6` | `#1F1713` |
| surface | `#FFFFFF` | `#2A201A` |
| surface-2 | `#F8EFE8` | `#352A23` |
| ink | `#3A2A22` | `#F7EDE6` |
| muted | `#82685B` | `#BBA79B` |
| line | `#F0E3DA` | `#43342B` |
| brand | `#F2B79F` | `#E88F73` |
| brand-soft | `#FBE9E0` | `#3F2A21` |
| on-brand | `#2B1810` | `#1A100C` |
| brand-text | `#A8482A` | `#F0987C` |
| on-ch | `#2B1810` | `#1A100C` |
| scrim | `rgba(58,42,34,.40)` | `rgba(0,0,0,.60)` |

| 频道 | 浅色 ch | 浅色 soft | 浅色 text | 深色 ch | 深色 soft | 深色 text |
| --- | --- | --- | --- | --- | --- | --- |
| read 阅读 | `#F2B79F` | `#FBE9E0` | `#A8482A` | `#E88F73` | `#3F2A21` | `#E88F73` |
| video 影视 | `#F6CA97` | `#FCF0DD` | `#8A5200` | `#E9AA6E` | `#3A2E1E` | `#E9AA6E` |
| music 音乐 | `#EFA9A3` | `#FAE4E1` | `#A8343E` | `#E58A8A` | `#3D2526` | `#E58A8A` |
| audio 听书 | `#E6BE9E` | `#F7EBDD` | `#7A5232` | `#D9A07F` | `#36291F` | `#D9A07F` |

### 3.2 雾蓝

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| bg | `#F8FAFE` | `#0F1722` |
| surface | `#FFFFFF` | `#172131` |
| surface-2 | `#EDF2FA` | `#202C40` |
| ink | `#1F3250` | `#E8EEF7` |
| muted | `#5A6C8C` | `#9FB0C8` |
| line | `#E4EBF6` | `#2A3850` |
| brand | `#9DC0F2` | `#7FB1F0` |
| brand-soft | `#E6EFFC` | `#1C3050` |
| on-brand | `#0F1D36` | `#0A1220` |
| brand-text | `#2F63B0` | `#8DB8F0` |
| on-ch | `#0F1D36` | `#0A1220` |
| scrim | `rgba(31,50,80,.40)` | `rgba(0,0,0,.60)` |

| 频道 | 浅色 ch | 浅色 soft | 浅色 text | 深色 ch | 深色 soft | 深色 text |
| --- | --- | --- | --- | --- | --- | --- |
| read 阅读 | `#9DC0F2` | `#E6EFFC` | `#2F63B0` | `#7FB1F0` | `#1C3050` | `#7FB1F0` |
| video 影视 | `#9FD2EE` | `#E3F2FA` | `#1F6F93` | `#7CC3E8` | `#1A3347` | `#7CC3E8` |
| music 音乐 | `#B2B8F2` | `#ECEEFC` | `#4A52B0` | `#9AA3F0` | `#25274D` | `#9AA3F0` |
| audio 听书 | `#90CBD8` | `#E0F2F5` | `#1F6F7C` | `#70C1CF` | `#17353A` | `#70C1CF` |

### 3.3 青绿

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| bg | `#F7FBF8` | `#0E1914` |
| surface | `#FFFFFF` | `#15251E` |
| surface-2 | `#EAF4EE` | `#1E3229` |
| ink | `#1B3329` | `#E6F2EC` |
| muted | `#52705F` | `#98B3A7` |
| line | `#E0EEE5` | `#28403A` |
| brand | `#8AD6B1` | `#6ED6A8` |
| brand-soft | `#E1F4EA` | `#1A3B2E` |
| on-brand | `#0F2A1E` | `#07130E` |
| brand-text | `#1F6B4F` | `#7FDDB4` |
| on-ch | `#0F2A1E` | `#07130E` |
| scrim | `rgba(27,51,41,.40)` | `rgba(0,0,0,.60)` |

| 频道 | 浅色 ch | 浅色 soft | 浅色 text | 深色 ch | 深色 soft | 深色 text |
| --- | --- | --- | --- | --- | --- | --- |
| read 阅读 | `#8AD6B1` | `#E1F4EA` | `#1F6B4F` | `#6ED6A8` | `#1A3B2E` | `#6ED6A8` |
| video 影视 | `#A9DB9B` | `#EBF6E2` | `#3F6E1F` | `#8ED67A` | `#243A1E` | `#8ED67A` |
| music 音乐 | `#8CD2CF` | `#E1F3F2` | `#1F6B68` | `#6CCBC6` | `#173A38` | `#6CCBC6` |
| audio 听书 | `#B6D98E` | `#F0F5E0` | `#5B6B1F` | `#A6CF72` | `#2C3818` | `#A6CF72` |

### 3.4 黑白灰（阅读专用）

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| bg | `#F5F5F5` | `#121212` |
| surface | `#FFFFFF` | `#1B1B1B` |
| surface-2 | `#EBEBEB` | `#262626` |
| ink | `#1A1A1A` | `#E6E6E6` |
| muted | `#666666` | `#9E9E9E` |
| line | `#E0E0E0` | `#2E2E2E` |
| brand | `#3D3D3D` | `#E6E6E6` |
| brand-soft | `#EDEDED` | `#2A2A2A` |
| on-brand | `#FFFFFF` | `#121212` |
| brand-text | `#3D3D3D` | `#E6E6E6` |
| on-ch | `#FFFFFF` | `#121212` |
| scrim | `rgba(26,26,26,.40)` | `rgba(0,0,0,.60)` |

| 频道 | 浅色 ch | 浅色 soft | 浅色 text | 深色 ch | 深色 soft | 深色 text |
| --- | --- | --- | --- | --- | --- | --- |
| read 阅读 | `#3D3D3D` | `#EDEDED` | `#3D3D3D` | `#CFCFCF` | `#2A2A2A` | `#CFCFCF` |
| video 影视 | `#4A4A4A` | `#EDEDED` | `#4A4A4A` | `#BDBDBD` | `#2A2A2A` | `#BDBDBD` |
| music 音乐 | `#575757` | `#EDEDED` | `#575757` | `#ABABAB` | `#2A2A2A` | `#ABABAB` |
| audio 听书 | `#666666` | `#EDEDED` | `#666666` | `#999999` | `#2A2A2A` | `#999999` |

黑白灰没有彩色，四个频道只靠明度的细微差别区分，实际界面里频道主要靠图标和文字标签区分。

## 4. 使用规则

1. 组件不写死颜色。除了封面、剧照等内容图片，界面里不出现十六进制色值。
2. brand 和 ch-\* 只作填充。带这些底色的文字和图标，用 on-brand 或 on-ch。
3. 品牌色的文字、链接、选中态图标，用 brand-text；频道色的文字用 ch-*-text。不要直接把 brand 或 ch-* 当文字色，浅色主题下对比度不够。
4. 继续卡片、频道入口的底色用 ch-*-soft，文字用 ink 或 ch-*-text。
5. 选中的标签、分段控件用 brand-soft 底加 brand-text 文字。
6. 抽屉、弹层的遮罩用 scrim。
7. 影视、音乐播放页是固定深色沉浸界面，使用当前主题的深色取值，不随浅色切换。
8. 不使用纯黑 `#000` 作背景；纯白只作浅色主题的 surface。

## 5. 对比度要求

正文、次要文字、频道色文字至少 4.5:1，图标与控件至少 3:1。以下组合已用脚本对 8 套配色逐一计算，全部达标：

| 组合 | 要求 |
| --- | --- |
| ink 对 bg、surface | 4.5:1 以上 |
| muted 对 bg、surface-2 | 4.5:1 以上 |
| brand-text 对 brand-soft、bg | 4.5:1 以上 |
| on-brand 对 brand | 4.5:1 以上 |
| ch-*-text 对 ch-*-soft | 4.5:1 以上 |
| on-ch 对 ch-\* | 4.5:1 以上 |

新增主题或调色时，必须重新计算这几组。

## 6. 主题选择与切换

- 应用主题可选暖陶、雾蓝、青绿，默认暖陶。
- 明暗模式可选“跟随系统”“浅色”“深色”，默认跟随系统。
- “跟随系统”= 指定一个浅色时使用的主题和一个深色时使用的主题，默认都是暖陶。
- 黑白灰是阅读专用主题，不作为应用主题，只在阅读器内生效。阅读主题可选“跟随应用”或“黑白灰”；选黑白灰时，浅色和夜间分别用它的浅色和深色取值。
- 主题偏好存在当前设备，登录后可同步到账号。

## 7. CSS 实现示例

以暖陶为例，其他主题结构相同，换成第 3 节的取值即可。

```css
[data-theme="warm"][data-mode="light"] {
  --color-bg: #FDF9F6;
  --color-surface: #FFFFFF;
  --color-surface-2: #F8EFE8;
  --color-ink: #3A2A22;
  --color-muted: #82685B;
  --color-line: #F0E3DA;
  --color-brand: #F2B79F;
  --color-brand-soft: #FBE9E0;
  --color-on-brand: #2B1810;
  --color-brand-text: #A8482A;
  --color-ch-read: #F2B79F;   --color-ch-read-soft: #FBE9E0;   --color-ch-read-text: #A8482A;
  --color-ch-video: #F6CA97;  --color-ch-video-soft: #FCF0DD;  --color-ch-video-text: #8A5200;
  --color-ch-music: #EFA9A3;  --color-ch-music-soft: #FAE4E1;  --color-ch-music-text: #A8343E;
  --color-ch-audio: #E6BE9E;  --color-ch-audio-soft: #F7EBDD;  --color-ch-audio-text: #7A5232;
  --color-on-ch: #2B1810;
  --color-scrim: rgba(58, 42, 34, .40);
}

[data-theme="warm"][data-mode="dark"] {
  --color-bg: #1F1713;
  --color-surface: #2A201A;
  --color-surface-2: #352A23;
  --color-ink: #F7EDE6;
  --color-muted: #BBA79B;
  --color-line: #43342B;
  --color-brand: #E88F73;
  --color-brand-soft: #3F2A21;
  --color-on-brand: #1A100C;
  --color-brand-text: #F0987C;
  --color-ch-read: #E88F73;   --color-ch-read-soft: #3F2A21;   --color-ch-read-text: #E88F73;
  --color-ch-video: #E9AA6E;  --color-ch-video-soft: #3A2E1E;  --color-ch-video-text: #E9AA6E;
  --color-ch-music: #E58A8A;  --color-ch-music-soft: #3D2526;  --color-ch-music-text: #E58A8A;
  --color-ch-audio: #D9A07F;  --color-ch-audio-soft: #36291F;  --color-ch-audio-text: #D9A07F;
  --color-on-ch: #1A100C;
  --color-scrim: rgba(0, 0, 0, .60);
}
```

切换方式：在根元素上设置 `data-theme`（warm、blue、green）和 `data-mode`（light、dark）。选择“跟随系统”时，由 `prefers-color-scheme` 决定 `data-mode`。阅读器容器单独设置 `data-theme="gray"`，使其不受应用主题影响。

## 8. 与旧主题的对应关系

| 旧主题 | 处理方式 |
| --- | --- |
| 暖纸（浅色） | 替换为暖陶浅色 |
| 深夜（深色） | 替换为暖陶深色 |
| 雾蓝（浅色） | 替换为新的雾蓝浅色 |
| 蔷薇（浅色） | 取消 |
| 原野（浅色） | 取消，由青绿浅色替代 |
| 石墨（深色） | 取消，由雾蓝深色替代 |

迁移时，已选择旧主题的用户按上表映射；取消的主题统一回落到暖陶，并保留原来的明暗模式。
