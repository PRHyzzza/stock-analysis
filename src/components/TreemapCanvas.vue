<script setup>
/**
 * 大盘云图核心画布 — 参考 52etf.site A股热力图
 *
 * 三层结构: 行业 → 细分行业 → 个股
 * 面积 = 流通市值, 颜色 = 涨跌幅(41 色渐变, 中国惯例红涨绿跌)
 * 布局算法: squarify(d3-treemap 算法移植, 无外部依赖)
 * 交互: 悬停显示详情 tooltip, 双击色块通知主窗口联动
 */
import { ref, watch, onMounted, onUnmounted } from "vue";

const props = defineProps({
  data: { type: Object, default: null },
});
const emit = defineEmits(["select-stock"]);

// ---- 41 色涨跌幅渐变(逆向自 52etf.site: 索引 = (chg+4)*5, clamp 0..40; 绿=跌 灰=平 红=涨) ----
const CHG_COLORS = [
  "#30cc5a", "#30c558", "#30be56", "#2fb854", "#2fb152", "#2faa51", "#2fa450",
  "#2f9e4f", "#30974f", "#31904e", "#31894e", "#32844e", "#347d4e", "#35764e",
  "#366f4e", "#38694f", "#3a614f", "#3b5a50", "#3d5451", "#3f4c53", "#414554",
  "#4f4554", "#5a4554", "#644553", "#6f4552", "#784551", "#824450", "#8b444e",
  "#94444d", "#9d434b", "#a5424a", "#ae4248", "#b64146", "#bf4045", "#c73e43",
  "#ce3d41", "#d73c3f", "#df3a3d", "#e6393b", "#ee373a", "#f63538",
];
function chgColor(chg) {
  const idx = Math.round((chg + 4) * 5);
  return CHG_COLORS[Math.max(0, Math.min(40, idx))];
}
function chgTextColor(chg) {
  return chg > 0.01 ? "#f4554f" : chg < -0.01 ? "#2fbb4e" : "#9aa0a6";
}

const wrapRef = ref(null);
const canvasRef = ref(null);
const hover = ref(null); // { node, x, y } 屏幕坐标
let w = 0;
let h = 0;
let dpr = 1;
let layout = []; // 布局结果: [{node,x0,y0,x1,y1,sectors:[{node,...,stocks:[{node,...}]}]}]
let ro = null;

onMounted(() => {
  ro = new ResizeObserver(() => resize());
  ro.observe(wrapRef.value);
  resize();
  render();
});
onUnmounted(() => ro?.disconnect());
// 数据更新(8s 轮询) → 重绘; 悬停节点数据变化后 tooltip 同步
watch(() => props.data, () => { render(); }, { deep: false });

function resize() {
  const el = wrapRef.value;
  w = el.clientWidth;
  h = el.clientHeight;
  dpr = window.devicePixelRatio || 1;
  const cv = canvasRef.value;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  render();
}

// ────────────────────────────── squarify 布局 ──────────────────────────────
/** d3-hierarchy treemapSquarify 算法移植: items=[{value}] → [{node,x0,y0,x1,y1}] */
function squarify(items, x0, y0, x1, y1) {
  const nodes = items
    .map((node) => ({ node, value: Math.max(node.value || 0, 0) }))
    .filter((d) => d.value > 0);
  const total = nodes.reduce((s, d) => s + d.value, 0);
  const area = (x1 - x0) * (y1 - y0);
  if (!nodes.length || total <= 0 || area <= 0) return [];
  for (const d of nodes) d.value = (d.value / total) * area; // 归一化为面积

  const rows = [];
  let i0 = 0, i1 = 0;
  const n = nodes.length;
  let rx = x0, ry = y0, rw = x1 - x0, rh = y1 - y0;
  let value = area;

  while (i0 < n) {
    const dx = rw, dy = rh;
    let minValue = nodes[i1].value, maxValue = minValue, sumValue = minValue;
    i1++;
    let alpha = Math.max(dy / dx, dx / dy) / value;
    let beta = sumValue * sumValue - alpha * value * value;
    let minRatio = beta < 0 ? Infinity : -beta / (alpha * value);
    for (; i1 < n; i1++) {
      const nv = nodes[i1].value;
      sumValue += nv;
      if (nv < minValue) minValue = nv;
      else if (nv > maxValue) maxValue = nv;
      beta = sumValue * sumValue - alpha * value * value;
      const newRatio = beta < 0 ? Infinity : -beta / (alpha * value);
      if (Math.abs(newRatio) > minRatio) { sumValue -= nv; break; }
      minRatio = newRatio;
    }
    rows.push({ start: i0, end: i1, sum: sumValue, dx, dy, x: rx, y: ry });
    if (dy >= dx) { rx += dx * (sumValue / value); rw -= dx * (sumValue / value); }
    else { ry += dy * (sumValue / value); rh -= dy * (sumValue / value); }
    value -= sumValue;
    i0 = i1;
  }

  const out = [];
  for (const row of rows) {
    const { dx, dy } = row;
    if (dy >= dx) {
      const alpha = row.sum / dx;
      let y = row.y;
      for (let j = row.start; j < row.end; j++) {
        const d = nodes[j];
        const rhh = d.value / alpha;
        out.push({ node: d.node, x0: row.x, y0: y, x1: row.x + dx, y1: y + rhh });
        y += rhh;
      }
    } else {
      const alpha = row.sum / dy;
      let x = row.x;
      for (let j = row.start; j < row.end; j++) {
        const d = nodes[j];
        const rww = d.value / alpha;
        out.push({ node: d.node, x0: x, y0: row.y, x1: x + rww, y1: row.y + dy });
        x += rww;
      }
    }
  }
  return out;
}

