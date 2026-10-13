# stock-analysis — A 股 + 港股桌面分析工具

> **Tauri 2 + Vue 3 + Rust** · 数据源: 腾讯财经 / 东方财富 / 同花顺 · AI: DeepSeek API · 图表: Lightweight Charts™ · 构建: Vite + pnpm
>
> 🤖 AI 代理：开工前先读本文件；配合根目录 `AGENTS.md`（会话自动注入的短指令）。文件变动须同步本文档（§7.9）。

## 1. 项目骨架

```
stock-analysis/
├── AGENTS.md                   AI 代理必读指令（DSH 会话自动注入）
├── PROJECT.md                  本文档（架构/约定真源）
├── src/                        Vue 前端
│   ├── App.vue                 入口：窗口/定时器/跨窗口联动
│   ├── components/             布局/列表/详情/弹窗/迷你窗 + 标题栏市场状态胶囊 + 数据新鲜度角标(DataFreshness) + 信号回测弹窗(BacktestModal) + settings/(5) + ai/(4)
│   ├── composables/            30 个（§3.1）
│   ├── skills/                 12 skill / 17 工具（§3.2）
│   ├── prompts/                system-prompt.md（AI 提示词模板，§3.4）
│   └── utils/                  format / limit（涨跌停按板块）/ marketTime（交易日历+时段）/ hkHolidays（港股公众假期表）/ notify / klineCache / history（本地历史库落库）
├── src-tauri/                  Rust 后端
│   ├── .cargo/config.toml      USTC sparse 镜像（勿删）
│   ├── capabilities/           default.json 窗口权限：main/mini/iwencai
│   └── src/
│       ├── commands.rs         26 个命令（§4.1）
│       ├── db.rs               本地历史库（SQLite / rusqlite，§4.4）
│       ├── types.rs / helpers.rs（代码转换 §4.3）
│       └── api/                tencent / eastmoney / hotlist / calendar / llm / web / iwencai
└── public/
```

## 2. 数据流

App.vue → composables/useXxx.js → invoke → commands.rs → api/（tencent 腾讯 GBK / eastmoney 东财 / hotlist 同花顺 / calendar 同花顺交易日历 / llm DeepSeek SSE / web 搜索+抓取 / iwencai 问财）

模式：每个 composable 返回 `{ data, loading, load(), ... }`，App.vue 统一调用、props 下发。

**旁路落库**：`commands.rs` 在行情/K线/资金成功返回时顺手写入本地历史库（`db.rs`），失败静默不阻断；前端另经 `utils/history.js` 写入信号/提醒/自选变更事件。

## 3. 前端模块

### 3.1 Composables（30 个）

**数据加载**（`useKlineData`/`useIntradayData`/`useStockSearch`/`useIndustryData` 用请求序号防竞态；`useMoneyFlow` 用选中态比对）：

| 文件 | 用途 | 命令 |
|------|------|------|
| `useQuoteLoader` | 批量行情 | `get_stock_quote(s_batch)` |
| `useStockSearch` | 搜索（防抖） | `search_stocks` |
| `useKlineData` / `useIntradayData` | K线周期 / 分时（另返回 `fetchedAt`/`stale` 供数据新鲜度角标；**刷新失败保留旧数据**，仅换标的时清空） | `get_stock_kline` / `get_stock_intraday` |
| `useMoneyFlow` | 资金流向 + 近 30 日历史（2min 节流） | `get_stock_money_flow(_history)` |
| `useIndustryData` / `useMarketIndices` | 行业 / 指数 | `get_stock_industry` / `get_market_indices` |
| `useAiAnalysis` | AI 对话：Agent 循环 10 轮上限、流式切股代际守卫、@代码/热榜选股、注入预计算指标 | `call_llm(_stream)` |
| `usePositions` / `useUserProfile` | 持仓+盈亏（港股汇率换算）/ 画像读写 | `get_fx_rate` / `read_save_user_profile` |
| `useIwencaiRobot` + `iwencaiClient` | 问财窗口 + 共享凭证模块（chameleon.js 生成 Cookie v、403 换 v、LRU 50 缓存，**缓存 key = 归一化问题 + perpage**——服务端忽略 page、perpage 决定行数，故不能只按问题缓存；窗口与 AI 工具共用） | `get_iwencai_robot` |
| `useSignalBacktest` | 信号回测与胜率统计：读本地日 K 跑 8 条日线规则 × 4 持有期（非重叠交易），本地不足 60 根或手动同步时补拉远端一次并落库；纯函数 `analyzeBars(bars, code)` 可单测 | `get_kline_history` / `get_db_stats`（+ `get_stock_kline`） |

