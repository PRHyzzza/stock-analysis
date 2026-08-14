# stock-analysis — A 股 + 港股桌面分析工具

> **Tauri 2 + Vue 3 + Rust** · 数据源: 腾讯财经 / 东方财富 / 同花顺 · AI: DeepSeek API · 图表: Lightweight Charts™ · 构建: Vite + pnpm
>
> 🤖 AI 代理：开工前先读本文件；配合根目录 `AGENTS.md`（会话自动注入的短指令）。文件变动须同步本文档（§7.10）。

---

## 1. 项目骨架

```
stock-analysis/
├── AGENTS.md                  AI 代理必读指令（DSH 会话自动注入）
├── PROJECT.md                 本文档（架构/约定真源）
├── src/                       Vue 前端
│   ├── App.vue / main.js      入口；App.vue 管窗口/定时器/跨窗口联动
│   ├── assets/                main.css（设计 token）+ modal.css（弹窗样式）
│   ├── components/            布局/列表/详情/弹窗/迷你窗 + settings/(5) + ai/(4)
│   ├── composables/           28 个（§3.1）
│   ├── skills/                13 skill / 17 工具（§3.2）
│   ├── prompts/               system-prompt.md（AI 提示词模板，§3.4）
│   └── utils/                 format.js / limit.js（涨跌停按板块）/ marketTime.js / notify.js / klineCache.js
├── src-tauri/                 Rust 后端
│   ├── .cargo/config.toml     USTC sparse 镜像（勿删）
│   ├── capabilities/          default.json 窗口权限：main/mini/iwencai
│   └── src/
│       ├── commands.rs        21 个命令（§4.1）
│       ├── types.rs / helpers.rs（代码转换 §4.3）
│       └── api/               tencent / eastmoney / hotlist / llm / web / iwencai / guba
└── public/
```

## 2. 数据流

App.vue → composables/useXxx.js → invoke → commands.rs → api/（tencent 腾讯 GBK / eastmoney 东财 / hotlist 同花顺 / llm DeepSeek SSE / web 搜索+抓取 / iwencai 问财 / guba 股吧）

模式：每个 composable 返回 `{ data, loading, load(), ... }`，App.vue 统一调用、props 下发。

## 3. 前端模块

### 3.1 Composables（28 个）

**数据加载（invoke 后端）**

| 文件 | 用途 | 命令 |
|------|------|------|
| `useQuoteLoader` | 批量行情 | `get_stock_quote` / `get_stock_quotes_batch` |
| `useStockSearch` | 搜索（防抖 + 序号竞态） | `search_stocks` |
| `useKlineData` / `useIntradayData` | K线周期切换 / 分时（序号竞态） | `get_stock_kline` / `get_stock_intraday` |
| `useMoneyFlow` | 资金流向（选中态竞态）+ 近 30 日历史（2min 节流） | `get_stock_money_flow` / `get_stock_money_flow_history` |
| `useIndustryData` | 行业分析（序号竞态） | `get_stock_industry` |
| `useMarketIndices` | 大盘指数 | `get_market_indices` |
| `useAiAnalysis` | AI 对话：Agent 循环 10 轮上限、流式切股代际守卫、@代码/热榜选股、注入预计算指标 | `call_llm` + `call_llm_stream` |
| `usePositions` | 持仓 + 盈亏（港股汇率换算） | `get_fx_rate` |
| `useUserProfile` | 画像读写（后台更新 10min 节流） | `read/save_user_profile` |
| `useIwencaiRobot` | 问财选股窗口（响应式状态 + 竞态保护） | `get_iwencai_robot` |
| `iwencaiClient` | 问财凭证/查询共享模块（chameleon.js 生成 Cookie v、403 换 v 重试、会话级查询缓存 LRU 50；窗口与 AI 工具 `stock_screener` 共用） | `get_iwencai_robot` |
| `useStockSentiment` | 社区情绪（股吧帖子 5min 缓存 + **短语优先/否定反转/问句识别**分类 + 回复/阅读**热度加权** + **计数明确度修正**的情绪档位；分类函数 `classifyTitle`/`deriveSentiment` 供 AI 工具复用） | `get_stock_guba_posts` |

**纯计算**

