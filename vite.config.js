import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue({
      features: {
        // 项目全部使用 Composition API / <script setup>，跳过 Options API 编译
        optionsAPI: false,
      },
    }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: [
        "**/src-tauri/**",
        // 编辑器/工具原子写入产生的临时文件（如 .StockDetail.vue.<pid>.<uuid>.tmpdir/StockDetail.vue.tmp）：
        // Windows 上替换写入瞬间文件短暂锁定，chokidar watch 到锁定文件会抛 EBUSY 并崩溃整个 dev server。
        // 用函数形式精确匹配（chokidar ignored 支持函数），glob 对点开头目录的匹配不可靠
        (path) =>
          path.includes(".tmpdir") ||
          path.endsWith(".tmp") ||
          path.endsWith("~"),
      ],
    },
  },

  // ══════════════════════════════════════════
  // Build 性能优化（减少 vite:vue / vite:css 耗时）
  // ══════════════════════════════════════════
  build: {
    // Tauri WebView2 支持 esnext，跳过不必要的降级编译
    target: "esnext",
    // Lightning CSS 比 PostCSS 快 2-3x
    cssMinify: "lightningcss",
    // 关闭压缩大小报告，加速构建
    reportCompressedSize: false,
    // 手动分包：图表库 / Markdown 渲染 / 框架核心各自独立 chunk，
    // 避免单入口 >500 kB 触发 chunk 警告（Tauri 本地加载，多 chunk 无网络开销）
    // 注意：rolldown 的 manualChunks 只支持函数形式（不支持 Rollup 的对象形式）
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // pnpm 路径形如 node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...
          const inPkg = (name) =>
            id.includes(`node_modules/${name}/`) || id.includes(`node_modules/.pnpm/${name}@`);
          if (inPkg("lightweight-charts")) return "vendor-charts";
          if (inPkg("marked") || inPkg("dompurify")) return "vendor-markdown";
          // vue 3.5 拆分为 @vue/* 子包（.pnpm 目录中 scoped 名 @ 变 +），需一并匹配
          if (inPkg("vue") || inPkg("@vue") || inPkg("@tauri-apps")) return "vendor-vue";
        },
      },
    },
  },

  css: {
    // 用 Lightning CSS 替代 PostCSS 作为 CSS 转换器
    transformer: "lightningcss",
    // 关闭 CSS sourcemap（生产构建不需要）
    devSourcemap: false,
  },
}));
