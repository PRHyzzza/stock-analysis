# stock-analysis 代码评审报告

- 评审日期：2026-10-17
- 版本：`0.1.3`（HEAD `3c9c27e 更新依赖`）
- 规模：前端 98 个文件 / 21,065 行；Rust 14 个文件 / 3,319 行；Tauri 命令 27 个；composable 30 个；组件 44 个
- 方式：全量只读评审（Rust 全量 + 组件全量 + composables/utils 全量 + AI 链路全量），配合实测量化（`pnpm build` / `cargo check` / 本地测试脚本 / 线上报文核对）

---

## 一、总评：6.7 / 10

**一句话：这是一份"设计意图远高于工程实现"的代码——数据源解析、统计口径、口径披露这三块达到可交付水准，但测试与 CI 几乎为零，且有 2 处功能性失效（写进去的数据没用、画出来的图会永久空白）与多处违反项目自己写下的铁律。**

| 维度 | 权重 | 得分 | 主要依据 |
|---|---|---|---|
| 功能完整度与产品设计 | 15% | 8.5 | 行情/分时/K线/筹码/资金流/信号/回测/预警/组合/AI/问财/历史库/多窗口全覆盖，27 个命令职责清晰 |
| 架构与分层 | 15% | 7.5 | `App → composable → commands → api/*` 分层干净；但缺通用 fetcher 抽象，少量 HTTP 越过 `api/` 层 |
| 正确性与健壮性 | 25% | 6.5 | 2 个 P0 使功能空转；6 处违反项目自订的 §7.16「刷新失败保留旧数据」/ §7.10「不可见必降频」 |
| 安全 | 15% | 7.5 | `v-html` 全链消毒、rustls、0 `unsafe`、0 `danger_accept_invalid_certs`；SSRF DNS 重绑定窗口、API Key 明文 |
| 性能与资源 | 10% | 6.5 | 热榜 2N 请求、每 token 全文重解析、async 内同步 SQLite、港股逐只串行 |
| 测试与工程化 | 15% | 3.0 | 无 CI、无 lint、无测试框架；Rust 0 个测试；仅 2 个脚本且被 `.gitignore` 排除 |
| 文档与可维护性 | 5% | 8.0 | `PROJECT.md` 作单一真源 + 27 条约定 + `AGENTS.md` 铁律，体系罕见；有少量数字漂移 |
| **加权综合** | | **6.7** | 纯代码维度约 7.2；工程化维度 3.0 是主要拖累项 |

### 实测基线

| 项目 | 结果 |
|---|---|
| `pnpm build` | ✅ 通过，682ms，`dist` 479 kB（gzip 161 kB） |
| `cargo check` | ✅ 通过，**0 warning / 0 error**，增量 0.63s |
| 本地测试脚本 | ✅ `trap-signals.test.mjs` 29/29、`indicator-tightness.test.mjs` 5/5 |
| Rust 测试 | ❌ 0 个（`#[test]` 计数为 0，无 dev-dependencies） |
| CI | ❌ 无（`.github/` 下只有 `copilot-instructions.md`） |

---

## 二、P0 — 必修（功能性失效）

### P0-1　历史信号 `price` 恒为 0，胜率面板 100% 空转

- **位置**：`src/utils/history.js:33`；受害方 `src/composables/useSignalHistory.js:52-55`
- **证据链**：
  - `history.js:33` → `price: Number(s?.price) || 0,`
  - 但两条落库链路产出的信号对象都**没有** `price` 字段：`useT0Signals.js:359-369`（trap：`name/desc/action/trap/trapType/severity/confirm/time`）、`useT0Signals.js:377-383`（warn：`name/desc/action/warn/time`）、`useT0Signals.js:499`（volume：`{time,name,type}`）
  - `useSignalHistory.js:55` → `if (price <= 0) return { ok: false, reason: "no_price" };`
- **影响**：所有信号事件以 `price=0` 落库 → 1/3/5/10 日收益计算全部 `no_price` → `statsByPeriod / statsByName / statsByCode` 永远为空。刚发布的「历史信号胜率」面板（`7e71f7a`）实际不可用。
- **注**：后端早已预警——`db.rs:473` 注释写明「price 为触发时价格…调用方须据此跳过收益计算」。
- **修复**：落库前注入当时价格（`useT0Signals` 的 `t0Summary` 已有 `raw.price`）；补一条断言「落库事件 price > 0」。**约 0.5 天**。

### P0-2　分时图价格线被置空后永不重建 → 图表永久空白

