# 📈 股票分析 (Stock Analysis)

<p align="center">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri">
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vue.js">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-2021-edition-000000?logo=rust">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow">
</p>

基于 **Tauri v2 + Vue 3 + Rust** 构建的桌面端 A 股分析工具，支持实时行情、K 线图表、行业分析及主力资金流向追踪。

## ✨ 功能特性

- **📊 实时行情** — A 股实时报价、大盘指数（上证/深证/创业板/沪深 300 等），每 30 秒自动刷新
- **📉 K 线图表** — 日 K / 周 K / 月 K 交互式蜡烛图，MA5/10/20/30 均线叠加，基于 [lightweight-charts](https://github.com/tradingview/lightweight-charts) v5，支持鼠标拖拽缩放
- **💰 主力资金流向** — 实时主力净流入/流出追踪（双数据源自动回退：东方财富 push2 实时 → push2his 历史）
- **🏭 行业分析** — 行业内个股对比、营收排名、市场表现（相对沪深 300 超额收益），数据源：东方财富 HSF10
- **📐 技术分析** — MACD、KDJ、WR 三大技术指标弹窗
- **🔍 股票搜索** — 支持代码或名称拼音模糊搜索，数据源：腾讯智能搜索
- **📋 自选股** — 可自由增删的自选股列表，localStorage 持久化，默认预置 7 只热门 A 股
- **🔄 自动刷新** — 行情 30 秒、指数 60 秒、K 线 120 秒自动更新
- **🎨 红涨绿跌** — 遵循 A 股配色标准，涨红色跌绿色

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