| 文件 | 用途 |
|------|------|
| `useTechIndicators` | MACD/KDJ/RSI/WR/EMA 纯函数（AI 预计算注入复用） |
| `useChipDistribution` | 筹码分布（三角形法） |
| `useSupportResistance` | 支撑/阻力（聚类 + 斐波那契） |
| `useT0Signals` | 日内 T+0 信号（含分时量价陷阱/量价信号标记合并） |
| `useTrapSignals` | 分时量价陷阱识别纯函数（诱多：放量冲高回落/高位滞涨/尾盘无量急拉/高开破均价；诱空：放量急跌收复/低位反转/尾盘急砸；输出强度分级 + 确认条件） |
| `useVolumeSignals` | 分时量价信号标注纯函数（整线扫描：放量↑↓/天量/缩量回踩·反抽/放量突破·破位/顶·底背离；同分钟去重 + 同类型 10 分钟间隔去重，防标记爆炸） |
| `aiContext` | 提示词构建 + 上下文序列化（§3.4） |

**状态与持久化**

| 文件 | 用途 |
|------|------|
| `useWatchlist` | 自选 CRUD（记录 addedPrice） |
| `useSettings` | 全局设置单例 |
| `useWatchlistNotifications` | 原生通知（跨日重置快照） |
| `useMaAlerts` | 均线提醒（MA5-60，日K 5min 缓存 LRU 100，跨日重置基准） |
| `usePriceAlerts` | 自定义价格/条件提醒（突破/跌破目标价 + 可选放量 N×5日均量；一次性/每日两种模式；穿越检测基于价格快照，跨日重置基准） |
| `aiMessageStore` | AI 消息按股票隔离持久化 |
| `llmClient` | SSE 流式客户端（streamId 过滤 + 120s 超时） |
| `fetcher` | `createDataFetcher()` 工厂（内置序号竞态） |

**窗口与系统**

| 文件 | 用途 |
|------|------|
| `useChildWindows` | 子窗口管理（迷你/问财，打开或聚焦已存在窗口） |
| `useGlobalShortcuts` | 全局快捷键（Ctrl+K 搜索 / Ctrl+N 全局 AI；子窗口不注册，回调经 handlers 注入） |

### 3.2 Skills（13 skill / 17 工具）

`index.js` 合并所有 skill 的 `tools` / `toolImpl` / `systemPrompt`；新增 skill → 创建文件 → 加入 `SKILLS` 数组。

| Skill | 工具 |
|-------|------|
| `StockQuote` | `get_stock_quote` / `get_stock_quotes_batch`（≤50 只批量对比，省工具轮次） |
| `KlineAnalysis` | `get_stock_kline`（day/week/month + **m5/m15/m30/m60 分钟级**；分钟级 date 为 `yyyyMMddHHmm`、无复权、港股不支持；含指标计算公式；上下文已有预计算值时直接引用） |
| `MoneyFlow` | `get_stock_money_flow` / `get_stock_money_flow_history`（近 N 日主力净流入趋势，默认 30 天） |
| `Industry` | `get_stock_industry` |
| `MarketIndices` | `get_market_indices` |
| `WebSearch` | `web_search` / `web_fetch`（**四步搜索流程 + 关键词铁律的唯一真源**） |
| `Intraday` | `get_stock_intraday` |
| `MarketOverview` | `get_hot_list` |
| `StockSearch` | `search_stocks` |
| `IwencaiSelect` | `stock_screener`（问财自然语言选股：条件翻译/结果压缩——**全量返回整个匹配列表 ≤100 只**，列白名单 ≤6 列 ≤12000 字符/每轮 ≤2 次防限流，复用 iwencaiClient） |
| `StockPicks` | `render_stock_picks`（选股/推荐结果卡片：toolImpl 返回 `PICKS_MARKER` 前缀 JSON，useAiAnalysis 拦截附到 `msg.picks`，AiChatMessages 渲染卡片 + 加入自选/查看详情按钮） |
| `SentimentAnalysis` | `get_stock_sentiment`（个股社区情绪：股吧帖子统计 + 情绪档位 + 热帖，复用 useStockSentiment 推导；提示词约束只依据返回帖子判断、提示水军/反话失真） |
| `UserContext` | `read/save_user_profile` / `get_fx_rate` |

> 未开放为 AI 工具的命令：`call_llm` / `call_llm_stream`（AI 自身管道）、`get_app_version` / `check_for_update`（应用级）。

### 3.3 核心子系统（一行一系统）

