# stock-analysis — AI 项目上下文规则

## 首要规则：先读 PROJECT.md

**每次对话开始或收到新问题时，必须首先阅读 `e:\stock-analysis\PROJECT.md`** 以获取：
- 项目技术栈（Tauri 2 + Vue 3 + Rust）
- 完整文件结构和各文件职责
- 数据流架构（composable → invoke → Rust command → HTTP API）
- 所有 Tauri 命令列表及对应数据源
- Skills 架构和 AI Agent 工具系统
- 设计系统约束（Steep Design System）
- 关键约定（GBK 编码、竞态保护、reasoning_content 回传等）

## 项目文档索引

| 文件 | 用途 |
|------|------|
| `PROJECT.md` | **主文档** — 项目全貌，每次必读 |
| `src/prompts/system-prompt.md` | AI Agent 系统提示词模板 |
| `src/skills/index.js` | Skills 注册器，定义所有 LLM 工具 |

## 关键约定速查

1. **前端修改** → 改 `src/` 下对应文件 → `pnpm build` 验证
2. **Rust 后端修改** → 改 `src-tauri/` → `cargo check` 验证
3. **新增 Tauri 命令** → `commands.rs` + `lib.rs` 注册 + `PROJECT.md` 更新
4. **新增 AI Skill** → 创建 `skills/Xxx.js` + `index.js` 注册 + `PROJECT.md` 更新
5. **文件变动** → 同步更新 `PROJECT.md` 对应章节
6. **新对话/新问题** → 先读 `PROJECT.md`