**纯计算**：`useTechIndicators`（MACD/KDJ/RSI/WR，AI 预计算注入复用）、`useChipDistribution`（筹码）、`useSupportResistance`（支撑/阻力）、`useT0Signals` + `useTrapSignals` + `useVolumeSignals`（T+0 信号/量价陷阱/量价信号，细节见文件注释）、`aiContext`（提示词构建，§3.4）

**状态与持久化**：`useWatchlist`（自选 CRUD，默认股票池只作首次种子且返回深拷贝、持久化的空数组视为用户已清空不再回填默认股）、`useSettings`（全局设置单例）、`useTradingCalendar`（A 股交易日历单例，lazy 注入 `marketTime.js`）、`useWatchlistNotifications` / `useMaAlerts` / `usePriceAlerts`（三套通知，跨日重置快照防隔夜跳空；**后两者为单例**——`App.vue` 与配置弹窗共用同一实例）、`aiMessageStore`（AI 消息隔离持久化）、`llmClient`（SSE 流式，streamId 过滤 + 120s 超时）

**窗口与系统**：`useChildWindows`（子窗口管理）、`useGlobalShortcuts`（Ctrl+K 搜索 / Ctrl+N 全局 AI）

### 3.2 Skills（12 skill / 17 工具）

`index.js` 合并 tools/toolImpl/systemPrompt；新增 skill → 创建文件 → 加入 `SKILLS` 数组。

| Skill | 工具 |
|-------|------|
| `StockQuote` | `get_stock_quote` / `get_stock_quotes_batch` |
| `KlineAnalysis` | `get_stock_kline`（day/week/month + m5/m15/m30/m60；分钟级 date=`yyyyMMddHHmm`、无复权、港股不支持；返回 `{close, ma:{MA5,MA10,MA20}, vsMA5Pct, bars}`——均线与 MA5 偏离度由系统算好，供「站上/贴近 5 日线」筛选直接引用） |
| `MoneyFlow` | `get_stock_money_flow` / `get_stock_money_flow_history` |
| `Industry` / `MarketIndices` / `Intraday` / `MarketOverview` / `StockSearch` | `get_stock_industry` / `get_market_indices` / `get_stock_intraday` / `get_hot_list` / `search_stocks` |
| `WebSearch` | `web_search` / `web_fetch`（**四步搜索流程 + 关键词铁律唯一真源**） |
| `IwencaiSelect` | `stock_screener`（问财选股，≤100 只全量返回、每轮 ≤2 次防限流） |
| `StockPicks` | `render_stock_picks`（选股结果卡片，`PICKS_MARKER` 前缀 → `msg.picks` 渲染） |
| `UserContext` | `read/save_user_profile` / `get_fx_rate` |

> 未开放为 AI 工具的命令：`call_llm` / `call_llm_stream`（AI 自身管道）、`get_trading_calendar`（前端时段判断内部使用）、`get_app_version` / `check_for_update`（应用级）。

### 3.3 核心子系统（一行一系统）

