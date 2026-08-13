# stock-analysis — A 股 + 港股桌面分析工具

> **Tauri 2 + Vue 3 + Rust** · 数据源: 腾讯财经 / 东方财富 / 同花顺 · AI: DeepSeek API · 图表: Lightweight Charts™ · 构建: Vite + pnpm

---

## 1. 项目骨架

```
stock-analysis/
├── src/                        ← Vue 前端
│   ├── main.js / App.vue
│   ├── assets/      main.css (设计 token) + modal.css (弹窗共享样式)
│   ├── components/  布局/列表/详情/弹窗/迷你窗口 + settings/(5 标签页) + ai/(4 子组件)
│   ├── composables/ 22 个 — 数据加载 / 纯计算 / 状态持久化（见 §3.1）
│   ├── skills/      AI Agent 工具系统 — 10 个 skill / 13 个工具（见 §3.2）
│   ├── prompts/     system-prompt.md
│   └── utils/       format.js / limit.js（涨跌停幅度按板块判断）
├── src-tauri/                  ← Rust 后端
│   └── src/
│       ├── main.rs / lib.rs / commands.rs（19 个命令）
│       ├── types.rs / helpers.rs
│       └── api/       tencent / eastmoney / hotlist / llm / web / iwencai
└── public/
```

---

## 2. 数据流

```
App.vue ──调用──> composables/useXxx.js
                      │  invoke("command")
                      ▼
              commands.rs ──> api/tencent.rs    (腾讯财经, GBK)
                          ──> api/eastmoney.rs  (东方财富)
                          ──> api/hotlist.rs    (同花顺热榜)
                          ──> api/llm.rs        (DeepSeek SSE)
                          ──> api/web.rs        (搜索 + 正文提取)
                          ──> api/iwencai.rs    (问财选股)
```

模式：每个 composable 返回 `{ data, loading, load(), ... }`，`App.vue` 统一调用，通过 props 下发。

---

## 3. 前端模块

### 3.1 Composables（22 个）

**数据加载（invoke 后端）**

| 文件 | 用途 | 后端命令 |
|------|------|---------|
| `useQuoteLoader.js` | 批量加载实时行情 | `get_stock_quote` / `get_stock_quotes_batch` |
| `useStockSearch.js` | 股票搜索（防抖） | `search_stocks` |
| `useKlineData.js` | K 线 + 周期切换 | `get_stock_kline` |
| `useIntradayData.js` | 分时数据 | `get_stock_intraday` |
| `useMoneyFlow.js` | 资金流向（竞态保护） | `get_stock_money_flow` |
| `useIndustryData.js` | 行业分析 | `get_stock_industry` |
| `useMarketIndices.js` | 大盘指数行情 | `get_market_indices` |
| `useAiAnalysis.js` | AI 对话（个股/全局，Agent 循环，防重复调用死循环；全局支持 @代码 引用、热榜选股） | `call_llm` + `call_llm_stream` |
| `usePositions.js` | 持仓管理 + 盈亏（含港币→人民币汇率换算，失败回退缓存值） | `get_fx_rate` |
| `useUserProfile.js` | 用户画像读写 | `read_user_profile` / `save_user_profile` |
| `useIwencaiRobot.js` | 问财自然语言选股（chameleon.js 在 WebView 生成 Cookie v） | `get_iwencai_robot` |

**纯前端计算**

| 文件 | 用途 |
|------|------|
| `useTechIndicators.js` | MACD/KDJ/RSI/WR/EMA 等 |
| `useChipDistribution.js` | 筹码分布（三角形分布法） |
| `useSupportResistance.js` | 支撑/阻力位（聚类 + 斐波那契） |
| `useT0Signals.js` | 日内 T+0 交易信号（分时 + 日K趋势，输出分时图标记与摘要） |
| `aiContext.js` | 构建 AI 系统提示词（注入持仓/画像/K线/筹码） |

**状态与持久化**