- **位置**：`src/components/IntradayChart.vue:254`、`:443-474`
- **证据链**：
  - 数据为空分支（`:451-471`）：`removePriceLine` 掉 7 条线并 `baseLine = null`（`:461`）
  - 重建只发生在 `initChart()`，而 `ensureChart()`（`:419-423`）只在 `if (!chart)` 时调用 `initChart()`
  - `updateChartData` 首行守卫（`:254`）：`if (!areaSeries || !avgPriceSeries || !volumeSeries || !baseLine || !intradayData) return;`
  - 组件由 `StockDetail.vue:235` 的 **`v-show`** 常驻，`chart` 实例不销毁
- **影响**：切到一次「无分时数据的股票 / 非交易时段」再切回，该实例此后**永远空白**，且空态遮罩不生效（`data.items` 非空）。
- **修复**：空分支不销毁线，改 `setData([])` 保留线对象；或抽出 `ensurePriceLines()` 在 `updateChartData` 开头按需重建，并从守卫中移除 `baseLine`。**约 1 小时**。

---

## 三、P1 — 高优先级

### A. 数据正确性

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| A1 | `useSignalHistory.js:147-164` | `loadSignals` 无请求序号：切「全部/单只」或连点两只股票，旧响应覆盖新结果（`events` 与 `scopedCode` 错配） | 照 `useKlineData.js:23` 的范本加 `seq` 守卫（成功/失败/finally 三处校验） |
| A2 | `useIndustryData.js:21`、`:26-29` | 每次请求无条件 `industryData.value = null`，失败不回填 → 违反 §7.16，弹窗刷新即闪空 | 记 `lastCode`，仅 code 变化时清空；失败保留旧值 + 置 `industryStale` |
| A3 | `useMoneyFlow.js:23`、`:39-44`、`:67` | 主/历史两个 loader 共写 `lastRequested` 互相作废；catch 全静默无 stale → 上次数据冒充当前 | 拆 `lastRequestedMain` / `lastRequestedHistory`；catch 至少 `console` + 置 stale |
| A4 | `StockDetail.vue:185`、`:188`、`:191` | 头部三价 `.toFixed()` 无空值守卫（同文件 `:253-265` 有）→ 字段为 null 时 render 抛 TypeError，详情面板白屏 | 抽 `utils/format.js` 的 `num(v)`，统一 `?? '--'` |
| A5 | `utils/limit.js:5-34` | ~~`getLimitThreshold` 只按代码前缀返回 10/20%，不识别 ST（ST 实为 ±5%）~~ **——本项结论有误，已撤回**：ST/*ST 涨跌幅自 2026-07-06 起与所属板块一致（主板 ST 也是 ±10%），原文据此加的 `name` 参数与 ±5% 分支属于按过时规则实现，已回退（见文末「修复记录」） | 保持按代码判板块（`getLimitPct(code)`）；`aiContext.js` 的 `MARKET_RULES:27` 已写明新规，勿再引入 ST 特判 |
| A6 | `useTechIndicators.js:13-14`、`:25`；`useT0Signals.js:36-47` | EMA 以 `data[0]` 为种子且无预热，MACD 前段系统性偏移；且同款 `ema` 复制两份 | EMA 用 SMA(period) 作种子，前 2×period 根置 null；抽 `utils/indicators.js` |

### B. 竞态与状态机

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| B1 | `BacktestModal.vue:144-152` + `useSignalBacktest.js:358-383` | 切股并发 `load` 无 seq → 旧股结果覆盖新股（标题新股、表格旧股）；且 `:380 data.value = null` 失败即清空，违反 §7.16 | 加 `seq` 守卫；失败保留旧 `data` + 标 stale |
| B2 | `AiAnalysisModal.vue:42-48` | 流式输出中切股被判 `!loading.value` 直接跳过且**永不补做** → 后续提问用「B 的 system prompt + A 的聊天历史」 | 记 `pendingStockCode`，`watch(loading)` 结束补切 |
| B3 | `GlobalAiModal.vue:339-342` | 保存 Key 后 `showApiKeyInput` 由 `true→false`，而守卫写 `if (!v \|\| !props.show) return;` → 注释承诺的「配置 Key 后自动重试选股」**永不发生** | 改 `if (v) return;` 或在 `saveApiKey()` 成功后显式调用 |
| B4 | `GlobalAiModal.vue:214-231` | `@代码` 引用先 `await get_stock_quote` 再清空输入，await 期间 `loading=false` 且输入仍在 → 连按 Enter 重复发两条 AI 请求 | 先清空 `inputText` 再 await，或加独立 `sending` 标志 |
| B5 | `llm.rs:184-191` + `llmClient.js:84-95` | 流式中途断开时 Rust `emit("llm-done", {warning})` 后 `return Ok(())`，前端**完全不读 `warning`** → 半截回答被判为正常完成并当最终答案展示 | `llm-done` 带 `partial:true` 时 reject 或标 `msg._partial`，气泡提示「回答可能不完整」 |

### C. AI 上下文与成本（当前最贵的部分）

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| C1 | `useAiAnalysis.js:54-64`、`:278-284` | 历史预算只裁对话文本（`trimMessagesToBudget(messages, 6000)`），**本轮工具结果与系统提示完全没有上限**；`get_stock_intraday` 一次约 3 万字符、`hot_list` 全量、`web_fetch` 1.5 万，10 轮全量重发 | 工具结果 `slice` 到 6000 字符并注明原始长度；给 system 单独预算 |
| C2 | `aiContext.js:74-136`；`GlobalAiModal.vue:133-144` | system prompt 每轮全量重建并重发（无法命中 prefix cache）；热榜分支把接口返回的**全部**股票逐只注入 K 线+MA+行情+资金 | 预加载数据改一次性 `user` 消息或做 prefix cache；热榜只取 top N + 字段白名单 |
| C3 | `llm.rs:22`、`:93` | `max_tokens` 固定 **393216**，主对话 / 画像更新（只需三行）/ 问财改写（只需 256）三处共用 | 按场景传：主对话 4-8K、画像 512、改写 256，并入设置 |
| C4 | `useAiAnalysis.js:160-167` + `aiMessageStore.js:12-16` | 流式每个 token 触发 `deep:true` watch → 全量 `JSON.parse` + `JSON.stringify` 整表写 localStorage（2000 字回答 ≈ 2000 次全量序列化），写入失败被 `catch {}` 静默 | 300-500ms 节流；按 code 分 key 存储；配额满上报 UI |
| C5 | `skills/WebSearch.js:104` | 「**回答任何问题前，先搜索再回答**」与 `system-prompt.md:5`「通用知识可直接回答」正面冲突，且 `useSettings.js:34` 默认开启 → 「什么是 T+1」也先搜 1-2 次 | 改条件式：仅时效性/新闻/公告/政策类才搜索 |
| C6 | `GlobalAiModal.vue:87-129` | 热榜选股对每只股票发 **2 个** `invoke`（全量 N 只 → 最多 200 次 IPC），无 Abort / 无 `onUnmounted` 取消，关窗后仍跑完并调用 AI | 代际守卫 + 卸载取消；并发降到 4；先按涨幅/资金预筛 top 30 |

---

## 四、P2 — 中优先级

**安全**

- `api/web.rs:88-96`、`:310`：SSRF 白名单先 `lookup_host` 校验、reqwest 再解析一次，存在 **DNS 重绑定窗口**（首解析公网、连接时 127.0.0.1）；重定向复检（`:325`）只对字面 IP 生效 → 用 `ClientBuilder::resolve()` 固定已校验的 `SocketAddr`
- `api/web.rs:75-79`：主机名用 `split(':')` 解析，**所有 IPv6 字面量（含公网）都被判成空主机名**；`is_private_ip` V6 分支缺 `to_ipv4_mapped` → 修好后会放行 `::ffff:127.0.0.1`
- `useAiAnalysis.js:11` + `AiApiKeySetup.vue:17`：API Key **明文存 localStorage**，同源脚本可直读；文案却称「仅存储在本地」

**性能**

- `commands.rs:47、61、197-213、374、396` + `db.rs:62`：async 命令内直接跑同步 rusqlite 并共用全局 `std::sync::Mutex`，全仓无 `spawn_blocking`；`get_db_stats` 持锁连打 13 条 COUNT → 串行化所有落库
- `api/tencent.rs:132-138`：港股批量**逐只串行** `await`（10 只最坏 150s），且排在 A 股批量之前 → 用 `buffer_unordered(4)`
- `api/tencent.rs:143-151`：任一 chunk 请求失败 `?` 丢弃整批（同函数港股分支却是 `eprintln` 后继续），失败口径不一致
- `AiChatMessages.vue:173`：模板内直接调 `renderMarkdown(msg.content)` → 每次渲染对**全部历史**消息重新 `marked.parse + DOMPurify.sanitize`；流式期间每 token 全量重解析
- `KlineChart.vue:506/530/547`（3 个 `deep:true`）+ `:568 onUpdated`（每帧检查 SR 线）
- `ChipDistribution.vue:57-65`：对整根 `klineData` 数组 `deep:true` watch，每次刷新整算筹码
- `HotList.vue:93`（60s）/ `MiniMode.vue:77`（10s）：固定间隔无条件轮询，**未走 `App.vue:433 effectiveInterval()`**，无 `visibilitychange` 降频、无盘外暂停、无失败退避 → 违反 §7.10 与「盘外零请求」
- `tencent.rs:281`（正则每次现编译 13 处）、`:158`（88 字段逐条 `to_string` 分配）

**交互可用性**

- `IwencaiWindow.vue:323`、`ai/AiChatFooter.vue:15-16`：Enter 未判 `isComposing`，中文输入法**回车选词被当成发送**（`.prevent` 还阻止上屏）
- `SettingsModal.vue:80`：「恢复默认」无二次确认，一键清空全部设置（与删持仓走 ConfirmDialog 不一致）
- `MaAlertConfig.vue:72-75`、`settings/SettingsTabChart.vue:12`：`display:none` 的 checkbox → **键盘不可达、读屏不可见**
- `PositionModal.vue:134`：整行 `<div @click>` 编辑，无 `tabindex/role/keydown`
- `ai/AiChatMessages.vue:170`：`ref` 声明在 `v-for` 内被收集成**数组**，深度思考框自动滚动从未生效

**数据口径**

- `useSignalHistory.js:119-124`、`useSignalBacktest.js:221-228`：注释写「平盘既不算胜也不算负」，实现却是 `losses = n - wins` → 4 胜 4 负 2 平显示 40%（应为 50%），`avgLoss` 同时被摊薄
- `useChipDistribution.js:116/195-219`：`costLevels.COST95` 可能不存在（累计未达 95%），消费方 `.toFixed()` 会抛；衰减基数用「最后一根量」，末根非今日时系数错配
- `useIwencaiRobot.js:88`、`HotList.vue:80-82`：北交所代码判成 SZ / 显示 `SZ`；同时 `43|82|83|87|88|92` 前缀判断在 6 处重复实现（`App.vue` ×4、`GlobalAiModal.vue`、`limit.js`），缺统一 `utils/inferMarket()`
- `skills/KlineAnalysis.js:24` vs `:51`：工具描述写「返回近 120 根」，实现是 `slice(-60)`
- `useAiAnalysis.js:33-37` vs `useSettings.js:31`：模型名 `deepseek-flash` 与 `deepseek-v4-flash` 不一致 → `AiModelControls` 首屏模型名标签空
- `db.rs:334-337`：`INSERT OR REPLACE` 把 `main_pct` 硬编码 0，同表同日「快照行」会被历史写入覆盖成 0
- `useMarketIndices.js:30-32`：指数失败只 `console.error`，无 stale/时间戳，旧值永久冒充实时

---

## 五、P3 — 卫生项

- `lib.rs:67`：托盘 `.expect("bundle icon missing")`，资源缺失 = 启动 panic
- `helpers.rs:4`：`trim_start_matches(h/H/k/K)` 不识别 `sh/sz/bj` 前缀 → `to_tencent_code("sh600519")` → `"szsh600519"`
- `commands.rs:126-148`：命令层直接发 GitHub HTTP，绕过 `api/*` 唯一出口；JSONP 剥壳重复实现
- `commands.rs:302/313`：同步命令在主线程做 `std::fs` 读写画像文件，无大小上限
- `db.rs:172` + `lib.rs:54`：30 天清理 `WHERE ts < ?` 无 `ts` 索引（PK 是 `(code,ts)`），全表扫且阻塞首屏
- `tauri.conf.json:23`：生产 CSP 的 `connect-src` 含 `ws://localhost:1420`（Vite HMR 专用）
- `StockList.vue:17/27/150`：死代码——声明 `searchQuery` prop 却只用本地同名 ref；监听无人 emit 的 `remove-stock`
- `usePositionAlerts.js:192/202`：`stateBaseline` 只写不读
- `hkHolidays.js:37`：「2024-12-26」标为「圣诞节后第一个周日」，实为工作日

---

## 六、工程化与依赖卫生（3.0 分的主因）

| 项 | 现状 | 建议 |
|---|---|---|
| CI | `.github/` 只有 `copilot-instructions.md` | 加一条 workflow：`pnpm build` + `cargo check` + `cargo clippy -D warnings` + 测试脚本 |
| 前端测试 | 2 个 `.mjs` 脚本，**在 `.gitignore` 的 `scripts/` 里**（`git ls-files scripts` 为空） | 移出忽略、纳入版本库；接 `vitest`（现有脚本已可直接跑） |
| Rust 测试 | **0 个**，无 dev-dependencies | 先表驱动测纯函数：`is_private_ip`、`unescape_json`、`parse_a_quote_fields`、`parse_eastmoney_jsonp`（无需网络/DB） |
| Lint/格式化 | 无 eslint / prettier / tsconfig / editorconfig | 至少加 eslint + prettier，卡 `no-unused-vars`、`no-empty`（当前 62 处裸 `catch {}`、7 处 `catch(() => {})`） |
| 未使用的直接依赖 | `package.json` devDeps 里的 `sharp`、`esbuild` 全仓无引用 | 删除（`sharp` 是重量级原生依赖） |
| 元数据 | `Cargo.toml`：`description = "A Tauri App"`、`authors = ["you"]` | 填真实值，会进安装包属性 |
| 文档漂移 | `PROJECT.md:117` 与 `.github/copilot-instructions.md` 写「26 个命令」，实际 **27**；后者还写「§7（22 条）」，实际 **27 条** | 改为 27/27，并加一条「命令数变更时同步」的检查脚本 |

---

## 七、值得保留的设计（亮点）

1. **竞态守卫的范本**：`useKlineData.js:23-47` 先 `const seq = ++requestSeq`，成功/失败/finally 三处都校验；`klineStale` 与 `DataFreshness.vue` 的配合是 §7.2/§7.16 的标准答案，其余 composable 只需照抄（本次 P1 中 3 条问题本质都是"没照抄"）。
2. **统计口径的专业度**：组合当日盈亏用「昨收市值」作基数、加权 PE 只取 `pe>0` 并返回 `covered/excluded`、`profitFactor` 缺失时返回 `null` 而非 0、筹码衰减带 `decayed` 标记闭环到 UI 与 AI 注入——这些细节明显是懂业务的人写的。
3. **口径披露成体系**：`ChipDistribution.vue:38-46`（未做衰减）、`PortfolioModal.vue:291-301`（覆盖率 + 缺失只数）、`BacktestModal.vue:293-300` / `SignalHistoryModal.vue:226-257`（非重叠/固定持有期/样本<10）——AI 分析类工具最缺的就是这个。
4. **SSE 解析是全项目最扎实的一段**（`llm.rs:136-217`）：按字节累积、以事件边界切分后解码，明确规避「汉字跨 TCP 包变 U+FFFD」；`[DONE]` 与流尾残留都会 flush 并补发终态。
5. **XSS 面为零**：4 处 `v-html` 全部 `DOMPurify.sanitize`；`PositionForm.vue:67-74` 先手写 `&/</>` 转义再插 `<mark>`；选股卡片走 Vue 插值而非 `v-html`。
6. **旁路落库隔离干净**：`db.rs` 的 `silent()` 失败只 `eprintln`，且写失败会把 60s 节流戳回退到 0 让下一轮重试——SQLite 故障绝不污染主流程。
7. **HTTP 三档客户端**：行情 `no_proxy()`、LLM 用 `read_timeout(240s)` 而非总超时、`OnceLock` 单例复用连接池。

---

## 八、优化路线图

### 第 1 周：止血（1-1.5 人日）

1. P0-1 信号 `price` 落库（0.5d）
2. P0-2 分时图价格线重建（0.25d）
3. B3 Key 保存后自动重试方向反了（5min）
4. B4 `@代码` 双击重发（10min）
5. A4 `StockDetail` 三处 `.toFixed` 空值守卫（0.5h）
6. C5 联网搜索改条件式（10min）
7. 全局加 `e.isComposing` 判断（15min）
8. **验收**：`scripts/*.mjs` 各加一条断言；手动回归「无分时股 → 正常股」与「流式中切股」

### 第 2-3 周：一致性与成本（3-4 人日）

9. 抽 `utils/format.js`（`num/numOrDash/formatPct/trendClass`）与 `utils/indicators.js`（EMA 种子修正）与 `utils/inferMarket()`，消掉 6 处北交所重复与 2 份 EMA
10. A1/A2/A3/B1 四处 `seq` 守卫 + §7.16 回填（半天就能全改完，收益最大）
11. C1/C2/C4 上下文与落盘预算：工具结果 6K 截断、`max_tokens` 按场景、localStorage 节流 + 按 code 分 key
12. 性能三连：`spawn_blocking` 包 DB、港股 `buffer_unordered(4)`、`AiChatMessages` 加 `_html` 缓存
13. **验收**：单轮 AI 请求 input token 下降 ≥50%；`cargo clippy` 0 warning

### 第 4-6 周：工程化（3-5 人日）

14. 测试入库：`scripts/` 移出 `.gitignore`，接 `vitest`；Rust 端补 4 个纯函数表驱动测试（含 `is_private_ip` 的 IPv6 用例 + `::ffff:127.0.0.1`）
15. 加 CI workflow（build + cargo check + clippy + test），PR 必过
16. eslint + prettier 落地，先 `--fix` 存量再逐步减 warning
17. 安全收口：`ClientBuilder::resolve()` 固定 SSRF 校验结果、修 IPv6 主机解析、API Key 移入 keyring、生产 CSP 去掉 `ws://localhost:1420`
18. 依赖与元数据清理（`sharp`/`esbuild`、`Cargo.toml` 描述、文档 27/27）

### 长期

- 抽通用 fetcher：`useResource(key, fetcher)` 统一 `seq` 守卫 + stale + retry，把"每个 composable 重写一遍竞态"变成不可能犯的错
- 落库/查询走单 writer 线程 + mpsc，彻底消除全局 `Mutex` 争用
- AI 侧补 `usage` 统计与 429/5xx 指数退避重试

---

## 九、附：本次评审未覆盖

- 未启动 GUI 做人工点测（结论均来自源码 + 构建 + 线上报文核对）
- 未做打包（`pnpm tauri build`）与安装包体积/签名验证
- 以下 3 条标「待确认」需实机复现：`KlineChart.vue:295/298` 同 series 挂两个 `createSeriesMarkers` 是否互相覆盖；`HotList.vue:80` 北交所标签；`useChipDistribution` 末根是否为今日实时 bar
  - **后续已澄清**：`KlineChart` 那条**不是缺陷**——lightweight-charts 5.2.1 每个 `createSeriesMarkers` 各自 attach 独立 `SeriesMarkersPrimitive`，`_private__primitives.forEach` 会全部渲染，两套 markers 可共存；`HotList` 的北交所/港股标签已改为走 `utils/market.js` 并在 §十 记录；`useChipDistribution` 末根口径**仍未实机确认**。

---

## 十、修复记录（2026-10-17 夜，附：本报告问题已按路线图落地）

> 本节记录「按评审结论实际改代码」的结果，供复核。全部改动均在 HEAD `3c9c27e` 之上的工作区，未提交。

### 10.1 验证结果（Lead 亲自复跑）

| 项 | 修复前 | 修复后 |
|---|---|---|
| `pnpm test`（`node --test "scripts/*.test.mjs"`） | 仅 2 个脚本、未入库 | **16 个 node:test 用例 + trap-signals 29 断言，全绿** |
| `cargo test` | **0 个** | **32 passed / 0 failed**（helpers 6 / tencent 7 / llm 4 / web 7 / db 5 / commands 3） |
| `cargo check --all-targets` | 0 warning | 0 warning / 0 error |
| `pnpm build` | 682ms，479 kB | 541ms，**183 modules**，CSS 123.71 kB、index 311.43 kB（体积略增来自新增工具与测试期改动，无非预期新依赖） |
| CI | 无 | `.github/workflows/ci.yml`：frontend（build + test）+ rust（check --all-targets + test），windows-latest |
| 依赖卫生 | `sharp`/`esbuild` 无引用 | 已删除（lockfile 同步减少 337 行） |

### 10.2 P0 两条

- **P0-1 信号 `price` 恒 0**：`useT0Signals` 的 trap/warn/volumeSignals 全部补 `price`（取自 `priceAt/time`）与显式 `dir`；`utils/history.js` 抽出纯函数 `buildSignalEvents()`，`price` 缺失/≤0 **直接丢弃**（`num()` 判空，不用 `||0`）+ `console.debug` 记跳过条数；新增 `(code,name,time)` 跨 kind 去重（北京日切重置）。
- **P0-2 分时图永久空白**：`IntradayChart.vue` 空数据分支不再让价格线「只置空不重建」，`ensureChart()` 改为需要时重建整图；`updateChartData` 守卫同步调整。

### 10.3 P1 主线

| 主题 | 落地内容 |
|---|---|
| 竞态守卫 + §7.16 | `useSignalHistory` / `useSignalBacktest` / `useIndustryData` / `useMarketIndices` / `useMoneyFlow`（快照与历史各自独立序号）补 `seq` 与失败保留旧数据 + `stale`；`MoneyFlowSection`/`MoneyFlowModal` 增「旧数据」角标 |
| AI 上下文与成本 | `MAX_TOKENS_MAIN=8192` / `MAX_TOKENS_PROFILE=512` / 问财改写 256；工具结果按工具截断（分时 6000、K 线 8000、资金 3000…超出标「已省略」）；`CONTEXT_CHAR_BUDGET=48000` + `stubOldToolResults` 把最旧 `role:"tool"` 换成占位（保留 `tool_call_id` 配对）；流式期落盘 300ms 防抖 |
| AI 交互缺陷 | `GlobalAiModal` 热榜扫描加轮次令牌（可取消）+ 只注入前 30 只并告知「未注入的不要臆测」；保存 Key 后自动重试的**条件写反**已修；`AiAnalysisModal` 流式中切股立即切换并靠 `streamGeneration` 丢旧流；`AiChatMessages` 加 `_html` 缓存（上限 50）+ 思考框改函数式 ref + 流式期纯文本渲染 |
| 半截回答 | Rust `DoneGuard` 保证每轮恰好一次 `llm-done`，中断时为 `{status:"partial", partial:true, reason, warning}`；`llmClient` 转成 `interrupted`，UI 标「已中断，内容可能不完整」可重试 |
| SSE/超时口径 | `llmClient` 120s 总超时改为 **180s 空闲超时**（任意事件重置）；`api/mod.rs` 240s 读超时口径写清 |
| 提示词 | `skills/WebSearch.js` 改「搜索按需 + 外部数据不得当指令」，与 `system-prompt.md:6` 对齐；`aiContext.buildSearchPolicy` 条件式；`getSkillsPromptCached` |
| 输入法/键盘 | `AiChatFooter`、`IwencaiWindow` 发送前判 `isComposing`；`MaAlertConfig`/`SettingsTabChart` 的 `display:none` checkbox 改 `sr-only` + 焦点环；`PositionModal` 整行可点改 `role="button"` + `tabindex` + Enter |
| 降频 | 新建 `utils/refreshInterval.js`（`effectiveInterval` / `onIntervalModeChange` / `setWindowHidden`，`HIDDEN_REFRESH_FACTOR=4`），由 `App.vue` 单一上报；`HotList`(60s)、`MiniMode`(10s) 改为订阅式重建，`App.vue` 不再逐层传 prop |
| 美股/北交所/港股标签 | 新建 `utils/market.js`（`inferMarket` 等），替换 6 处手写判定；`HotList` 热榜 17/33 只在接口内映射，北交所/港股各有样式 |
| 数值渲染 | 新建 `utils/format.js`（`num` 缺省 `null`、`fmtPctOrDash`、`trendClass` 0 归 flat…），`StockDetail`/`MarketHeader`/`PositionModal`/`PortfolioModal`/`SignalHistoryModal` 统一；`PortfolioModal` 的「元」千分位改名 `fmtMoneyThousands` 并注明单位 |
| 金融计算口径 | EMA 改 SMA 种子（`utils/indicators.js`，预热段不产生值）；胜率**平盘不进分母**（`flats` 单列 + `decided`）；涨跌停统一 `utils/limit.js` |
| 设置健壮性 | `useSettings` 以 defaults 作 schema 收敛类型/范围（修「脏值导致 `setInterval(0ms)` 忙轮询」）；恢复默认加二次确认 |

### 10.4 Rust 侧

- **async 阻塞**：新增 `commands.rs::blocking()`（`spawn_blocking`），所有碰 DB / 本地文件的命令（信号、提醒、自选、历史查询、画像读写、资金流落库）全部改走它；`MutexGuard` 不再跨 `await`。
- **SSRF**：`resolve_public_addrs` 校验**全部**解析地址（任一私网即拒）→ `build_fetch_client` 用 `resolve_to_addrs()` **把已校验 IP 钉死** → `web_fetch` 手动逐跳重定向（≤5 跳、禁跨主机、每跳复检 + 重钉）；`is_private_ip` 补 IPv4-mapped IPv6（`::ffff:127.0.0.1`）；主机名改用 `url::Url` 解析，`[::1]` 不再判空主机。
- **腾讯接口**：港股批量 `buffer_unordered(4)` 并发、按输入下标**保序**回填；A 股单 chunk 失败不再丢弃整批；`normalize_code()` 统一剥前后缀（修 `to_tencent_code("sh600519")` → `"szsh600519"`）；搜索 keyword 走 `.query()` 自动编码；`period` 白名单 + `limit` 夹到 1..=1000。
- **max_tokens**：`Option<u32>` + `resolve_max_tokens`（缺省 393216、超限夹取），Tauri 宏 `rename_all="camelCase"` ⇒ 前端传顶层 `maxTokens`；缺 key 走 `visit_none` 安全为 `None`。
- **DB**：`SCHEMA_VERSION=2` 给四张表补 `ts` 索引（幂等迁移）；`money_flow` 历史写入改 `ON CONFLICT DO UPDATE` 且**不覆盖 `main_pct`**；区分「未初始化」与「锁中毒」；托盘图标缺失不再 `expect` panic；`Cargo.toml` 描述/作者改真实值。

### 10.5 ST 涨跌停口径（评审结论被用户纠正）

- 本报告 §二 A5 原写「主板 ST 实为 ±5%」，**结论已撤回**：按 2026-07-06 新规，风险警示股（ST/*ST）涨跌幅限制**与所属板块一致**（主板 ±10%），项目文档 `src/composables/aiContext.js:27` 早已写明「不要再按 ±5% 判断主板 ST 股」。
- 因此 `utils/limit.js` **只按代码判板块、不接收股票名称**，并新增 `scripts/limit.test.mjs`（7 用例）锁死「误传 name 也不改变结果」，防止以后被改回 ±5%。

### 10.6 文档同步（§7.9）

- `PROJECT.md`：§1 目录树补 4 个新 utils 与 `scripts/`/`ci.yml`；命令表更新 `get_stock_kline`(limit)/`call_llm`(maxTokens)/港股并发；§4.2 补 `web.rs` SSRF 钉 IP、`llm.rs` 终态契约；§4.3 补 `normalize_code`；§4.4 补 schema v2、`money_flow` 不覆盖 `main_pct`、**DB/文件 IO 必须 `spawn_blocking`**；§7 增 32/33/34 三条（不阻塞 runtime / 流式终态可判定 / 抓取必须钉 IP），并重写 §7.26-§7.31。
- `AGENTS.md`、`.github/copilot-instructions.md`：命令数 26→**27**、§7 条数同步为 **34**，补 `pnpm test`/`test:rust`/CI 与 ST 口径说明。

### 10.7 重评分数

| 维度 | 权重 | 原 | 现 | 变化依据 |
|---|---|---|---|---|
| 功能完整度 | 15% | 8.5 | 8.5 | 无功能删减 |
| 架构与分层 | 15% | 7.5 | 7.8 | 抽出 market/format/indicators/refreshInterval 四个单一真源；AI 侧仍有上下文注入散落 |
| 正确性与健壮性 | 25% | 6.5 | 7.7 | 2 个 P0 已修、`seq` 守卫与 §7.16 回填到位；**未做实机点测**故不给 8 分档 |
| 安全 | 15% | 7.5 | 8.0 | SSRF 钉 IP + IPv6 修复；API Key 仍明文 localStorage、生产 CSP 仍含 `ws://localhost:1420` |
| 性能与资源 | 10% | 6.5 | 7.3 | `spawn_blocking`、港股并发、工具结果截断、热榜上限 30、降频统一；仍无通用 fetcher |
| 测试与工程化 | 15% | 3.0 | 6.8 | CI + 48 个测试 + 测试入库 + 依赖清理 + 元数据；**仍无 eslint/prettier** |
| 文档与可维护性 | 5% | 8.0 | 8.6 | 34 条约定、文档漂移修正、新增本修复记录 |
| **加权综合** | | **6.7** | **7.7** | 剩下 2.3 分主要在：无 lint、无实机回归、Key 明文、无打包验证 |

### 10.8 仍未做（下一轮）

1. `eslint` + `prettier` 落地（存量 62 处裸 `catch {}` 需按批清理，不建议一次性 `--fix`）。
2. API Key 移入系统钥匙串（`keyring` crate），localStorage 只留 `hasKey` 标记。
3. 生产 CSP 去掉 `ws://localhost:1420`（仅 dev 需要，可用 `tauri.conf.json` 的 dev 覆盖或 CSP 构建期替换）。
4. 实机回归：无分时股 → 正常股、流式中切股、隐藏窗口降频、SSRF 钉 IP 后的正常抓取。
5. `pnpm tauri build` 打包与体积/签名验证；`useChipDistribution` 末根是否为今日实时 bar 待确认。
