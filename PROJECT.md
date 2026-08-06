# stock-analysis — A 股 + 港股桌面分析工具

> **Tauri 2 + Vue 3 + Rust** · 数据源: 腾讯财经 / 东方财富 / 同花顺 · AI: DeepSeek API · 图表: Lightweight Charts™ · 构建: Vite + pnpm

---

## 1. 项目骨架

```
stock-analysis/
├── src/                        ← Vue 前端
│   ├── main.js / App.vue
│   ├── assets/   main.css (设计 token) + modal.css (弹窗共享样式)
│   ├── components/
│   │   ├── 布局:      MarketHeader.vue / TitleBar.vue
│   │   ├── 列表:      StockList.vue / HotList.vue / SearchDropdown.vue
│   │   ├── 详情:      StockDetail.vue / KlineChart.vue / IntradayChart.vue
│   │   ├── 弹窗:      AiAnalysisModal.vue / GlobalAiModal.vue / TechAnalysisModal.vue
│   │   │             IndustryModal.vue / ProfileModal.vue / PositionModal.vue
│   │   │             SettingsModal.vue / ChipDistribution.vue / ConfirmDialog.vue
│   │   ├── 通用:      IndicatorCard.vue
│   │   ├── 迷你窗口:  MiniMode.vue
│   │   ├── settings/  (5 个设置标签页: 通知/刷新/图表/AI/关于)
│   │   └── ai/        (ApiKeySetup / ChatMessages / ChatFooter / ModelControls)
│   ├── composables/  (18 个 — 数据加载/纯计算/持久化)
│   ├── skills/       (AI Agent 工具系统 — 6 个 skill)
│   ├── prompts/      (system-prompt.md)
│   └── utils/        (format.js / limit.js 涨跌停幅度按板块判断)
├── src-tauri/                  ← Rust 后端
│   ├── Cargo.toml / tauri.conf.json
│   └── src/
│       ├── main.rs / lib.rs / commands.rs (15 个命令)
│       ├── types.rs / helpers.rs
│       └── api/  (tencent / eastmoney / hotlist / llm / web)
└── public/
```

---

## 2. 数据流

```
App.vue ──调用──> composables/useXxx.js
                      │  invoke("command")
                      ▼
              Tauri IPC Bridge
                      │
                      ▼
              commands.rs ──> api/tencent.rs    (腾讯财经, GBK)
                          ──> api/eastmoney.rs  (东方财富)
                          ──> api/hotlist.rs    (同花顺热榜)
                          ──> api/llm.rs        (DeepSeek SSE)
                          ──> api/web.rs        (搜索 + 正文提取)
```

模式: 每个 composable 返回 `{ data, loading, load(), ... }`，`App.vue` 统一调用，通过 props 下发。

---

## 3. 前端模块

### 3.1 Composables（数据层）

| 文件 | 用途 | 后端命令 |
|------|------|---------|
| `useWatchlist.js` | 自选股 CRUD | 纯前端 (localStorage) |
| `useQuoteLoader.js` | 批量加载实时行情 | `get_stock_quote` / `get_stock_quotes_batch` |
| `useStockSearch.js` | 股票搜索（防抖） | `search_stocks` |
| `useKlineData.js` | K 线 + 周期切换 | `get_stock_kline` |
| `useIntradayData.js` | 分时数据 | `get_stock_intraday` |
| `useMoneyFlow.js` | 资金流向（竞态保护） | `get_stock_money_flow` |
| `useIndustryData.js` | 行业分析 | `get_stock_industry` |
| `useMarketIndices.js` | 六大指数行情 | `get_market_indices` |
| `useAiAnalysis.js` | AI 对话（个股/全局，Agent 循环 ≤8 轮；全局支持 @代码 快捷引用个股、指数/持仓预加载） | `call_llm` + `call_llm_stream` |
| `usePositions.js` | 持仓管理 + 盈亏计算（含港币→人民币汇率换算，失败回退上次缓存值） | `get_fx_rate` (汇率) |
| `useUserProfile.js` | 用户画像读写 | `read_user_profile` / `save_user_profile` |
| `useSettings.js` | 全局设置单例 | 纯前端 (localStorage) |
| `useWatchlistNotifications.js` | Windows 原生通知（A 股/港股分时段判断：港股 9:30-12:00/13:00-16:00） | 纯前端 (`tauri-plugin-notification`) |
| `aiContext.js` | 构建 AI 系统提示词（注入持仓/画像/K线/筹码） | 纯函数 |
| `aiMessageStore.js` | AI 对话按股票隔离持久化 | 纯前端 (localStorage) |
| `llmClient.js` | SSE 流式 LLM 客户端 | 监听 Tauri 事件 |
| `useTechIndicators.js` | MACD/KDJ/RSI/WR/EMA 等 | 纯前端计算 |
| `useChipDistribution.js` | 筹码分布（三角形分布法） | 纯前端计算 |
| `useSupportResistance.js` | 支撑/阻力位（聚类 + 斐波那契） | 纯前端计算 |
| `useIwencaiRobot.js` | 问财自然语言选股（chameleon.js 在 WebView 生成 Cookie v） | `get_iwencai_robot` |
| `fetcher.js` | `createDataFetcher()` 工厂函数 | 不直接调用命令 |