| 文件 | 用途 |
|------|------|
| `useWatchlist.js` | 自选股 CRUD（加入时记录 `addedPrice`，用于"自选以来"涨跌幅） |
| `useSettings.js` | 全局设置单例 |
| `useWatchlistNotifications.js` | Windows 原生通知（A 股/港股分时段判断） |
| `useMaAlerts.js` | 个股均线提醒（每股票独立配置周期 5/10/20/30/60 + 上穿/下穿/双向，日K 5min 缓存） |
| `aiMessageStore.js` | AI 对话按股票隔离持久化 |
| `llmClient.js` | SSE 流式 LLM 客户端（每次调用唯一 streamId，按事件 id 过滤防并发串流） |
| `fetcher.js` | `createDataFetcher()` 工厂函数 |

### 3.2 Skills（AI 工具系统，10 个 skill / 13 个工具）

`index.js` 注册器合并所有 skill 的 `tools` / `toolImpl` / `systemPrompt`。新增 skill: 创建文件 → 加入 `SKILLS` 数组 → 自动生效。

| Skill | 提供工具 |
|-------|---------|
| `StockQuote.js` | `get_stock_quote` |
| `KlineAnalysis.js` | `get_stock_kline` |
| `MoneyFlow.js` | `get_stock_money_flow`（全档：主力/超大单/大单/中单/小单） |
| `Industry.js` | `get_stock_industry` |
| `MarketIndices.js` | `get_market_indices` |
| `WebSearch.js` | `web_search` / `web_fetch`；systemPrompt 为四步先搜索流程（拆词→搜索→叠加本地数据→综合）+ 关键词铁律（禁泛词）+ 权威来源优先 |
| `Intraday.js` | `get_stock_intraday` |
| `MarketOverview.js` | `get_hot_list` |
| `StockSearch.js` | `search_stocks` |
| `UserContext.js` | `read_user_profile` / `save_user_profile` / `get_fx_rate` |

> 19 个命令中，`call_llm` / `call_llm_stream`（AI 自身）、`get_stock_quotes_batch` / `get_iwencai_robot` / `get_app_version` / `check_for_update`（前端专用）未开放为 AI 工具，其余 13 个已开放。

### 3.3 核心子系统

- **持仓**: `usePositions` + `PositionModal`，localStorage 持久化，每 30s 刷新实时价计算盈亏，AI 对话时自动注入。港股自动识别（5 位代码），按汇率换算汇总
- **用户画像**: `useUserProfile` + `ProfileModal`，Markdown 存 `app_data_dir`，AI 每次回复后自动更新（静默失败），支持手动编辑
- **自选通知**: `useWatchlistNotifications`，涨停/跌停/±7%/±5%/快速拉升下跌(30s≥2%)，每股票每类型每日一次（按本地日期）；涨跌停阈值按板块判断（主板 ±10%/创业板科创板 ±20%/北交所 ±30%/港股无涨跌停）
- **均线提醒**: `useMaAlerts` + `MaAlertModal`（个股详情页按钮），每只股票独立配置监控周期（MA5/10/20/30/60）与触发方向（上穿/下穿/双向），股价穿越均线时 Windows 通知，每股票每周期每日一次、仅交易时段；日K 5 分钟内存缓存避免高频请求；配置持久化 localStorage；删除自选时弹窗确认是否一并清除该股均线提醒配置（列表删除按钮与详情页星标切换均走确认弹窗，App.vue `handleRemoveFromWatchlist` / `handleToggleWatchlist`）
- **全局设置**: `useSettings` + `SettingsModal`，5 标签页（通知/刷新/图表/AI/关于），实时生效
- **AI 双入口**: 个股 AI（AiAnalysisModal，注入行情/K线/资金/行业/筹码/持仓上下文）；全局 AI（GlobalAiModal，注入大盘指数+持仓，`@代码` 快捷引用个股，历史消息按 6000 字符预算裁剪；「热榜选股」按钮遍历热榜股票，批量行情 + 资金流向与日K线并发，数据以 `hotStocks` 字段注入，AI 只输出推荐标的）
- **AI 联网搜索策略**: 联网开关对所有 AI 入口统一生效。开启时先 `web_search` 再叠加本地工具数据回答；关闭时搜索 skill 的提示词与工具一并剔除（`{{SEARCH_POLICY}}` 占位符 + `getMergedSystemPrompt({ excludeSkills })`）
- **全局快捷键**: `Ctrl+K` 聚焦搜索、`Ctrl+N` 全局 AI（注册失败静默降级；迷你窗口不注册）
- **单例应用**: `tauri-plugin-single-instance`，重复启动聚焦已有窗口
- **系统托盘**: 主窗口关闭按钮 → 隐藏到托盘；托盘菜单「显示主窗口 / 退出」
- **迷你置顶模式**: 无边框置顶小窗（`?mini=1`），自选股 10s 刷新，双击行联动主窗口选中
- **问财选股窗口**: 独立窗口（`?iwencai=1`），自然语言选股，点击结果联动主窗口并自动关闭