- **持仓**: 30s 刷新盈亏，AI 对话自动注入；港股（5 位代码）按汇率换算汇总
- **画像**: md 存 `app_data_dir`；AI 后台增量更新（10min 节流 + ≤10 字消息跳过，写串行化防覆盖）
- **自选通知**: 涨停/跌停/±7%/±5%/快速涨跌(30s≥2%)，每股票每类型每日一次；**跨日重置价格快照**防隔夜跳空误报；港股无涨跌停但 ±5%/±7% 生效
- **均线提醒**: MA5/10/20/30/60 + 上穿/下穿/双向，每日每周期一次、仅交易时段；**跨日重置基准**防隔夜跳空误判穿越；删自选连带清配置。与价格提醒共用详情页"提醒"按钮 → `AlertsModal`（双 Tab：均线/价格，主体为 `MaAlertConfig`/`PriceAlertConfig`）
- **价格提醒**: 任意股票（不限自选）突破/跌破目标价，可选放量条件（当日量 ≥ N×5日均量，日K 5min 缓存）；一次性（触发自动暂停）或每日（每交易日一次）模式；穿越检测基于价格快照、跨日重置防跳空误报。入口为合并的"提醒"弹窗（见上）
- **通知基础设施**: 三套通知共用 `utils/marketTime.js`（getToday/isTradingHours/pruneHistory）+ `utils/notify.js`（权限确保/sendAlertNotification）+ `utils/klineCache.js`（日K 5min 共享缓存，LRU 100）——自选通知/均线提醒/价格提醒均复用，改动通知逻辑先看这三处
- **资金流向可视化**: 详情页"资金流向"按钮 → `MoneyFlowModal`（复用 `MoneyFlowSection`：当日 5 档分档快照 + 近 30 日主力净流入柱状图（lightweight-charts，净流入红/净流出绿 + 紫色 MA5 均线 + 今日/5/10/20 日累计摘要）+ T+0 信号徽标）；数据源东财 push2his daykline（单位万元），前端 2min 节流防高频
- **分时量价陷阱**: `useTrapSignals` 纯函数并入 T0 信号链路——诱多嫌疑（放量冲高回落/高位放量滞涨/尾盘无量急拉/高开冲高破均价）与诱空嫌疑（放量急跌后收复/低位放量反转/尾盘低位放量急砸）识别；**量能基准同样用 i-30..i-11 滞后滚动中位数**；**放量强度 = 上升/下跌区间内最大连续 5 分钟均量 ÷ 基准**（全区间平均会被途中普通量稀释，脉冲放量会漏检）；**反后视镜设计**：① 冲高回落/急跌收复不等"回落/反弹 ≥50%"事后确认，而是找峰后**第一个跌破启动位/均价的分钟**（或谷后第一个收复点）即时标注，时间戳=实时确认点；② 尾盘无量急拉/急砸用**滚动 15 分钟窗口**（尾盘段内任一时点出现满足形态立即标，不必等收盘）；③ **"诱多/诱空"为疑似定性**（跌破/收复关键位只证明形态破坏，成立与否需后续走势验证）——标记文本用"诱多?"/"诱空?"，列表/chip 用"疑似诱多/疑似诱空"前缀，每个信号带 confirm 验证条件；输出强度分级（强/中/弱）；**同类型 15 分钟间隔去重**防连续满足条件时重复打标；分时图红↓/绿↑箭头标记（与偏离标记按 时间+文本 去重）+ T+0 摘要信号/风险 + 详情页分时模式下"量价陷阱"提示条（chip 悬停显示详情）
- **分时量价信号**: `useVolumeSignals` 纯函数整线扫描——**前瞻预警**（当下可判、不依赖后续数据：放量急拉⚠/放量急跌⚠ = 5 分钟动能 ≥0.6% + 量 ≥2.5×，无量拉升⚠ = 动能 ≥0.8% + 量 ≤0.4×，实盘反应点，先于陷阱确认）、放量突破·破位（30 分钟前高/前低明显越过 0.2% + 5 分钟动能 ≥0.5% + 量 ≥2×）、顶·底背离（显著新高/新低 ≥0.3% + 前 5 分钟量 < 前段 0.6× + 当前非放量）；**已移除三类**：普通放量↑↓（信息量低且与突破/破位重叠）、天量（无方向的事件标注，开盘/收盘竞价必触发，实盘无操作含义）、缩量回踩/反抽（弱二次确认，阴跌盘里频繁出现）；**量能基准 = i-30..i-11 滞后 10 分钟滚动中位数**（消除上下午量能系统性偏差，放量起点必被捕捉、持续放量回归常态）；**开盘不整体跳过**（仅剔除 09:30 集合竞价分钟，开盘放量急拉是重要信号）；同分钟去重（预警 > 突破 > 背离，**add 去重拒绝后继续检查该分钟低优先级信号**）+ 同类型 10 分钟间隔去重；标记并入分时图（同分钟陷阱优先），预警并入 T+0 信号列表（level=warn 带行动建议），计数与最近 6 条明细写入 T0 summary.raw
- **全局设置**: 5 标签页（通知/刷新/图表/AI/关于），实时生效
- **AI 双入口**: 个股 AI 注入行情/K线/资金/行业/筹码/持仓 + 预计算指标；全局 AI 注入指数/持仓，`@代码` 快捷引用（发送后清除），热榜选股（`hotStocks` 注入）；两处均开放 `stock_screener`（问财选股）工具
- **AI 选股**: 问财结果窗口「AI 分析这批股票」按钮 → `iwencai-ai-analyze` 事件 → 主窗口打开全局 AI 并 `injectContextMessage` 注入结果表（带 `_injected` 标记不持久化，跳过画像更新）；解读提示词含**超短线买入建议**（资金流/换手/量比/涨速筛选 3-10 只 + render_stock_picks 卡片，无标的不硬凑）；API Key 未配置时请求保留，配置后自动重试
- **选股卡片**: `render_stock_picks` 工具把 AI 选股结论渲染成聊天卡片（代码/名称/现价/涨跌幅/理由 + 「＋ 自选」「查看详情」按钮；两按钮事件经 GlobalAiModal/AiAnalysisModal 透传到 App.vue：加自选/复用 selectIwencaiStock 全量加载选中）
- **社区情绪**: 详情页「社区情绪」按钮 → SentimentModal（股吧帖子：情绪档位/看多占比条/热度/热帖列表，标题点击 opener 打开原文）；「AI 解读情绪」→ 全局 AI 注入（`sentimentRequest` 管道，复用 injectContextMessage）；AI 工具 `get_stock_sentiment` 对话内随时查（提示词要求 AI 逐条语义审阅标题、识别反话/水军，与统计交叉验证）；港股返回空。**档位算法**：方向=回复/阅读加权看多占比（爆款帖权重更高），明确度=计数口径明确帖占比（中性/问句多→档位收敛中性，避免热帖权重误判极端情绪）；明确帖 <8 时极端档降一级（样本保护）
- **联网搜索**: 开关全局生效；完整流程只维护在 `WebSearch.js`，开启时 `buildSearchPolicy()` 注入一行指针，关闭时剔除该 skill
- **快捷键/单例/托盘**: Ctrl+K 搜索、Ctrl+N 全局 AI；single-instance 聚焦已有窗口；关窗隐藏托盘
- **时段感知轮询**: App.vue 四个定时器（指数/行情/K线/分时）回调经 `sessionTick` 守卫——A 股或港股任一在交易时段才发请求，盘外（收盘/午休/周末）零请求空转，开盘瞬间自动恢复并立即刷新；手动刷新不受限
- **子窗口**: 迷你 `?mini=1`（10s 刷新）、问财 `?iwencai=1`（本地分页零请求；输入框「✨ AI 优化」按意图+画像改写查询，空输入禁用；结果可一键「AI 分析这批股票」注入全局 AI 解读）

