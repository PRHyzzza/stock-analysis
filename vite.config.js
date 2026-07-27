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
      ignored: ["**/src-tauri/**"],
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
  },

  css: {
    // 用 Lightning CSS 替代 PostCSS 作为 CSS 转换器
    transformer: "lightningcss",
    // 关闭 CSS sourcemap（生产构建不需要）
    devSourcemap: false,
  },
}));