---

## 4. Rust 后端

### 4.1 Tauri 命令（19 个）

| 命令 | 数据源 | 说明 |
|------|--------|------|
| `get_stock_quote` | Tencent | 个股实时行情 |
| `get_stock_quotes_batch` | Tencent | 批量实时行情（A 股 50 只/批，港股逐只回退） |
| `get_stock_kline` | Tencent | K 线（日/周/月） |
| `get_stock_intraday` | Tencent AppStock | 分时数据（当日分钟） |
| `get_stock_money_flow` | Tencent → East Money 备选 | 资金流向（5 档净流入+占比） |
| `get_stock_industry` | East Money HSF10 | 行业分析 |
| `get_market_indices` | Tencent（并行） | 七大指数（失败兜底条目用真实名称） |
| `search_stocks` | Tencent | 股票搜索 |
| `get_hot_list` | 同花顺 | 实时热榜 |
| `call_llm` | DeepSeek | AI 非流式 |
| `call_llm_stream` | DeepSeek SSE | AI 流式 → `llm-chunk`/`llm-done`/`llm-error`（payload 带 streamId） |
| `read_user_profile` | 本地文件 | 读取画像 md |
| `save_user_profile` | 本地文件 | 保存画像 md |
| `web_search` | 东方财富搜索 API | 财经新闻搜索（相关性排序 + 泛词剥离/去重，带发布时间/来源） |
| `web_fetch` | 目标 URL | 网页抓取（JSON-LD→转义HTML→正文容器→meta 四级提取，限 50000 字符） |
| `get_fx_rate` | Frankfurter API | 港元兑人民币汇率 |
| `get_iwencai_robot` | 问财 get-robot-data | 自然语言选股（需 Cookie v + 浏览器 UA/Referer/Origin） |
| `get_app_version` | 本地 | 当前应用版本（CARGO_PKG_VERSION） |
| `check_for_update` | GitHub API | 检查最新 Release（语义化版本比较；直连失败自动回退系统代理，适配国内网络） |

### 4.2 数据源特征

| 文件 | 编码 | 注意 |
|------|------|------|
| `tencent.rs` | **GBK** → `encoding_rs::GBK.decode()` | `~` 分隔，无反爬；支持批量行情 `q=` 多代码逗号拼接（A 股） |
| `eastmoney.rs` | UTF-8 | JSON/JSONP/HTML，有 CDN/WAF（push2 主域名被拦，用 push2delay） |
| `hotlist.rs` | UTF-8 | JSON API |
| `llm.rs` | UTF-8 | OpenAI 兼容；V4 工具调用需回传 `reasoning_content`；SSE 按字节累积、`b"\n\n"` 切分后解码 |
| `web.rs` | UTF-8（自动解码 GBK） | 东财搜索 API（**sort=default 相关性排序**，sort=time 会返回无关新闻）；正文提取四级降级；反爬站过滤（zhihu/baike 等 8 个）；`site:域名` 本地过滤 |
| `iwencai.rs` | UTF-8 | 响应路径 `data.answer[0].txt[0].content.components[0].data`；meta.extra 含 row_count/token/condition |

### 4.3 代码转换 (helpers.rs)