### 3.4 AI 提示词体系（改提示词必读）

- **模板**: `prompts/system-prompt.md`，占位符 `{{BEIJING_TIME}}` / `{{SEARCH_POLICY}}` / `{{PRELOAD_SECTION}}` / `{{SKILL_PROMPTS}}` / `{{USER_PROFILE}}` / `{{MARKET_RULES}}` / `{{STOCK_CONTEXT}}`（无 `{{TOOLS}}`，工具走 API 参数）
- **填充**: `aiContext.js` `buildSystemPrompt`（个股）+ `useAiAnalysis.js` `buildGlobalSystemPrompt`（全局）；公共常量 `MARKET_RULES` / `buildSearchPolicy` 在 `aiContext.js`；替换后校验占位符残留
- **独立提示词（不在三处主管道内）**: 问财窗口「AI 优化」改写查询的 prompt 内嵌在 `IwencaiWindow.vue optimizeQuery()`（`call_llm` 直调，要求输出 `{"query": ...}` JSON + 注入画像）；改动时同步本行
- **注入**: `serializeContext` → K线 30 根 + MA 最新值 + 预计算技术指标 + 资金/行业/指数/热榜/持仓/筹码
- **硬约束**: 数值必须来自工具返回，失败明示「数据获取失败」，禁编造