- **持仓**: 30s 刷新盈亏，AI 对话注入；港股（5 位代码）按汇率换算
- **画像**: md 存 `app_data_dir`；AI 后台增量更新（10min 节流 + 短消息跳过，写串行化）
- **三套通知**（自选/均线/价格，共用 `utils/marketTime.js` + `notify.js` + `klineCache.js`）: 每股票每日每类型一次、仅交易时段、**跨日重置快照防隔夜跳空误报**；价格提醒支持突破/跌破目标价 + 放量条件，一次性/每日模式；**均线/价格提醒为单例**（`App.vue` 与 `PriceAlertConfig.vue`/`MaAlertConfig.vue` 共用同一实例，弹窗内新增/删除的配置立即可被轮询使用，且删除时不会用启动快照覆盖 localStorage）
- **资金流向可视化**: `MoneyFlowModal` — 当日 5 档快照 + 近 30 日主力净流入柱状图（东财 push2his，万元）
- **本地历史库**: `db.rs`（rusqlite bundled，WAL，`app_data_dir/stock-analysis.db`）——6 表（`quote_snapshot` / `kline` / `money_flow`（当日快照与近 N 日历史同表，主键 `code+date`）/ `signal_event` / `alert_event` / `watchlist_change`）+ 3 索引，`PRAGMA user_version` 迁移；行情快照 60s/code 节流、保留 30 天，事件表保留 180 天，启动时 `prune()`；**落库全部走旁路**（失败仅 eprintln，绝不影响行情返回）；日期由 SQL `date('now','+8 hours')` 生成（与 §7.13 本地时区一致）
- **信号回测面板**: `BacktestModal.vue` + `useSignalBacktest.js` — 对本地历史日 K 跑 8 条日线规则（MA5×MA10 金叉、多头排列首次成立、MACD 金叉、KDJ 低位金叉、RSI 上穿 30、突破前 60 根最近阻力、放量上涨、逼近涨停）× 4 持有期（1/3/5/10 日），**非重叠交易**统计胜率 / 平均收益 / 盈亏比 / 最大回撤；样本 <10 笔标「样本不足」；**T+0/量价陷阱等日内信号依赖分时数据，不在回测范围**（面板内已明示，避免误读口径）
- **分时量价信号/陷阱**: `useTrapSignals`（诱多?/诱空? 疑似定性 + 强度分级）+ `useVolumeSignals`（前瞻预警⚠/突破破位/顶底背离）并入 T+0 链路；量能基准 i-30..i-11 滞后滚动中位数、同类型去重；**数据门槛 10 根**（早盘前瞻预警实时可用，突破/破位、背离由内部预热 i>=30/i>=15 控制）；细节见文件注释
- **全局设置**: 5 标签页实时生效
- **AI 双入口**: 个股 AI（注入行情/K线/资金/行业/筹码/持仓 + 预计算指标）；全局 AI（注入指数/持仓，@代码 引用，热榜选股）
- **AI 选股**: 问财窗口「AI 分析这批股票」→ `iwencai-ai-analyze` → 全局 AI `injectContextMessage` 注入结果表（`_injected` 不持久化）；`render_stock_picks` 渲染选股卡片（加自选/查看详情）；短线买入清单带**贴线硬性条件**（现价须在 MA5 之上且偏离 ≤3% 优先、>5% 剔除，用 `get_stock_kline` 的 `ma.MA5`/`vsMA5Pct` 核验）
- **联网搜索**: 开关全局生效；完整流程只维护在 `WebSearch.js`
- **交易日历 / 市场状态**: A 股由 `useTradingCalendar` 拉取 `get_trading_calendar` → 注入 `marketTime.js` 模块级 Set；港股由静态公众假期表 `utils/hkHolidays.js`（2024–2027，每年随 GovHK 公告追加翌年；未收录年份返回 `null` → 退回周一~周五判定，功能不中断）。两者最终统一由 `marketTime.getMarketStatus(code, at)` 输出状态（`pre/open/break/post/holiday` + `minutesToClose`），`isTradingHours(code, at)` 只是它的一层包装 —— 轮询守卫与 UI 口径同源；**港股仅当自选/持仓含 5 位代码时才纳入 `isMarketSession`**（否则 A 股休市日完全零轮询）；A 股接口窗口固定 `[今日-1年, 今日]`，只对拉取当日及之前有效 → 日缓存 + 跨日自动刷新；无 Key / 请求失败静默降级回周末判断；**不含港股「八号风球/黑色暴雨」临场停市**（临时决定，无法静态维护）
- **标题栏市场状态胶囊**: `MarketStatusPill.vue`（A 股常显，自选/持仓含港股时追加港股）显示 未开盘 / 开盘中 / 午间休市 / 已收盘 / 休市 + 距收盘倒计时；盘中 1 秒刷新、盘外对齐到下一个整分钟（纯本地计算，不产生请求）；日历未就绪时悬浮提示「暂按工作日判定」；**点击胶囊 = 手动刷新全部行情**（刷新中显示「刷新中…」，键盘 Enter/Space 同效）
- **数据新鲜度标注**: `DataFreshness.vue` 角标显示行情/K 线/分时的最近成功时间（`HH:mm`）；刷新失败时保留旧数据、标注「更新失败 + 重试」，价格行与图表转灰（`.is-stale`）—— 旧行为是失败即清空导致图表闪空，且用户无法分辨数据新旧
- **窗口不可见降频**: 最小化（`document.visibilitychange`）或关窗进托盘（Rust emit `main-window-hidden` / 恢复 emit `main-window-shown`）时四个间隔 ×`HIDDEN_REFRESH_FACTOR`(4)，恢复可见立即补刷一次并恢复原间隔（子窗口不参与）
- **快捷键/单例/托盘/时段感知**: Ctrl+K / Ctrl+N；single-instance；关窗隐藏托盘；四定时器经 `sessionTick` 守卫，盘外零请求
- **子窗口**: 迷你 `?mini=1`（10s 刷新）、问财 `?iwencai=1`（本地分页；AI 优化查询）