/** 递归布局: 行业 → 细分(内边距) → 个股 */
function computeLayout() {
  const d = props.data;
  if (!d || !w) return;
  layout = squarify(d.industries, 0, 0, w, h).map((ir) => {
    const P = 6; // 行业块内边距
    const sectors = squarify(ir.node.sectors, ir.x0 + P, ir.y0 + P, ir.x1 - P, ir.y1 - P);
    return {
      node: ir.node, x0: ir.x0, y0: ir.y0, x1: ir.x1, y1: ir.y1,
      sectors: sectors.map((sr) => {
        const p = 3;
        const stocks = squarify(sr.node.stocks, sr.x0 + p, sr.y0 + p, sr.x1 - p, sr.y1 - p);
        return { node: sr.node, x0: sr.x0, y0: sr.y0, x1: sr.x1, y1: sr.y1, stocks };
      }),
    };
  });
}

// ────────────────────────────── 渲染 ──────────────────────────────
function render() {
  const cv = canvasRef.value;
  if (!cv || !w) return;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 背景(参考站同款)
  ctx.fillStyle = "#262931";
  ctx.fillRect(0, 0, w, h);

  if (!props.data || !props.data.industries?.length) {
    ctx.fillStyle = "#9aa0a6";
    ctx.font = "13px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("加载中…", w / 2, h / 2);
    ctx.textAlign = "left";
    return;
  }

  computeLayout();

  for (const ind of layout) {
    const iw = ind.x1 - ind.x0, ih = ind.y1 - ind.y0;
    // 行业块: 深色底 + 圆角
    ctx.fillStyle = "#2e323a";
    ctx.beginPath();
    ctx.roundRect(ind.x0, ind.y0, iw, ih, 8);
    ctx.fill();
    // 行业名 + 涨跌幅(左上角)
    if (iw >= 90 && ih >= 26) {
      const cx = chgTextColor(ind.node.chg);
      drawText(ctx, ind.node.name, ind.x0 + 10, ind.y0 + 17, iw - 60, "600 12px 'Microsoft YaHei', sans-serif", "#e8eaed");
      const chgTxt = `${ind.node.chg >= 0 ? "+" : ""}${ind.node.chg.toFixed(2)}%`;
      ctx.font = "600 12px 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = cx;
      ctx.fillText(chgTxt, ind.x1 - 10 - ctx.measureText(chgTxt).width, ind.y0 + 17);
    }

    for (const sec of ind.sectors) {
      const sw = sec.x1 - sec.x0, sh = sec.y1 - sec.y0;
      // 细分行业底(略亮, 区分层级)
      ctx.fillStyle = "#383c45";
      ctx.beginPath();
      ctx.roundRect(sec.x0, sec.y0, sw, sh, 4);
      ctx.fill();
      // 细分行业名(面积足够时)
      if (sw >= 70 && sh >= 20 && sec.node.name !== ind.node.name) {
        drawText(ctx, sec.node.name, sec.x0 + 5, sec.y0 + 12, sw - 10, "10px 'Microsoft YaHei', sans-serif", "#b8bcc4");
      }

      for (const stk of sec.stocks) {
        const stw = stk.x1 - stk.x0, sth = stk.y1 - stk.y0;
        ctx.fillStyle = chgColor(stk.node.chg);
        ctx.fillRect(stk.x0 + 1, stk.y0 + 1, Math.max(0, stw - 2), Math.max(0, sth - 2));
        // 文本: 面积足够时显示名称 / 名称+涨跌幅
        const fs = Math.max(9, Math.min(13, Math.min(stw, sth) * 0.2));
        if (stw >= 44 && sth >= 20) {
          const txt = stk.node.name.length > 5 ? stk.node.name.slice(0, 5) : stk.node.name;
          ctx.font = `${fs}px 'Microsoft YaHei', sans-serif`;
          ctx.textAlign = "center";
          const cy = stk.y0 + sth / 2;
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillText(txt, stk.x0 + stw / 2 + 0.5, cy + 0.5);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(txt, stk.x0 + stw / 2, cy);
          if (stw >= 70 && sth >= 34) {
            const chgTxt = `${stk.node.chg >= 0 ? "+" : ""}${stk.node.chg.toFixed(2)}%`;
            ctx.font = `${fs - 1}px 'Microsoft YaHei', sans-serif`;
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillText(chgTxt, stk.x0 + stw / 2 + 0.5, cy + fs + 0.5);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(chgTxt, stk.x0 + stw / 2, cy + fs);
          }
          ctx.textAlign = "left";
        }
      }
    }
  }
}

