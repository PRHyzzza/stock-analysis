# stock-analysis — A 股桌面分析工具

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
│   │   ├── 通用:      IndicatorCard.vue / SectorMoneyFlow.vue
│   │   ├── settings/  (4 个设置标签页)
│   │   └── ai/        (ApiKeySetup / ChatMessages / ChatFooter / ModelControls)
│   ├── composables/  (19 个 — 数据加载/纯计算/持久化)
│   ├── skills/       (AI Agent 工具系统 — 6 个 skill)
│   ├── prompts/      (system-prompt.md)
│   └── utils/        (format.js)
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
                          ──> api/web.rs        (DuckDuckGo)
```

模式: 每个 composable 返回 `{ data, loading, load(), ... }`，`App.vue` 统一调用，通过 props 下发。

---

## 3. 前端模块

### 3.1 Composables（数据层）

| 文件 | 用途 | 后端命令 |
|------|------|---------|
| `useWatchlist.js` | 自选股 CRUD | 纯前端 (localStorage) |
| `useQuoteLoader.js` | 批量加载实时行情 | `get_stock_quote` |
| `useStockSearch.js` | 股票搜索（防抖） | `search_stocks` |
| `useKlineData.js` | K 线 + 周期切换 | `get_stock_kline` |
| `useIntradayData.js` | 分时数据 | `get_stock_intraday` |
| `useMoneyFlow.js` | 资金流向（竞态保护） | `get_stock_money_flow` |
| `useIndustryData.js` | 行业分析 | `get_stock_industry` |
| `useMarketIndices.js` | 六大指数行情 | `get_market_indices` |
| `useSectorMoneyFlow.js` | 板块资金流向 | `get_sector_money_flow` |
| `useAiAnalysis.js` | AI 对话（个股/全局） | `call_llm` + `call_llm_stream` |
| `usePositions.js` | 持仓管理 + 盈亏计算 | 纯前端 (localStorage) |
| `useUserProfile.js` | 用户画像读写 | `read_user_profile` / `save_user_profile` |
| `useSettings.js` | 全局设置单例 | 纯前端 (localStorage) |
| `useWatchlistNotifications.js` | Windows 原生通知 | 纯前端 (`tauri-plugin-notification`) |
| `aiContext.js` | 构建 AI 系统提示词（注入持仓/画像/K线/筹码） | 纯函数 |
| `aiMessageStore.js` | AI 对话按股票隔离持久化 | 纯前端 (localStorage) |
| `llmClient.js` | SSE 流式 LLM 客户端 | 监听 Tauri 事件 |
| `useTechIndicators.js` | MACD/KDJ/RSI/WR/EMA 等 | 纯前端计算 |
| `useChipDistribution.js` | 筹码分布（三角形分布法） | 纯前端计算 |
| `useSupportResistance.js` | 支撑/阻力位（聚类 + 斐波那契） | 纯前端计算 |
| `fetcher.js` | `createDataFetcher()` 工厂函数 | 不直接调用命令 |

### 3.2 Skills（AI 工具系统）

`index.js` 注册器合并所有 skill 的 `tools` / `toolImpl` / `systemPrompt`。新增 skill: 创建文件 → 加入 `SKILLS` 数组 → 自动生效。

| Skill | 提供工具 |
|-------|---------|
| `StockQuote.js` | `get_stock_quote` — 个股实时行情 |
| `KlineAnalysis.js` | `get_stock_kline` — K 线数据 |
| `MoneyFlow.js` | `get_stock_money_flow` — 主力资金流向 |
| `Industry.js` | `get_stock_industry` — 行业分析 |
| `MarketIndices.js` | `get_market_indices` — 大盘指数 |
| `WebSearch.js` | `web_search` / `web_fetch` — 联网搜索（DuckDuckGo 免费） |

### 3.3 核心子系统

- **持仓**: `usePositions` + `PositionModal`，localStorage 持久化，每 30s 刷新实时价计算盈亏，AI 对话时自动注入
- **用户画像**: `useUserProfile` + `ProfileModal`，Markdown 文件存 `app_data_dir`，AI 每次回复后自动更新（`deepseek-v4-flash` 静默失败），支持手动编辑
- **自选通知**: `useWatchlistNotifications`，涨停/跌停/±7%/±5%/快速拉升下跌(30s≥2%)，每股票每类型每日一次
- **全局设置**: `useSettings` + `SettingsModal`，4 标签页（通知/刷新/图表/AI），实时生效

---

## 4. Rust 后端

### 4.1 Tauri 命令（15 个）

| 命令 | 数据源 | 说明 |
|------|--------|------|
| `get_stock_quote` | Tencent | 个股实时行情 |
| `get_stock_kline` | Tencent | K 线（日/周/月） |
| `get_stock_intraday` | Tencent AppStock | 分时数据（当日分钟） |
| `get_stock_money_flow` | Tencent → East Money 备选 | 资金流向 |
| `get_sector_money_flow` | East Money push2 | 板块资金排行 |
| `get_stock_industry` | East Money HSF10 | 行业分析 |
| `get_market_indices` | Tencent（并行） | 六大指数 |
| `search_stocks` | Tencent | 股票搜索 |
| `get_hot_list` | 同花顺 | 实时热榜 |
| `call_llm` | DeepSeek | AI 非流式 |
| `call_llm_stream` | DeepSeek SSE | AI 流式 → `llm-chunk`/`llm-done`/`llm-error` |
| `read_user_profile` | 本地文件 | 读取画像 md |
| `save_user_profile` | 本地文件 | 保存画像 md |
| `web_search` | DuckDuckGo Lite | 网页搜索 |
| `web_fetch` | 目标 URL | 网页抓取（限 50000 字符） |

### 4.2 数据源特征

| 文件 | 编码 | 注意 |
|------|------|------|
| `tencent.rs` | **GBK** → `encoding_rs::GBK.decode()` | `~` 分隔，无反爬 |
| `eastmoney.rs` | UTF-8 | JSON/JSONP/HTML，有 CDN/WAF |
| `hotlist.rs` | UTF-8 | JSON API |
| `llm.rs` | UTF-8 | OpenAI 兼容；V4 工具调用需回传 `reasoning_content`（否则 400）；`thinking_enabled` 控制思考模式 |
| `web.rs` | UTF-8 | DuckDuckGo Lite HTML 解析 |

### 4.3 代码转换 (helpers.rs)

```
600xxx → "SH600xxx" | 其他 → "SZxxxxxx"         (东方财富)
600xxx → "sh600xxx" | 其他 → "szxxxxxx"         (腾讯)
```

---

## 5. 设计系统

- **调色板**: Rust `#5d2a1a` / Apricot Wash `#fbe1d1` / Sky Wash `#d3e3fc` / Ink `#17191c`
- **圆角**: cards 24px / inputs 16px / images 12px / pills 9999px
- **字体**: Signifier (serif, 标题) + Sohne (无衬线, 正文) via Google Fonts
- **禁止**: 饱和蓝/绿/红作为框架色、边框 >1px、渐变背景
- **弹窗**: 8 个 modal 统一使用 `assets/modal.css` 共享样式

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
2. **竞态保护**: 切换股票时丢弃旧请求结果 (`useMoneyFlow` / `useKlineData`)
3. **V4 reasoning_content**: 思考模式下 assistant 消息须回传此字段，否则 400
4. **资金双数据源**: 腾讯优先 → 东方财富备选（push2 偶发连接重置）
5. **文件变动 → 同步更新本文档**（新增/删除文件、Tauri 命令、composable/skill 等）