### 3.4 AI 提示词体系（改提示词必读）

- **模板**: `prompts/system-prompt.md`，占位符 `{{BEIJING_TIME}}`/`{{SEARCH_POLICY}}`/`{{PRELOAD_SECTION}}`/`{{SKILL_PROMPTS}}`/`{{USER_PROFILE}}`/`{{MARKET_RULES}}`/`{{STOCK_CONTEXT}}`（无 `{{TOOLS}}`，工具走 API 参数）
- **填充**: `aiContext.js` `buildSystemPrompt`（个股）+ `useAiAnalysis.js` `buildGlobalSystemPrompt`（全局）；公共常量 `MARKET_RULES`/`buildSearchPolicy` 在 `aiContext.js`；占位符残留校验
- **独立提示词**: ① `IwencaiWindow.vue optimizeQuery()`（AI 改写查询）；② `GlobalAiModal.vue buildScreeningPrompt()`（问财结果注入 + 短线买入/贴线条件）；改动时同步本行
- **注入**: `serializeContext` → K线 30 根 + MA 最新值 + 预计算指标 + 资金/行业/指数/热榜/持仓/筹码
- **硬约束**: 数值必须来自工具返回，失败明示「数据获取失败」，禁编造

## 4. Rust 后端

### 4.1 Tauri 命令（26 个）

| 命令 | 数据源 | 说明 |
|------|--------|------|
| `get_stock_quote(s_batch)` / `get_stock_kline` / `get_stock_intraday` | Tencent | 行情 / 批量（A 股 50 只/批，港股逐只）/ K线（日周月+分钟，§4.2）/ 分时 |
| `get_stock_money_flow(_history)` | Tencent → 东财备选 | 资金 5 档 / 近 N 日历史（默认 30，万元，升序勿反转；双数据源 §7.4） |
| `get_stock_industry` / `get_market_indices` | 东财 / Tencent | 行业（港股空）/ 六大指数（上证/深证/创业板/沪深300/科创50/中证500，失败兜底真实名称） |
| `search_stocks` / `get_hot_list` | Tencent / 同花顺 | 搜索 / 热榜 |
| `get_trading_calendar` | 同花顺 Fuyao | A 股交易日历（近一年，`yyyy-MM-dd` 升序；需 `X-api-key`，无 Key 报 `[NO_API_KEY]`） |
| `call_llm` / `call_llm_stream` | DeepSeek | 非流式 / SSE 流式（§4.2） |
| `read/save_user_profile` / `web_search` / `web_fetch` / `get_fx_rate` | 本地 / 东财 / URL / Frankfurter | 画像 / 新闻搜索 / 正文抓取（SSRF 防护 §4.2）/ 汇率 |
| `get_iwencai_robot` | 问财 | 选股（Cookie v + 浏览器头；page 忽略，perpage ≤100） |
| `get_app_version` / `check_for_update` | 本地 / GitHub | 版本 / 更新（直连失败回退系统代理） |
| `record_signal_events` / `record_alert_events` / `record_watchlist_change` | 本地库 | 前端上报信号 / 提醒触发 / 自选变更事件（去重键见 §4.4） |
| `get_kline_history` / `get_db_stats` | 本地库 | 供回测读取日 K（升序，≤2000 根）/ 库概况（行数、只数、日期跨度、文件大小） |

### 4.2 数据源特征（quirk 唯一真源）