/** 自适应宽度文本(超宽截断加省略号) */
function drawText(ctx, text, x, y, maxW, font, color) {
  ctx.font = font;
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    text += "…";
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ────────────────────────────── 交互 ──────────────────────────────
/** 命中检测: 返回最深的节点 {node, level} */
function hitTest(px, py) {
  for (const ind of layout) {
    if (px < ind.x0 || px > ind.x1 || py < ind.y0 || py > ind.y1) continue;
    for (const sec of ind.sectors) {
      if (px < sec.x0 || px > sec.x1 || py < sec.y0 || py > sec.y1) continue;
      for (const stk of sec.stocks) {
        if (px >= stk.x0 && px <= stk.x1 && py >= stk.y0 && py <= stk.y1) {
          return { node: stk.node, level: "stock" };
        }
      }
      return { node: sec.node, level: "sector" };
    }
    return { node: ind.node, level: "industry" };
  }
  return null;
}

function onMove(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = hitTest(px, py);
  if (hit) {
    const tipW = 190, tipH = 96;
    const flipX = px > w - tipW - 12;
    const flipY = py > h - tipH - 12;
    hover.value = {
      node: hit.node,
      level: hit.level,
      x: flipX ? px - tipW - 10 : px + 12,
      y: flipY ? py - tipH - 10 : py + 12,
    };
  } else {
    hover.value = null;
  }
}

function onDblClick(e) {
  const rect = canvasRef.value.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (hit?.level === "stock") {
    emit("select-stock", { code: hit.node.code, name: hit.node.name });
  }
}

/** 市值格式化: value 单位百万元 → 亿 */
function fmtValue(v) {
  const yi = v / 10000;
  return yi >= 100 ? yi.toFixed(0) : yi.toFixed(1);
}
</script>

<template>
  <div ref="wrapRef" class="treemap-canvas">
    <canvas ref="canvasRef" @mousemove="onMove" @mouseleave="hover = null" @dblclick="onDblClick" />

    <!-- 悬停详情 -->
    <div
      v-if="hover"
      class="tm-tooltip"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
    >
      <div class="tm-tip-name">
        {{ hover.node.name }}
        <span class="tm-tip-code">{{ hover.node.code }}</span>
      </div>
      <div class="tm-tip-row">
        <span>现价</span>
        <b>{{ hover.node.price > 0 ? hover.node.price.toFixed(2) : "--" }}</b>
      </div>
      <div class="tm-tip-row">
        <span>涨跌幅</span>
        <b :class="hover.node.chg > 0.01 ? 'up' : hover.node.chg < -0.01 ? 'down' : 'flat'">
          {{ hover.node.chg > 0 ? "+" : "" }}{{ hover.node.chg.toFixed(2) }}%
        </b>
      </div>
      <div class="tm-tip-row">
        <span>市值</span>
        <b>{{ fmtValue(hover.node.value) }} 亿</b>
      </div>
    </div>
  </div>
</template>

<style scoped>
.treemap-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #262931;
}
.treemap-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

/* 悬停 tooltip */
.tm-tooltip {
  position: absolute;
  z-index: 10;
  width: 190px;
  padding: 10px 12px;
  background: rgba(23, 25, 28, 0.94);
  border: 1px solid #3d4148;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  color: #e8eaed;
  pointer-events: none;
}
.tm-tip-name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-tip-code {
  margin-left: 6px;
  font-weight: 400;
  font-size: 11px;
  color: #9aa0a6;
}
.tm-tip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  line-height: 1.7;
}
.tm-tip-row span {
  color: #9aa0a6;
}
.tm-tip-row b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.tm-tip-row .up { color: #f4554f; }
.tm-tip-row .down { color: #2fbb4e; }
.tm-tip-row .flat { color: #c8ccd2; }
</style>
