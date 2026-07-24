# stock-analysis — AI 项目上下文规则

## 首要规则：先读 PROJECT.md

**每次对话开始或收到新问题时，必须首先阅读 `e:\stock-analysis\PROJECT.md`**，其中包含项目全貌：技术栈、文件结构、数据流、15 个 Tauri 命令、Skills 系统、设计约束等。以下为高频编码约定的补充速查。

## 代码约定

### 修改与验证
1. **前端** → `src/` → `pnpm build` 验证
2. **Rust 后端** → `src-tauri/` → `cargo check` 验证
3. **文件变动后** → 同步更新 `PROJECT.md` 对应章节

### 新增文件模式
4. **Tauri 命令** → `commands.rs` 添加 `#[tauri::command]` → `lib.rs` 的 `.invoke_handler()` 注册 → 更新 `PROJECT.md` §4.1
5. **AI Skill** → 创建 `skills/Xxx.js`（导出 `{ tools, toolImpl, systemPrompt }`）→ `index.js` 的 `SKILLS` 数组追加 → 更新 `PROJECT.md` §3.2
6. **Composable** → `composables/useXxx.js`，返回 `{ data, loading, load(), ... }` → `App.vue` 调用 → 更新 `PROJECT.md` §3.1

## 关键陷阱

7. **腾讯 API 返回 GBK** → Rust 端必须 `encoding_rs::GBK.decode()` 解码，不可直接用 UTF-8
8. **DeepSeek V4 工具调用** → assistant 消息须回传 `reasoning_content` 字段，否则 HTTP 400
9. **竞态保护** → 切换股票时丢弃旧请求结果（`useMoneyFlow` / `useKlineData` 已内置，新增 data fetcher 须复用 `fetcher.js` 的 `createDataFetcher()`）
10. **资金流向双数据源** → 腾讯优先，东方财富 push2 备选（偶发连接重置）
