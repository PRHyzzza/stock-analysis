# stock-analysis — A 股桌面分析工具

> **技术栈**: [Tauri 2](https://v2.tauri.app/) + [Vue 3](https://vuejs.org/) + [Rust](https://www.rust-lang.org/)  
> **数据源**: [腾讯财经](https://qt.gtimg.cn/) · [东方财富](https://www.eastmoney.com/) · [同花顺](https://www.10jqka.com.cn/)  
> **AI 模型**: [DeepSeek API](https://api-docs.deepseek.com/) (OpenAI 兼容)  
> **图表库**: [Lightweight Charts™](https://tradingview.github.io/lightweight-charts/)  
> **Markdown 渲染**: [marked](https://marked.js.org/)  
> **包管理器**: [pnpm](https://pnpm.io/)  
> **构建工具**: [Vite](https://vite.dev/) + [Rolldown](https://rolldown.rs/)  
> **产品名**: stock-analysis (`com.prh.stock-analysis`)  
> **运行时**: 前端 Vite dev server (port 1420) + Tauri Rust backend

---

## 1. 项目骨架

```
stock-analysis/
├── PROJECT.md
├── package.json / vite.config.js / pnpm-lock.yaml
├── index.html
├── src/                        ← Vue 前端
│   ├── main.js / App.vue
│   ├── assets/main.css         ← 全局样式
│   ├── components/             ← UI 组件（详见 §3.1）
│   │   ├── MarketHeader.vue / TitleBar.vue
│   │   ├── StockList.vue / HotList.vue / SearchDropdown.vue
│   │   ├── StockDetail.vue / KlineChart.vue / IntradayChart.vue
│   │   ├── AiAnalysisModal.vue / TechAnalysisModal.vue / IndustryModal.vue
│   │   ├── ProfileModal.vue / PositionModal.vue
│   │   ├── ChipDistribution.vue / SectorMoneyFlow.vue
│   │   └── ai/   (AiApiKeySetup / AiChatMessages / AiChatFooter)
│   ├── composables/            ← 有状态逻辑（详见 §3.2）
│   ├── prompts/system-prompt.md ← AI 提示词模板
│   ├── skills/                 ← AI 工具模块（详见 §3.3）
│   └── utils/format.js
├── src-tauri/                  ← Rust 后端
│   ├── Cargo.toml / tauri.conf.json
│   └── src/
│       ├── main.rs / lib.rs
│       ├── commands.rs         ← 13 个 Tauri 命令（详见 §4.1）
│       ├── types.rs / helpers.rs
│       └── api/  (tencent / eastmoney / hotlist / llm)
└── public/
```

---

## 2. 架构：数据流

```
┌─────────────────────────────────────────────────┐
│  Vue 前端 (src/)                                 │
│                                                  │
│  App.vue ── 使用 ──> composables/useXxx.js      │
│                          │                       │
│                          │ invoke("command")     │
│                          ▼                       │
│                    @tauri-apps/api/core           │
├─────────────────────────────────────────────────┤
│  Tauri IPC Bridge                               │
├─────────────────────────────────────────────────┤
│  Rust 后端 (src-tauri/src/)                      │
│                                                  │
│  commands.rs ──> api/tencent.rs   (腾讯财经)     │
│              ──> api/eastmoney.rs (东方财富)     │
│              ──> api/hotlist.rs   (同花顺热榜)   │
│              ──> api/llm.rs       (DeepSeek)     │
└─────────────────────────────────────────────────┘
```

---

## 3. 前端源码详解

### 3.1 组件 (components/)

| 文件 | 职责 |
|------|------|
| `MarketHeader.vue` | 顶部栏：大盘指数 + 刷新按钮 + 画像/持仓入口 |
| `TitleBar.vue` | 应用标题栏（窗口拖拽区域） |
| `StockList.vue` | 左侧边栏：自选股列表 + 搜索 + 热榜切换 + 板块资金 |
| `HotList.vue` | 同花顺实时热榜（在 StockList 内渲染） |
| `StockDetail.vue` | 右侧主面板：个股详情 + K线/分时 + 资金 + 行业 + AI |
| `KlineChart.vue` | K 线图 (lightweight-charts)，含支撑/阻力线 |
| `IntradayChart.vue` | 分时图 (lightweight-charts)，价格+均价+成交量 |
| `IndustryModal.vue` | 行业分析弹窗（营收排名 + 市场表现） |
| `TechAnalysisModal.vue` | 技术分析弹窗（MACD/KDJ/RSI/布林带） |
| `AiAnalysisModal.vue` | AI 分析弹窗（DeepSeek Chat + Tools + 模型/思考/推理控制） |
| `ProfileModal.vue` | 用户画像编辑弹窗：左侧 Markdown 编辑 + 右侧实时预览（marked 渲染） |
| `ChipDistribution.vue` | 筹码峰可视化面板（水平条形图，自包含可折叠） |
| `SectorMoneyFlow.vue` | 行业板块资金流向面板（rank + 资金/涨跌切换模式） |
| `PositionModal.vue` | 持仓管理弹窗：汇总、列表、添加/删除、股票搜索 |
| `SearchDropdown.vue` | 股票搜索下拉组件（从 StockList.vue 拆分） |
| `ai/AiApiKeySetup.vue` | API Key 配置面板 |
| `ai/AiChatMessages.vue` | AI 对话消息列表（Markdown 渲染 + 流式内容实时滚动） |
| `ai/AiChatFooter.vue` | AI 输入框 + 发送按钮 |

### 3.2 组合式函数 (composables/)

| 文件 | 导出函数 | 调用的 Tauri 命令 |
|------|---------|------------------|
| `useWatchlist.js` | `useWatchlist()` | 纯前端，localStorage 持久化 |
| `useQuoteLoader.js` | `useQuoteLoader()` | `get_stock_quote` |
| `useStockSearch.js` | `useStockSearch()` | `search_stocks`（含防抖） |
| `useKlineData.js` | `useKlineData()` | `get_stock_kline` |
| `useMoneyFlow.js` | `useMoneyFlow(ref?)` | `get_stock_money_flow` |
| `useIndustryData.js` | `useIndustryData()` | `get_stock_industry` |
| `useMarketIndices.js` | `useMarketIndices()` | `get_market_indices` |
| `useIntradayData.js` | `useIntradayData()` | `get_stock_intraday` |
| `useAiAnalysis.js` | `useAiAnalysis()` | `call_llm` + `call_llm_stream` (DeepSeek V4) |
| `useTechIndicators.js` | `calcMACD/KDJ/WR/RSI/ema` 等纯函数 | 纯前端计算 (基于 K 线数据) |
| `useChipDistribution.js` | `calcChipDistribution()` | 纯前端计算筹码分布 (基于 K 线数据) |
| `useSectorMoneyFlow.js` | `useSectorMoneyFlow()` | `get_sector_money_flow` |
| `usePositions.js` | `usePositions()` | 纯前端，localStorage 持久化（code/name/buyPrice/quantity/buyDate + 盈亏计算） |
| `useUserProfile.js` | `useUserProfile()`, `useUserProfileSingleton()` | `read_user_profile` + `save_user_profile`（Tauri invoke，文件存储在 app_data_dir） |
| `aiContext.js` | `computeMA()`, `serializeContext()`, `buildSystemPrompt()` | 纯函数，构建 AI 系统提示词（含用户画像和持仓注入） |
| `useSupportResistance.js` | `calcSupportResistance()` | 纯函数，从 `KlineChart.vue` 拆分出的支撑/阻力位算法（聚类 + 斐波那契） |
| `llmClient.js` | `callLlmStream()` | 纯函数，从 `useAiAnalysis.js` 拆分出的 SSE 流式 LLM 调用客户端 |

**模式**: 每个 composable 返回 `{ data, loading, loadData(), ... }`。`App.vue` 中调用所有 composable，通过 props 传递给子组件。

### 3.3 Skills 架构 (skills/)

AI Agent 的工具系统，受 OpenClaw SKILL.md 启发：

| 文件 | 提供的工具 |
|------|-----------|
| `index.js` | 注册器：合并所有 skill 的 tools/toolImpl/systemPrompt |
| `StockQuote.js` | `get_stock_quote` — 个股实时行情 |
| `KlineAnalysis.js` | `get_stock_kline` — K 线数据 |
| `MoneyFlow.js` | `get_stock_money_flow` — 主力资金流向 |
| `Industry.js` | `get_stock_industry` — 行业分析 |
| `MarketIndices.js` | `get_market_indices` — 大盘指数 |

**每个 skill 导出格式**:
```js
{ name, description, tools: [{ type, function }], toolImpl: { fn(){} }, systemPrompt }
```

**添加新技能**: ①创建 skill 文件 ②在 `index.js` 的 `SKILLS` 数组中添加 ③自动生效。

### 3.4 AI 上下文构建 (aiContext.js)

纯函数模块，负责将预加载数据序列化为 LLM 系统提示词：

| 函数 | 职责 |
|------|------|
| `computeMA(data, period)` | 计算移动平均线 |
| `serializeContext(contextData)` | 将 klineData / moneyFlow / industryData / indices / positions / chipData 序列化为 Markdown |
| `buildSystemPrompt(currentStock, contextData, userProfile)` | 组装完整系统提示词，填充 `{{USER_PROFILE}}` 等占位符 |

**数据流**: `AiAnalysisModal` 组装 contextData → `sendMessage()` → `buildSystemPrompt()` → `messages[0].role="system"`

### 3.5 核心子系统

| 子系统 | 存储 | 入口 | 关键点 |
|--------|------|------|--------|
| **持仓** (`usePositions` + `PositionModal`) | localStorage | MarketHeader「持仓」 | `refreshAllQuotes()` 每 30s 刷新实时价→算盈亏；AI 对话时注入含实时价格和盈亏的持仓上下文 |
| **用户画像** (`useUserProfile` + `ProfileModal`) | `app_data_dir/user-profile.md` | MarketHeader「画像」 | AI 每次回复后自动更新（`deepseek-v4-flash` 非流式关思考，静默失败）；手动编辑左 textarea 右 marked 预览；单例 `useUserProfileSingleton()` 跨组件共享 |

---

## 4. Rust 后端详解

### 4.1 Tauri 命令 (commands.rs)

所有 `#[tauri::command]` 位于此文件，共 13 个：

| 命令 | 功能 | 调用的 API |
|------|------|-----------|
| `get_stock_quote` | 个股实时行情 | Tencent `qt.gtimg.cn` |
| `get_stock_kline` | K 线数据 (日/周/月) | Tencent |
| `get_stock_intraday` | 分时数据 (当日分钟) | Tencent AppStock |
| `get_stock_money_flow` | 主力资金流向 | Tencent 优先, East Money 备选 |
| `get_sector_money_flow` | 全部板块资金流向 | East Money `push2` clist API |
| `get_stock_industry` | 行业分析 | East Money HSF10 + 行情页 |
| `get_market_indices` | 六大指数行情 | Tencent (并行请求) |
| `search_stocks` | 股票搜索 | Tencent |
| `get_hot_list` | 同花顺热榜 | 10jqka.com.cn |
| `call_llm` | AI 对话（非流式） | [DeepSeek API](https://api-docs.deepseek.com/) |
| `call_llm_stream` | AI 对话（SSE 流式） | DeepSeek API → Tauri 事件 `llm-chunk`/`llm-done`/`llm-error` |
| `read_user_profile` | 读取用户画像 Markdown 文件 | 本地 `app_data_dir/user-profile.md` |
| `save_user_profile` | 保存用户画像 Markdown 文件 | 本地 `app_data_dir/user-profile.md` |

### 4.2 数据源 (api/)

| 文件 | 数据源 | 关键特征 |
|------|--------|---------|
| `tencent.rs` | **腾讯财经** `qt.gtimg.cn` | GBK 编码，`~` 分隔，无反爬 |
| `eastmoney.rs` | **东方财富** | JSON/JSONP/HTML 解析 |
| `hotlist.rs` | **同花顺** | JSON API |
| `llm.rs` | **DeepSeek** | OpenAI 兼容格式；`call_llm()` 非流式 + `call_llm_stream()` SSE 流式（依赖 [`futures-util`](https://docs.rs/futures-util/) + [`reqwest`](https://docs.rs/reqwest/) stream feature） |

### 4.3 AI 流式调用

SSE 流通过 Tauri 事件推送：`llm-chunk`（delta 增量）/ `llm-done` / `llm-error`。前端 `callLlmStream()` 通过 `listen()` 监听，累积 content 和 tool_calls，返回 Promise。

- `thinking_enabled: false` → `thinking: {type: "disabled"}` + `temperature: 0.7`
- `thinking_enabled: true` → `reasoning_effort: "high" | "max"`
- ⚠️ V4 多轮工具调用需回传 `reasoning_content`，否则 400

### 4.4 关键类型 (types.rs)

- `StockQuote` — 价格/涨跌幅/成交量/换手率/PE/振幅
- `KlineItem` — OHLCV (日期/开/高/低/收/量/额)
- `IntradayItem` / `IntradayData` — 分时数据 (时间/价格/均价/量/额 + 昨收)
- `MarketIndex` — 指数行情 (点位/涨跌幅)
- `MoneyFlow` — 主力净流入/占比/趋势
- `IndustryData` — 行业名称 + 市场表现 + 营收排名
- `HotListData` / `HotStockItem` — 热榜数据
- `SearchResult` — 股票搜索结果

### 4.5 代码转换规则 (helpers.rs)

```
to_em_code:     600xxx → "SH600xxx"  |  其他 → "SZxxxxxx"
to_tencent_code: 600xxx → "sh600xxx"  |  其他 → "szxxxxxx"
```

---

## 5. 设计系统 (Steep Design System)

- **调色板**: Rust `#5d2a1a`, Apricot Wash `#fbe1d1`, Sky Wash `#d3e3fc`, Ink `#17191c`
- **圆角**: cards 24px, inputs 16px, images 12px, pills 9999px
- **字体**: Signifier (serif, 标题) + Sohne (无衬线, 正文) via Google Fonts
- **CTA**: Ink 背景 + border-radius 9999px，每视图最多一个
- **禁止**: 使用饱和蓝/绿/红作为 UI 框架色；边框厚度 >1px；渐变背景

---

## 6. 开发命令

```bash
pnpm install          # 安装前端依赖
pnpm dev              # 仅启动 Vite dev server (port 1420)
pnpm tauri dev        # 启动 Tauri 桌面应用 (dev 模式)
pnpm build            # 构建前端 (Vite → dist/)
pnpm tauri build      # 构建 Tauri 安装包 (MSI + NSIS)
cargo check           # 仅检查 Rust 编译（src-tauri/ 目录下执行）
```

---

## 7. 关键约定

1. **资金流向双数据源**: 腾讯优先 → 东方财富备选（push2 偶发连接重置）
2. **GBK 编码**: 腾讯 API 返回 GBK，Rust 用 `encoding_rs::GBK.decode()` 解码
3. **竞态保护**: `useMoneyFlow` / `useKlineData` 支持 `selectedStockRef`，切换股票时丢弃旧请求
4. **Vue 3 prop watch 坑**: `props.showSR` 的 watch 可能不触发，用 `defineExpose` + 模板 ref 绕过
5. **API 反爬**: East Money 有 CDN/WAF，腾讯 API 更稳定
6. **问财免费层**: 仅返回 5 字段（代码/名称/价/涨跌幅/股本），无行业/市值
7. **V4 reasoning_content 回传**: 思考模式下 assistant 消息须携带该字段，否则 400
8. **持仓实时行情**: `refreshAllQuotes()` 每 30s 刷新自选股+持仓价格，开 AI 弹窗/加仓时立即刷新

---

## 8. 维护规则

> **文件变动 → 同步更新本文件**。新增/删除/重命名文件、新增 Tauri 命令、新增 composable/skill/组件、变更数据源或 API 参数时，必须同步更新 `PROJECT.md` 对应章节，确保 AI 始终获得准确实时的项目上下文。