### 3.2 Skills（AI 工具系统）

`index.js` 注册器合并所有 skill 的 `tools` / `toolImpl` / `systemPrompt`。新增 skill: 创建文件 → 加入 `SKILLS` 数组 → 自动生效。

| Skill | 提供工具 |
|-------|---------|
| `StockQuote.js` | `get_stock_quote` — 个股实时行情 |
| `KlineAnalysis.js` | `get_stock_kline` — K 线数据 |
| `MoneyFlow.js` | `get_stock_money_flow` — 全档资金流向（主力/超大单/大单/中单/小单） |
| `Industry.js` | `get_stock_industry` — 行业分析 |
| `MarketIndices.js` | `get_market_indices` — 大盘指数 |
| `WebSearch.js` | `web_search` / `web_fetch` — 联网搜索（东方财富新闻库，按时间倒序返回最新财经新闻）；systemPrompt 统一为四步先搜索流程（拆词→搜索→叠加本地工具数据→综合回答）+ 权威来源优先（证券时报/巨潮/交易所等官方媒体） |
| `Intraday.js` | `get_stock_intraday` — 当日分时走势 |
| `MarketOverview.js` | `get_hot_list` — 实时热榜 |
| `StockSearch.js` | `search_stocks` — 股票名称/代码搜索 |
| `UserContext.js` | `read_user_profile` / `save_user_profile` — 用户画像 / `get_fx_rate` — 港元汇率 |

> 除 `call_llm` / `call_llm_stream`（AI 对话自身接口）外，全部 19 个 Rust 命令已开放为 AI 工具。

### 3.3 核心子系统

- **持仓**: `usePositions` + `PositionModal`，localStorage 持久化，每 30s 刷新实时价计算盈亏，AI 对话时自动注入。港股自动识别（5 位代码），按港币→人民币汇率换算后汇总显示
- **用户画像**: `useUserProfile` + `ProfileModal`，Markdown 文件存 `app_data_dir`，AI 每次回复后自动更新（`deepseek-v4-flash` 静默失败），支持手动编辑
- **自选通知**: `useWatchlistNotifications`，涨停/跌停/±7%/±5%/快速拉升下跌(30s≥2%)，每股票每类型每日一次；涨跌停阈值按板块判断（主板 ±10%/创业板科创板 ±20%/北交所 ±30%/港股无涨跌停，ST 与所属板块一致）
- **全局设置**: `useSettings` + `SettingsModal`，5 标签页（通知/刷新/图表/AI/关于），实时生效
- **AI 双入口**: 个股 AI（AiAnalysisModal，注入行情/K线/资金/行业/筹码/持仓上下文，自动学习画像）；顶部全局 AI（GlobalAiModal，注入大盘指数+持仓，`@代码` 快捷引用个股行情并复用个股上下文，同样学习画像；历史消息按 6000 字符预算裁剪防 token 超限）
- **AI 联网搜索策略**: 联网开关（设置 AI 页 + 弹窗顶部「联网」toggle）对**所有 AI 入口统一生效**（个股 AI、全局 AI、@代码 快捷引用）。开启时 AI **先搜索再回答**：拆关键词 → `web_search` → 叠加本地工具数据（行情/K线/资金/指数）→ 综合回答；关闭时搜索 skill 的提示词与工具一并剔除（`system-prompt.md` 的 `{{SEARCH_POLICY}}` 占位符 + `getMergedSystemPrompt({ excludeSkills })` 动态注入）
- **全局快捷键**: `Ctrl+K` 聚焦搜索框、`Ctrl+N` 打开全局 AI（`tauri-plugin-global-shortcut`，注册失败静默降级；迷你窗口不注册）
- **单例应用**: `tauri-plugin-single-instance` — 重复启动时聚焦已有主窗口（主窗口不存在则聚焦迷你窗口），新实例直接退出，防止多开
- **系统托盘**: `tray-icon` 特性 — 点击主窗口关闭按钮 → 隐藏到右下角托盘（不退出，首次隐藏发通知提示）；右键托盘图标菜单「显示主窗口 / 退出」；左键单击/菜单项恢复主窗口；迷你窗口关闭仍为正常关闭
- **迷你置顶模式**: TitleBar 按钮 → 新开无边框置顶小窗（`?mini=1`），自选股实时行情 10s 刷新，双击行 `mini-select-stock` 事件联动主窗口选中并聚焦；App.vue 与 MiniMode 各自独立定时器
- **问财选股窗口**: 顶部「选股」按钮 → 新开独立窗口（`?iwencai=1`，960×720 可调），自然语言选股；结果行点击 → `iwencai-select-stock` 事件联动主窗口选中并聚焦后自动关闭

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
| `get_market_indices` | Tencent（并行） | 七大指数（失败兜底条目用真实名称，非裸代码） |
| `search_stocks` | Tencent | 股票搜索 |
| `get_hot_list` | 同花顺 | 实时热榜 |
| `call_llm` | DeepSeek | AI 非流式 |
| `call_llm_stream` | DeepSeek SSE | AI 流式 → `llm-chunk`/`llm-done`/`llm-error` |
| `read_user_profile` | 本地文件 | 读取画像 md |
| `save_user_profile` | 本地文件 | 保存画像 md |
| `web_search` | 东方财富搜索 API | 财经新闻搜索（按时间倒序返回最新新闻，带发布时间/来源媒体；本地 site: 域名过滤兼容） |
| `web_fetch` | 目标 URL | 网页抓取（JSON-LD→转义HTML→正文容器→meta 四级提取，限 50000 字符） |
| `get_fx_rate` | Frankfurter API | 港元兑人民币汇率（CNY/HKD） |
| `get_iwencai_robot` | 问财 get-robot-data | 自然语言选股（需 Cookie v，由前端 WebView 执行 `public/chameleon.js` 生成；响应为 UTF-8 JSON，datas 为对象数组） |
| `get_app_version` | 本地 | 当前应用版本（CARGO_PKG_VERSION） |
| `check_for_update` | GitHub API | 检查最新 Release（限流 60 次/时/IP；`v` 前缀剥离后语义化比较） |

