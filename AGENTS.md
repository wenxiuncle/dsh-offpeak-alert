# AGENTS.md —— 改这个插件之前先读

给在本仓库工作的 AI agent。面向使用者的说明在 [README.md](README.md)；这里只写**改之前必须知道、README 里没有、或者容易被顺手「优化」掉**的东西。

## 这是什么、装在哪

DeepSeek Harness **桌面版**插件：在应用窗口标题栏常驻一个角标，显示 DeepSeek API 当前是高峰（1×）还是错峰低谷（0.5×）及切换倒计时。

- 本仓库是**唯一真源**。DSH 桌面版 profile 以软链接安装它：

  `C:\Users\lijis\.dsh\profiles\desktop\node_modules\dsh-offpeak-alert` → 本目录（profile 里登记为 `link:` 依赖）

  登记位置：`…\profiles\desktop\package.json` 的 `dsh.profile.bundles`，以及 `…\profiles\desktop\cordis.patch.yml` 里的 `offpeak-alert` 行。
- 改客户端代码后需**重载插件**；`package.json`（尤其 `icon`）是 host 侧读成 data URL 的，可能要**重启 DSH** 才刷新。
- 公开仓库：<https://github.com/wenxiuncle/dsh-offpeak-alert>

## 文件地图

| 文件 | 说明 |
|---|---|
| `client.js` | 浏览器端全部逻辑：峰谷判定、节假日表、`BADGE_CSS`、拖动/关闭 |
| `index.js` | Host 侧，目前只有空的 `apply` |
| `icon.svg` | 插件卡片图标（DSH 读 `package.json.icon`） |
| `assets/` | README 用的实拍截图 |
| `cordis.patch.yml` | 往 profile 插入插件行 |

## 已经定下来的决定（不要随手改回去）

1. **图标不用红色、不用叹号。** 它曾经是红色警告三角，使用者误读成「这个插件报错了」。现为中性石墨圆角块 + 单线 `1/2` + DeepSeek 蓝斜杠。
   - 图标里的 `1`、`2` 是**手绘路径**，**不要换成 `<text>`**：`icon.svg` 以 `<img>` 加载，字体不可控，形状会随机器变。
   - 排布要按**墨迹外沿**算间距（含 `stroke-width / 2` 的圆头笔帽），只看路径端点会让笔画互相压住。
2. **角标配色写字面色值，不用主题令牌**（故意如此，界面永远由主题决定）。深浅主题必须按 `body[data-ds-dark-theme]` 分支，**不要用 `prefers-color-scheme`** —— 那会跟着系统走而不是跟着应用内设置。
3. **峰谷规则硬编码、不联网。** 「规则待核」小黄点、`SCHEDULE_VERIFIED_ON`、`SCHEDULE_MAX_AGE_DAYS` 是**特性不是 bug**：它们负责提醒规则可能过期。核对官网后要顺手把核对日期改成当天。
4. **定位是面向桌面版的。** `applyDefaultPosition()` 只把角标放在**视口顶边居中**，并不探测标题栏元素；桌面版把窗口标题栏画在文档内，所以落点正好。**不要写成「浏览器版不显示」** —— 它会显示，只是贴在页面最顶端，没做适配与验证。
5. `index.js` **只导出 `apply`**，不要导出 `Config` 或 `name`（见文件内注释：导出普通对象会让行校验失败、插件状态变「异常」）。

## 工作约定

- **提交信息用中文 + conventional 前缀**（`feat:` / `style:` / `docs:` / `refactor:`），正文写清**为什么**，尤其是有取舍的地方。
- **不要擅自 push。** 仓库是公开的；提交到本地即可，由使用者决定何时推。
- **视觉改动先渲染看过再交付。** 沙箱里 headless Chrome/Edge 起不来（`mojo platform_channel … 拒绝访问`，命名管道受限）。用自带 Python + Pillow 写最小 SVG 光栅化器即可：rect(rx)、circle、path（M/L/H/V/C/A/Z，绝对+相对）、`<g>` 样式继承，8× 超采样后缩放；按**真实显示尺寸**（插件行 30px、卡片 36px）在浅色与深色背景上并排对比。
- **使用者定下新的取舍时，顺手把本文件改掉**（例如「图标换成 X 色」「不要提交」）。否则下一个会话会照着旧决定行事 —— 本文件的价值就在于它比会话记忆活得久。
- 用中文回答使用者。

## 常见改动落点

| 要改什么 | 改哪里 |
|---|---|
| 峰谷时段规则 | `client.js` 的 `statusAt()` 分钟判断 + `SCHEDULE_VERIFIED_ON` |
| 中国法定节假日 | `client.js` 顶部 `OFFICIAL_HOLIDAYS`（未内置年份走 `LUNAR_FALLBACK` 农历估算） |
| 角标配色 / 拖动 / 关闭 | `client.js` 的 `BADGE_CSS` 与拖动逻辑 |
| 插件图标 | `icon.svg`（渲染验证后提交） |
| 插件面板里的名称与简介 | `package.json` 的 `meta.title` / `meta.description` |
