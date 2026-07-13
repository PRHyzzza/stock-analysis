# 锐眼 (Ruiyan) — A 股桌面分析工具

> **技术栈**: Tauri 2 + Vue 3 + Rust  
> **产品名**: 锐眼 (`com.prh.stock-analysis`)  
> **运行时**: 前端 Vite dev server (port 1420) + Tauri Rust backend

---

## 1. 项目骨架

```
stock-analysis/
├── PROJECT.md              ← 本文件（AI 快速上下文）
├── package.json            ← 前端依赖 (Vue 3, lightweight-charts, Tauri API)
├── vite.config.js          ← Vite 配置 (port 1420, HMR 1421)
├── pnpm-lock.yaml / pnpm-workspace.yaml
├── index.html              ← SPA 入口 HTML
├── src/                    ← Vue 前端源码
│   ├── main.js             ← createApp(App).mount("#app")
│   ├── App.vue             ← 根组件：侧边栏 + 主面板 + 所有弹窗
│   ├── assets/main.css     ← 全局样式 (Steep Design System)
│   ├── components/         ← UI 组件 (不含业务逻辑)
│   ├── composables/        ← 有状态逻辑 (调用 Tauri invoke)
│   ├── skills/             ← AI Agent 技能模块 (定义 LLM tools)
│   └── utils/format.js     ← 格式化工具 (signChar)
├── src-tauri/              ← Rust 后端源码
│   ├── Cargo.toml          ← Rust 依赖 (tauri, reqwest, serde, tokio, regex)
│   ├── tauri.conf.json     ← Tauri 窗口/构建/安全配置
│   ├── src/
│   │   ├── main.rs         ← 入口：windows_subsystem + 调用 lib::run()
│   │   ├── lib.rs          ← Tauri Builder：注册 8 个命令 + 插件
│   │   ├── types.rs        ← 数据结构 (StockQuote, KlineItem, MoneyFlow...)
│   │   ├── helpers.rs      ← 代码转换 (to_em_code, to_tencent_code)
│   │   ├── commands.rs     ← Tauri #[command] 处理器
│   │   └── api/            ← HTTP API 客户端模块
│   └── capabilities/       ← Tauri 权限配置
└── public/                 ← 静态资源
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
| `StockList.vue` | 左侧边栏：自选股列表 + 搜索 + 热榜切换 |
| `HotList.vue` | 同花顺实时热榜（在 StockList 内渲染） |
| `StockDetail.vue` | 右侧主面板：个股详情 + K线/分时 + 资金 + 行业 + AI |
| `KlineChart.vue` | K 线图 (lightweight-charts)，含支撑/阻力线 |
| `IntradayChart.vue` | 分时图 (lightweight-charts)，价格+均价+成交量 |
| `IndustryModal.vue` | 行业分析弹窗（营收排名 + 市场表现） |
| `TechAnalysisModal.vue` | 技术分析弹窗（MACD/KDJ/RSI/布林带） |
| `AiAnalysisModal.vue` | AI 分析弹窗（DeepSeek Chat + Tools） |
| `ChipDistribution.vue` | 筹码峰可视化面板（水平条形图，自包含可折叠） |
| `ai/AiApiKeySetup.vue` | API Key 配置面板 |
| `ai/AiChatMessages.vue` | AI 对话消息列表 |
| `ai/AiChatFooter.vue` | AI 输入框 + 发送按钮 |

### 3.2 组合式函数 (composables/)

| 文件 | 导出函数 | 调用的 Tauri 命令 |
|------|---------|------------------|
| `useWatchlist.js` | `useWatchlist()` | 纯前端，localStorage 持久化 |
| `useQuoteLoader.js` | `useQuoteLoader()` | `get_stock_quote` |
| `useKlineData.js` | `useKlineData()` | `get_stock_kline` |
| `useMoneyFlow.js` | `useMoneyFlow(ref?)` | `get_stock_money_flow` |
| `useIndustryData.js` | `useIndustryData()` | `get_stock_industry` |
| `useMarketIndices.js` | `useMarketIndices()` | `get_market_indices` |
| `useIntradayData.js` | `useIntradayData()` | `get_stock_intraday` |
| `useAiAnalysis.js` | `useAiAnalysis()` | `call_llm` (DeepSeek) |
| `useTechIndicators.js` | `calcMACD/KDJ/WR/RSI/ema` 等纯函数 | 纯前端计算 (基于 K 线数据) |
| `useChipDistribution.js` | `calcChipDistribution()` | 纯前端计算筹码分布 (基于 K 线数据) |

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

---

## 4. Rust 后端详解

### 4.1 Tauri 命令 (commands.rs)

所有 `#[tauri::command]` 位于此文件，共 9 个：