| 文件 | 编码 | 注意 |
|------|------|------|
| `tencent.rs` | **GBK** → `encoding_rs` | `~` 分隔无反爬；分钟 K（m5/m15/m30/m60）走 mkline（320 根、无复权、**港股不支持**），日周月走 fqkline（前复权 120 根）；分时按市场交易时段过滤（剔盘后零星成交）；**累计成交量单位按市场归一**——A 股/北交所为「手」（均价分母 ×100 换算成股），港股原值是「股」（×1，且分钟量 ÷100 归一到「手」）；分时时间戳 `HHmm` 需 `len==4 && is_ascii` 才切片；资金流字段需 `≥41` 段否则报 `NO_DATA` 交东财兜底 |
| `eastmoney.rs` | UTF-8 | push2 主域被 WAF 拦，用 push2delay → push2his 兜底 |
| `llm.rs` | UTF-8 | V4 回传 `reasoning_content`；SSE 兼容 `\n\n`/`\r\n\r\n` + 流末 flush 尾块；`data:` 有/无空格；LLM client 240s 读超时 |
| `web.rs` | UTF-8（无 charset 头探测 GBK） | sort=default 相关性排序；中文无空格按子串剥泛词；四级正文提取；反爬站过滤；**SSRF 防护**（私网拒绝、禁跨主机重定向、≤50MB）；JSON 反转义按 UTF-16 处理 `\uXXXX`（**支持代理对**，孤立代理项转 `U+FFFD` 而非 panic/丢字） |
| `iwencai.rs` | UTF-8 | 路径 `data.answer[0].txt[0].content.components[0].data`；**同 v 4-6 次 → 403（换 v 恢复）；带 condition 必 403**；风控带 `[RATE_LIMITED]` 标记 |
| `hotlist.rs` | UTF-8 | JSON API |
| `calendar.rs` | UTF-8 | 同花顺 Fuyao：需 `X-api-key`；**无参数**，固定返回 `[今日-1年, 今日]` 交易日（`yyyyMMdd` → 转 `yyyy-MM-dd` 升序去重）；**仅 A 股，无港股**；业务错误走 HTTP 200 + `code≠0`（2001 无 Key / 2003 无权限 / 4001 限流） |

### 4.3 代码转换 (helpers.rs)

```
A 股:  600xxx/900xxx(沪B) → SH / sh | 其他 → SZ / sz
港股:  00700 → HK00700 / hk00700 / secid 116.00700（5 位数字）
北交所: 43/82/83/87/88/92 → BJ / bj / secid 0.（东财归入 0 市场）
```

### 4.4 本地历史库 (db.rs)

```rust
static DB: OnceLock<Mutex<Connection>>   // 单连接 + WAL；Connection 为 Send，可在 async command 内直接锁用
init(app_data_dir)  → create_dir_all → migrate(PRAGMA user_version) → prune()
```

| 表 | 主键 / 去重 | 保留 |
|----|------------|------|
| `quote_snapshot` | (code, ts)，写入按 code **60s 节流** | 30 天 |
| `kline` | (code, period, date)，整表 upsert | 全量（≤2000 根/次读取） |
| `money_flow` | (code, date)（当日快照 + 历史行同表） | 全量 |
| `signal_event` | UNIQUE (code, date, kind, name, time) | 180 天 |
| `alert_event` / `watchlist_change` | 自增（不去重） | 180 天 |

- 写入 API：`record_quotes` / `record_kline` / `record_money_flow(_history)` / `record_signal_events` / `record_alert_events` / `record_watchlist_change`；查询：`query_kline` / `stats()`。
- **旁路为准**：行情/K线/资金命令内的落库是 `void`（`silent()` 包一层，失败只 stderr）；`record_*_events` 三个命令会返回 `Result`，但前端 `utils/history.js` 一律 `.catch(() => {})` 忽略——落库失败绝不阻塞主流程。全库不引 chrono，日期由 SQL `date('now','+8 hours')` 生成。
- 事务写法：`conn.unchecked_transaction()` + 语句块 `{}` 包住 `prepare`，必须先于 `tx.commit()` 出作用域（否则借用冲突）。
- 回测数据来源于 `kline` 表：K 线每次刷新都会整表 upsert，**本地历史随日常使用自然增厚**；`get_stock_kline` 远端只给 120 根（§4.2），故首次回测需点「同步更多历史」补齐。

