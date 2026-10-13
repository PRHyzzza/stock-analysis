# stock-analysis — AI 项目上下文规则

## 首要规则：先读 PROJECT.md

**每次对话开始或收到新问题时，必须首先阅读 `e:\stock-analysis\PROJECT.md`**，其中包含项目全貌：技术栈、文件结构、数据流、26 个 Tauri 命令、本地历史库（SQLite）、回测口径、Skills 系统、设计约束等。以下为高频编码约定的补充速查。

## 代码约定

### 修改与验证
1. **前端** → `src/` → `pnpm build` 验证
2. **Rust 后端** → `src-tauri/` → `cargo check` 验证
3. **Bug 与死代码检查** → 每次新增或修改文件后，必须逐文件检查：① 逻辑 bug（边界条件、空值处理、类型错误、竞态条件）；② 无用代码（未使用的变量/导入/函数、注释掉的旧代码、调试用 console.log）；③ 确认代码风格与项目现有模式一致
4. **文件变动后** → 同步更新 `PROJECT.md` 对应章节

### 新增文件模式
4. **Tauri 命令** → `commands.rs` 添加 `#[tauri::command]` → `lib.rs` 的 `.invoke_handler()` 注册 → 更新 `PROJECT.md` §4.1
5. **AI Skill** → 创建 `skills/Xxx.js`（导出 `{ tools, toolImpl, systemPrompt }`）→ `index.js` 的 `SKILLS` 数组追加 → 更新 `PROJECT.md` §3.2
6. **Composable** → `composables/useXxx.js`，返回 `{ data, loading, load(), ... }` → `App.vue` 调用 → 更新 `PROJECT.md` §3.1

## 关键陷阱

7. **腾讯 API 返回 GBK** → Rust 端必须 `encoding_rs::GBK.decode()` 解码，不可直接用 UTF-8
8. **DeepSeek V4 工具调用** → assistant 消息须回传 `reasoning_content` 字段，否则 HTTP 400
9. **竞态保护** → 切换股票时丢弃旧请求结果（`useMoneyFlow` / `useKlineData` 已内置 `requestSeq` 序号守卫，流式请求用 `streamGeneration`；新增 composable 须自行加同类守卫，项目内没有通用 fetcher 封装）
10. **资金流向双数据源** → 腾讯优先，东方财富 push2 备选（偶发连接重置）
11. **市场判定单一入口** → 盘中/交易日判断只用 `src/utils/marketTime.js`（`getMarketStatus` / `isTradingHours`），不要在组件里重写时段常量；港股假期表 `src/utils/hkHolidays.js` 每年随 GovHK 公告追加翌年（未收录年份自动退回工作日判定，不含台风/黑雨停市）
12. **刷新失败保留旧数据** → 行情/K 线/分时请求失败不清空已有数据（仅换标的/换周期时清空），置 `stale=true` 并用 `src/components/DataFreshness.vue` 角标标注「更新失败 + 重试」
13. **窗口不可见必降频** → 隐藏信号是双来源：`document.visibilitychange` + Rust 事件 `main-window-hidden`/`main-window-shown`（`lib.rs`）；新增轮询必须经由 `App.vue` 的 `effectiveInterval()` 得到间隔
14. **本地历史库是旁路** → `src-tauri/src/db.rs` 的 `record_*` 只 eprintln，绝不把错误返回给命令层（落库失败不能影响行情/K线返回）；新埋点写 `db.rs` + 命令转发，前端埋点走 `src/utils/history.js`（fire-and-forget）
15. **回测口径** → `useSignalBacktest` 只回测**日线级**规则：T+0/量价陷阱/量价信号依赖分时数据，无法用日 K 回测；UI 与文档必须标注「非重叠交易 + 固定持有期 + 样本 <10 笔仅供参考」，禁止无标注展示胜率
