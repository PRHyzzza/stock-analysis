# 📈 锐眼

## 🚀 快速开始

### 环境要求

| 工具           | 最低版本  | 说明                                      |
|---------------|----------|-------------------------------------------|
| **Node.js**   | >= 18    | 运行前端开发服务器                          |
| **pnpm**      | >= 8     | 包管理（建议使用最新版）                    |
| **Rust**      | 2021 edition | rustc + cargo 工具链                   |
| **Tauri v2**  | —        | 系统依赖：WebView2（Win）/ WebKit（Linux/macOS）|

> Tauri v2 系统依赖配置请参考 [官方文档](https://v2.tauri.app/start/prerequisites/)。

### 安装 & 运行

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动 Tauri 开发窗口（自动启动 Vite + Rust 编译）
pnpm tauri dev
```

### 生产构建

```bash
pnpm tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`，包括 NSIS 安装包（Windows）或 DMG（macOS）。

## 📄 许可证

MIT © 2025