## 4. Rust 后端

### 4.1 Tauri 命令（21 个）

| 命令 | 数据源 | 说明 |
|------|--------|------|
| `get_stock_quote` / `get_stock_quotes_batch` | Tencent | 实时行情 / 批量（A 股 50 只/批，港股逐只） |
| `get_stock_kline` / `get_stock_intraday` | Tencent | K 线（日/周/月 + 5/15/30/60 分，见 §4.2）/ 分时 |
| `get_stock_money_flow` | Tencent → 东财备选 | 资金流向 5 档（双数据源见 §7.5） |
| `get_stock_money_flow_history` | East Money push2his | 近 N 日资金流向历史（默认 30，单位万元，klines 按日期升序直接映射，勿反转） |
| `get_stock_industry` | East Money HSF10 | 行业分析（港股返回空） |
| `get_market_indices` | Tencent（并行） | 七大指数（失败兜底用真实名称） |
| `search_stocks` / `get_hot_list` | Tencent / 同花顺 | 搜索 / 实时热榜 |
| `get_stock_guba_posts` | East Money guba | 股吧帖子（HTML 内嵌 `var article_list={"re":[...]}` 括号深度扫描提取，按 stockbar_code 过滤；港股返回空） |
| `call_llm` / `call_llm_stream` | DeepSeek | 非流式 / SSE 流式（边界兼容 CRLF + 尾块 flush，见 §4.2） |
| `read/save_user_profile` | 本地文件 | 画像 md 读写 |
| `web_search` / `web_fetch` | 东财 / 目标 URL | 新闻搜索（相关性排序）/ 正文抓取（四级降级 + SSRF 防护，见 §4.2） |
| `get_fx_rate` | Frankfurter | 港元兑人民币 |
| `get_iwencai_robot` | 问财 | 自然语言选股（Cookie v + 浏览器头；page 被忽略，perpage ≤100） |
| `get_app_version` / `check_for_update` | 本地 / GitHub | 版本 / 更新检查（直连失败回退系统代理） |

### 4.2 数据源特征（quirk 唯一真源）

| 文件 | 编码 | 注意 |
|------|------|------|
| `tencent.rs` | **GBK** → `encoding_rs` | `~` 分隔，无反爬；批量 `q=` 逗号拼接；**分钟 K 线**（`m5/m15/m30/m60`）走 `ifzq.gtimg.cn/appstock/app/kline/mkline`（数据键=period 本身，320 根，无复权概念，**港股不支持**降级提示），日/周/月走 `web.ifzq.gtimg.cn fqkline`（qfq 前复权 120 根）；**分时按市场交易时段过滤**（A 股 ≤15:00、港股 ≤16:00，剔除接口附带的盘后零星成交分钟——否则尾盘检测窗口被僵尸数据占据） |
| `eastmoney.rs` | UTF-8 | push2 主域被 WAF 拦，用 push2delay → push2his 兜底 |
| `hotlist.rs` | UTF-8 | JSON API |
| `llm.rs` | UTF-8 | V4 需回传 `reasoning_content`；SSE 按事件边界（`\n\n`/`\r\n\r\n`）切分 + 流末 flush 尾块；`data:` 兼容有/无空格；LLM client 240s 读超时 |
| `web.rs` | UTF-8（无 charset 头时探测 GBK） | sort=default 相关性排序；中文无空格查询按子串剥泛词、维度词截断提实体；四级正文提取；反爬站过滤（8 个）；**SSRF 防护**（私网/回环拒绝、禁跨主机重定向、≤50MB） |
| `iwencai.rs` | UTF-8 | 路径 `data.answer[0].txt[0].content.components[0].data`；**同 v 连续 4-6 次 → 403（换 v 恢复）；带 condition 必 403**；风控错误带 `[RATE_LIMITED]` 标记 |
| `guba.rs` | UTF-8 | HTML 页面末尾内嵌 `var article_list={"re":[...]}`（括号深度扫描提取，忽略字符串内 `{}`）；`gbapi.eastmoney.com` JSON 接口 403 不可用；页面混入关联吧帖子，须按 `stockbar_code` 过滤；**字段全部 Option 容错**（页面偶发缺字段异常条目，如缺 stockbar_code，必填反序列化会让整批解析失败） |