## 5. 设计系统

调色板 Rust `#5d2a1a` / Apricot `#fbe1d1` / Sky `#d3e3fc` / Ink `#17191c`；圆角 cards 24 / inputs 16 / images 12 / pills 9999px；字体 Signifier + Sohne 已本地化；**禁止**饱和蓝/绿/红框架色、边框 >1px、渐变背景；弹窗统一 `modal.css`。

分时图参考线 = 昨收灰虚线 + 今开蓝虚线 + 最高红点线 + 最低绿点线 + 涨跌停红/绿虚线（按板块阈值，港股不画涨跌停）；信号标记按**形状分层配色**（橙圆点=预警⚠、红绿箭头=方向/偏离、方块=陷阱确认/背离）——细节见 KlineChart/IntradayChart 注释。

## 6. 开发命令

```bash
pnpm install / dev / build / tauri dev / tauri build
cargo check        # 需 Rust ≥ 1.85（time-core 0.1.8 要求 edition2024）
```

> `src-tauri/.cargo/config.toml` 内置 USTC sparse 镜像（覆盖用户全局失效镜像，勿删）。前端 vendor 分包（charts/markdown/vue 三 chunk）。PowerShell `2>&1` 下构建误报 exit 1 属正常，以 `✓ built`/`Finished` 为准。
>
> **本机 cargo 联网受限（根因已定位并已修复）**：cargo 进程内的 libcurl 线程解析器不可用（报 `[6] Could not resolve hostname (getaddrinfo() thread failed to start)`；同期 `curl` / `python` / `nslookup` 解析均正常），而 cargo **不读 Windows 系统代理（WinINET）**，只认 `http.proxy` 配置与 `HTTP(S)_PROXY` 环境变量，于是直连时 `cargo add` / `update` / `fetch` 一律失败（表现为 `failed to query replaced source registry crates-io`）。本机 Clash Verge Ninja 的 `mixed-port = 6789`，**已在用户级 `~/.cargo/config.toml` 写入 `[http] proxy = "http://127.0.0.1:6789"`**：cargo 改为连数字 IP 的本地代理、域名解析交给代理，实测 `cargo add --dry-run serde` EXIT=0（此前 EXIT=101）。Clash 未启动时新增依赖会报 `[7] Could not connect to server (... via 127.0.0.1)`。另：Rust 依赖已全量灌入 `~/.cargo/registry` 里 **USTC 源身份**的索引与 `cache/*.crate`（约 543 个包），故 `cargo check` / `cargo build` / `pnpm tauri build` 无网络也能跑完。**勿为联网改掉 `src-tauri/.cargo/config.toml` 的 USTC 源**——换镜像=换源身份，会再触发一轮全量重编 `target/`。本机 `.git/config` 的 `http.proxy` / `https.proxy` 指向同一代理，Clash 未开时 `git fetch/push` 会失败。
>
> **构建配置现状**（`vite.config.js`，已实测调优，勿随意改动）：`target: esnext` + `cssMinify/transformer: lightningcss` + `reportCompressedSize: false` + `checks.pluginTimings: false`（关闭 rolldown 的 `[PLUGIN_TIMINGS]` 提示——该统计按 hook 跨度计，`vite:css` 的 async 回调在等 resolve/读文件期间与其他回调重叠、跨度被重复计入，实测剥离全部 SFC `<style>` 后整条 CSS 管线仅占约 10% 构建耗时，而报告显示 46%）。真实热点是 Vue SFC 编译（`@babel/parser` 解析模板表达式/`<script setup>` + `@vue/compiler-core` 代码生成 ≈ 28%，框架固有、无配置可调）；A/B/C 实测去掉 lightningcss transformer / 去掉 manualChunks 差异均在 ±7% 噪声内。排查构建耗时用 `node --cpu-prof node_modules/vite/bin/vite.js build`。

## 7. 关键约定