```
A 股:  600xxx → "SH600xxx" / "sh600xxx"  (东方财富 / 腾讯)
       900xxx → "SH900xxx" / "sh900xxx"  (沪 B)
       其他   → "SZxxxxxx" / "szxxxxxx"
港股:  00700  → "HK00700"  / "hk00700"    (5 位数字，is_hk_stock)
       secid  → "116.00700"              (东方财富资金流向)
北交所: 43/82/83/87/88/92 开头 → "BJ430047" / "bj430047" / secid "0.430047"
       (is_bse_stock；东财将北交所归入 0 市场)
```

---

## 5. 设计系统

- **调色板**: Rust `#5d2a1a` / Apricot Wash `#fbe1d1` / Sky Wash `#d3e3fc` / Ink `#17191c`
- **圆角**: cards 24px / inputs 16px / images 12px / pills 9999px
- **字体**: Signifier (serif, 标题) + Sohne (无衬线, 正文)，已本地化
- **禁止**: 饱和蓝/绿/红作为框架色、边框 >1px、渐变背景
- **弹窗**: modal 统一使用 `assets/modal.css` 共享样式
- **分时图参考线**: 昨收（灰虚线）+ 涨跌停（红/绿虚线，按板块阈值基于昨收计算，港股不画）

---

## 6. 开发命令

```bash
pnpm install       # 安装依赖
pnpm dev           # Vite dev server (port 1420)
pnpm tauri dev     # Tauri 桌面应用 (dev)
pnpm build         # 前端构建
pnpm tauri build   # 打包 MSI + NSIS
cargo check        # Rust 编译检查 (src-tauri/)
```

> 前端构建按 vendor 分包（`vite.config.js` `manualChunks` 函数）：`vendor-charts`（lightweight-charts）/ `vendor-markdown`（marked+dompurify）/ `vendor-vue`（vue+@vue/*+@tauri-apps/*），避免单入口 >500 kB 警告。注意 rolldown 的 `manualChunks` 仅支持函数形式（不支持 Rollup 对象形式），且 vue 3.5 的 `@vue/*` 子包与 pnpm `.pnpm` 目录 scoped 名（`@`→`+`）需一并匹配。

---

## 7. 关键约定

1. **GBK 编码**: 腾讯 API 返回 GBK，必须 `encoding_rs` 解码
2. **竞态保护**: 切换股票时丢弃旧请求结果 (`useMoneyFlow` / `useKlineData` / `useIntradayData`，后两者用请求序号)
3. **HTTP 客户端全局复用**: `api/mod.rs` 用 `OnceLock` 缓存 `reqwest::Client`（`build_http_client` 15s 超时 / `build_llm_http_client` 无总超时+90s 空闲池）
4. **V4 reasoning_content**: 思考模式下 assistant 消息须回传此字段，否则 400
5. **资金双数据源**: 腾讯 ff_ 接口已失效（`v_pv_none_match`，2026-08-12 起）→ 东方财富 **push2delay** 实时接口优先（push2 主域名被 WAF 拦截）→ push2his 历史接口兜底；`get_stock_money_flow` 先试腾讯、NO_DATA 时降级东财
6. **港股/北交所兼容**: `helpers.rs` 按代码长度与前缀判断市场（`is_hk_stock` / `is_bse_stock` / 沪市含 900 沪B），前端自动切换货币符号与市场标签
7. **Markdown 渲染必须消毒**: marked 默认透传原始 HTML，所有 `marked.parse` 输出须经 `DOMPurify.sanitize` 后才能 `v-html`；外部数据（如搜索结果名称）插入 HTML 前须先转义
8. **TLS 不降级**: reqwest client 禁止 `danger_accept_invalid_certs`（API key 经 HTTPS 传输，防中间人）
9. **CSP 加固**: `tauri.conf.json` 已配置 CSP（`default-src 'self'` + `style-src 'unsafe-inline'`，IPC 需 `connect-src ipc: http://ipc.localhost`，dev 需 `ws://localhost:1420`）
10. **文件变动 → 同步更新本文档**（新增/删除文件、Tauri 命令、composable/skill 等）