### 4.3 代码转换 (helpers.rs)

```
A 股:  600xxx/900xxx(沪B) → SH / sh | 其他 → SZ / sz
港股:  00700 → HK00700 / hk00700 / secid 116.00700（5 位数字，is_hk_stock）
北交所: 43/82/83/87/88/92 → BJ / bj / secid 0.（东财归入 0 市场）
```

## 5. 设计系统

调色板 Rust `#5d2a1a` / Apricot `#fbe1d1` / Sky `#d3e3fc` / Ink `#17191c`；圆角 cards 24 / inputs 16 / images 12 / pills 9999px；字体 Signifier(标题) + Sohne(正文) 已本地化；**禁止**饱和蓝/绿/红框架色、边框 >1px、渐变背景；弹窗统一 `modal.css`；分时图参考线 = 昨收灰大虚线 + 今开蓝大虚线 + 最高红点线 + 最低绿点线（与涨跌停红/绿虚线区分；今开/最高/最低与分时数据同源计算，港股同样适用）+ 涨跌停红/绿虚线（按板块阈值基于昨收计算，港股不画）。**信号标记配色（形状分层）**：橙圆点=前瞻预警⚠（放量急拉/急跌/无量拉升，警示色；不用紫色以免与均价线混淆）、深红↑/深绿↓箭头=方向事件（突破/破位）、红/绿方块=陷阱警报确认（疑似诱多?/诱空?，与偏离箭头区分）、墨蓝/深青方块=动能衰竭（顶/底背离）、亮红↓/亮绿↑箭头= T+0 偏离>3%/<-3%。

## 6. 开发命令

```bash
pnpm install / dev / build / tauri dev / tauri build
cargo check        # 需 Rust ≥ 1.85（time-core 0.1.8 要求 edition2024）
```

> `src-tauri/.cargo/config.toml` 内置 USTC sparse 镜像（覆盖用户全局失效镜像，勿删）。前端按 vendor 分包（`vite.config.js` manualChunks 函数：charts/markdown/vue 三 chunk）；PowerShell `2>&1` 下构建可能误报 exit 1，以 `✓ built`/`Finished` 为准。

## 7. 关键约定

1. **GBK 编码**: 腾讯 API 必须 `encoding_rs` 解码
2. **竞态保护**: 切换股票丢弃旧响应——请求序号（Kline/Intraday/Industry/Search/fetcher/Iwencai）、选中态比对（MoneyFlow）、代际守卫（AiAnalysis `streamGeneration`）
3. **HTTP 客户端**: `api/mod.rs` OnceLock 复用（通用 15s / 代理 20s / LLM 10s 连接 + 240s 读超时；`web_fetch` 单独构建带重定向策略）
4. **V4 reasoning_content**: 思考模式 assistant 消息须回传，否则 400
5. **资金双数据源**: 腾讯 ff_ 已失效 → 东财 push2delay 优先 → push2his 兜底；先试腾讯、NO_DATA 降级东财
6. **港股/北交所兼容**: `helpers.rs` 按长度与前缀判断市场，前端自动切货币符号
7. **Markdown 必须消毒**: `marked.parse` 输出须经 `DOMPurify.sanitize` 才能 `v-html`；外部数据先转义
8. **TLS 不降级**: 禁止 `danger_accept_invalid_certs`（API key 走 HTTPS）
9. **CSP**: `tauri.conf.json` 已配（`connect-src ipc: http://ipc.localhost`，dev 加 `ws://localhost:1420`）
10. **文件变动 → 同步本文档**（新增/删除文件、命令、composable/skill 等）
11. **AI 提示词维护**: 三处位置——`system-prompt.md`（模板）/ `aiContext.js`（填充+公共常量）/ `skills/*.js`（各段），改后同步 §3.4；保留「数据必须真实」约束
12. **AI 必读文档**: `AGENTS.md`（自动注入短指令，保持精简 ≤64KB）+ 本文档（完整真源），细节一律下沉到本文档