1. **GBK 编码**: 腾讯 API 必须 `encoding_rs` 解码
2. **竞态保护**: 切换股票丢弃旧响应——请求序号（Kline/Intraday/Industry/Search/Iwencai）、选中态比对（MoneyFlow）、代际守卫（AiAnalysis `streamGeneration`）
3. **HTTP 客户端**: `api/mod.rs` OnceLock 复用（通用 15s / 代理 20s / LLM 10s 连接 + 240s 读超时；`web_fetch` 单独构建带重定向策略）
4. **资金双数据源**: 腾讯 ff_ 已失效 → 东财 push2delay 优先 → push2his 兜底；先试腾讯、NO_DATA 降级东财
5. **港股/北交所兼容**: `helpers.rs` 按长度与前缀判断市场，前端自动切货币符号
6. **Markdown 必须消毒**: `marked.parse` 输出须经 `DOMPurify.sanitize` 才能 `v-html`；外部数据先转义
7. **安全**: TLS 不降级（禁 `danger_accept_invalid_certs`）；CSP 已配（`connect-src ipc: http://ipc.localhost`）
8. **V4 reasoning_content**: 思考模式 assistant 消息须回传，否则 400
9. **文件变动 → 同步本文档**（新增/删除文件、命令、composable/skill 等）
10. **AI 提示词维护**: 三处位置——`system-prompt.md`（模板）/ `aiContext.js`（填充+公共常量）/ `skills/*.js`（各段），改后同步 §3.4；保留「数据必须真实」约束
11. **AI 必读文档**: `AGENTS.md`（自动注入短指令，保持精简 ≤64KB）+ 本文档（完整真源），细节一律下沉到本文档
12. **提醒类 composable 必须单例**: 轮询方（`App.vue`）与配置方（`*AlertConfig.vue`）必须拿到同一实例——否则弹窗内新增的提醒要到重启后才生效，`removeConfig` 还会把启动快照回写 localStorage 造成配置丢失
13. **本地日期一致性**: 所有 `YYYY-MM-DD`（`marketTime.getToday()` / `daysAgoISO`）都按本地时区拼接，禁用 `toISOString()`（UTC 会让东八区凌晨少算/多算一天，历史记录被提前裁剪）
14. **Tauri 事件监听须登记注销**: `listen()` 是异步的，组件卸载后才兑现的注销函数必须立即调用（`App.vue` `listenTracked`），否则事件通道泄漏
15. **市场判定唯一入口**: 任何「是否盘中 / 是否交易日」的判断都走 `utils/marketTime.js`（`getMarketStatus` / `isTradingHours`），禁止在组件里重写时段常量；港股假期表 `utils/hkHolidays.js` 每年随 GovHK 公告追加翌年（须整年完整，未收录年份自动退回工作日判定）
16. **刷新失败保留旧数据**: 行情/K 线/分时请求失败**不清空**已有数据（仅换标的/换周期时清空，`useKlineData`/`useIntradayData` 的 `dataKey` 决定），并置 `stale=true` 由 `DataFreshness` 角标标注——避免图表闪空、避免把上一只股票的数据画到新股票上
17. **窗口不可见必降频**: 隐藏信号取双来源——`document.visibilitychange`（最小化）+ Rust `main-window-hidden`/`main-window-shown` 事件（`lib.rs` 的 `window.hide()`/`show_main_window`，WebView2 的 `visibilityState` 不保证随窗口隐藏同步）；新增轮询定时器一律走 `effectiveInterval()`
18. **本地历史库是旁路**: 自动落库（`record_quotes` / `record_kline` / `record_money_flow*`）不向命令层返回错误，失败只 eprintln；`record_*_events` 三个命令虽返回 `Result`，前端 `utils/history.js` 也一律吞掉——落库失败绝不能影响行情返回或提醒发送。新增埋点数据照此办理：写库函数放 `db.rs`，命令只做参数转发
19. **回测口径必须如实标注**: 现有信号模块（`useT0Signals`/`useVolumeSignals`/`useTrapSignals`）**依赖分时数据，无法用日 K 回测**；`useSignalBacktest` 只回测日线级规则，UI 与文档必须同时声明「非重叠交易 + 固定持有期 + 不含日内信号 + 样本少于 10 笔仅供参考」，禁止在无标注的情况下展示胜率
20. **同一信号不重复入库**: `signal_event` 用 `UNIQUE (code, date, kind, name, time)`，前端 `recordSignalEvents` 对缺 name 的信号直接跳过——新增信号类型必须自带稳定的 `name`，否则每次轮询都会插入一行