| 命令 | 功能 | 调用的 API |
|------|------|-----------|
| `get_stock_quote` | 个股实时行情 | Tencent `qt.gtimg.cn` |
| `get_stock_kline` | K 线数据 (日/周/月) | Tencent |
| `get_stock_intraday` | 分时数据 (当日分钟) | Tencent AppStock |
| `get_stock_money_flow` | 主力资金流向 | Tencent 优先, East Money 备选 |
| `get_stock_industry` | 行业分析 | East Money HSF10 + 行情页 |
| `get_market_indices` | 六大指数行情 | Tencent (并行请求) |
| `search_stocks` | 股票搜索 | Tencent |
| `get_hot_list` | 同花顺热榜 | 10jqka.com.cn |
| `call_llm` | AI 对话 | DeepSeek API |

### 4.2 数据源 (api/)

| 文件 | 数据源 | 关键特征 |
|------|--------|---------|
| `tencent.rs` | **腾讯财经** `qt.gtimg.cn` | GBK 编码，`~` 分隔，无反爬 |
| `eastmoney.rs` | **东方财富** | JSON/JSONP/HTML 解析 |
| `hotlist.rs` | **同花顺** | JSON API |
| `llm.rs` | **DeepSeek** | OpenAI 兼容格式 |

### 4.3 关键类型 (types.rs)

- `StockQuote` — 价格/涨跌幅/成交量/换手率/PE/振幅
- `KlineItem` — OHLCV (日期/开/高/低/收/量/额)
- `IntradayItem` / `IntradayData` — 分时数据 (时间/价格/均价/量/额 + 昨收)
- `MarketIndex` — 指数行情 (点位/涨跌幅)
- `MoneyFlow` — 主力净流入/占比/趋势
- `IndustryData` — 行业名称 + 市场表现 + 营收排名
- `HotListData` / `HotStockItem` — 热榜数据
- `SearchResult` — 股票搜索结果

### 4.4 代码转换规则 (helpers.rs)

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
pnpm dev              # 仅启动 Vite dev server
pnpm tauri dev        # 启动 Tauri 桌面应用 (dev 模式)
pnpm build            # 构建前端
pnpm tauri build      # 构建 Tauri 安装包 (MSI + NSIS)
```

---

## 7. 关键约定 & 注意事项

1. **资金流向双数据源**: 腾讯优先 → 东方财富备选（push2 偶发连接重置）
2. **GBK 编码**: 腾讯 API 返回 GBK，Rust 中用 `encoding_rs::GBK.decode()` 解码
3. **竞态保护**: `useMoneyFlow` 和 `useKlineData` 支持 `selectedStockRef` 参数，切换股票时丢弃旧请求结果
4. **Vue 3 prop watch 坑**: `props.showSR` 的 watch 可能不触发，使用 `defineExpose` + 模板 ref 直接调用绕过
5. **AI Skills 架构**: 修改 tools 只需编辑 `skills/` 目录，无需改 `useAiAnalysis.js`
6. **API 反爬**: East Money push2/push2his 有 CDN/WAF，腾讯 API 稳定可用
7. **API 收费层限制**: 问财免费层仅返回 5 个字段（代码/名称/价/涨跌幅/股本），无行业/市值

---

## 8. 维护规则

> **文件变动 → 同步更新本文件**。新增/删除/重命名文件、新增 Tauri 命令、新增 composable/skill/组件、变更数据源或 API 参数时，必须同步更新 `PROJECT.md` 对应章节，确保 AI 始终获得准确实时的项目上下文。