### 4.2 数据源特征

| 文件 | 编码 | 注意 |
|------|------|------|
| `tencent.rs` | **GBK** → `encoding_rs::GBK.decode()` | `~` 分隔，无反爬；支持批量行情接口 `q=` 多代码逗号拼接（A 股） |
| `eastmoney.rs` | UTF-8 | JSON/JSONP/HTML，有 CDN/WAF |
| `hotlist.rs` | UTF-8 | JSON API |
| `llm.rs` | UTF-8 | OpenAI 兼容；V4 工具调用需回传 `reasoning_content`（否则 400）；`thinking_enabled` 控制思考模式 |
| `web.rs` | UTF-8（charset 自动解码 GBK） | 东财搜索 API（search-api-web.eastmoney.com JSONP，sort=time 最新优先）；正文提取: JSON-LD articleBody → JSON 转义 HTML（腾讯）→ 正文容器/class → meta description；反爬站过滤（zhihu/baike/douban 等 8 个）；`site:域名` 本地过滤兼容 |
| `iwencai.rs` | UTF-8 | 问财选股（`data.answer[0].txt[0].content.components[0].data`；columns 为 `label/key/index_name`，datas 为对象数组；meta.extra 含 row_count/token/condition；必须带 Cookie v + 浏览器 UA/Referer/Origin） |

### 4.3 代码转换 (helpers.rs)

```
A 股:  600xxx → "SH600xxx" / "sh600xxx"  (东方财富 / 腾讯)
       其他   → "SZxxxxxx" / "szxxxxxx"
港股:  00700  → "HK00700"  / "hk00700"    (5 位数字代码)
       secid  → "116.00700"              (东方财富资金流向)
```

---

## 5. 设计系统

- **调色板**: Rust `#5d2a1a` / Apricot Wash `#fbe1d1` / Sky Wash `#d3e3fc` / Ink `#17191c`
- **圆角**: cards 24px / inputs 16px / images 12px / pills 9999px
- **字体**: Signifier (serif, 标题) + Sohne (无衬线, 正文) via Google Fonts
- **禁止**: 饱和蓝/绿/红作为框架色、边框 >1px、渐变背景
- **弹窗**: 8 个 modal 统一使用 `assets/modal.css` 共享样式
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

---

## 7. 关键约定

1. **GBK 编码**: 腾讯 API 返回 GBK，必须 `encoding_rs` 解码
2. **竞态保护**: 切换股票时丢弃旧请求结果 (`useMoneyFlow` / `useKlineData` / `useIntradayData`，后两者用请求序号) 
3. **HTTP 客户端全局复用**: `api/mod.rs` 用 `OnceLock` 缓存 `reqwest::Client`（`build_http_client` 15s 超时 / `build_llm_http_client` 无总超时+90s 空闲池），避免每次请求重建连接
4. **V4 reasoning_content**: 思考模式下 assistant 消息须回传此字段，否则 400
5. **资金双数据源**: 腾讯优先 → 东方财富备选（push2 偶发连接重置）
6. **港股兼容**: `helpers.rs` 中 `is_hk_stock()` 通过代码长度（5 位）检测港股；腾讯 API 前缀 `hk`，东方财富 secid `116.xxx`，前端自动切换 HK$ 货币符号和市场标签
6. **CSP 加固**: `tauri.conf.json` 已配置 CSP（`default-src 'self'` + `style-src 'unsafe-inline'`，IPC 需 `connect-src ipc: http://ipc.localhost`，dev 需 `ws://localhost:1420` 供 Vite HMR）；前端无远程资源引用（字体已本地化）
7. **文件变动 → 同步更新本文档**（新增/删除文件、Tauri 命令、composable/skill 等）

