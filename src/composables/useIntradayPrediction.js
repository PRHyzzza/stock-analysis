import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./useSettings.js";
import { getLimitPct } from "../utils/limit";

const API_KEY_KEY = "stock-analysis-ai-api-key";
const MODEL_KEY = "stock-analysis-ai-model";

const DEFAULT_MODEL = "deepseek-v4-flash";

/** localStorage 安全读取 */
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 从 LLM 返回内容中提取 JSON（兼容 ```json 代码块） */
function extractJson(content) {
  if (!content) return null;
  if (typeof content === "object") return content;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    // 尝试截取第一个 { 到最后一个 }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 基于当前分时 + 日K，调用 DeepSeek 生成未来 N 分钟预测线。
 *
 * 返回结构：
 * {
 *   points: [{ time: "HH:mm", price: 12.34, lower: 12.30, upper: 12.38 }],
 *   model: "deepseek-v4-flash",
 *   generatedAt: 1234567890
 * }
 */
export function useIntradayPrediction() {
  const { state: settings } = useSettings();

  const prediction = ref(null);
  const predictionLoading = ref(false);
  const predictionError = ref("");

  // 防止快速切股时旧预测覆盖新股票
  let requestSeq = 0;

  async function loadPrediction(stock, intradayData, klineData) {
    if (!stock || !intradayData?.items?.length) {
      predictionError.value = "暂无分时数据，无法预测";
      return null;
    }

    // 非当日分时（如周末看到的是上一交易日）或已收盘时，没有“未来分时”可预测
    const now = new Date();
    const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const isHK = stock.market === "HK" || /^\d{5}$/.test(stock.code || "");
    const lastItem = intradayData.items[intradayData.items.length - 1];
    const lastMinutes = (() => {
      const [h, m] = (lastItem?.time || "00:00").split(":").map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
    })();
    const closeMinute = isHK ? 960 : 900;

    if (intradayData.date !== todayStr) {
      predictionError.value = "当前非交易时段或分时数据不是今日，暂无未来分时可预测";
      return null;
    }
    if (lastMinutes >= closeMinute) {
      predictionError.value = "当前已收盘，暂无未来分时可预测";
      return null;
    }


    const apiKey = safeGetItem(API_KEY_KEY);
    if (!apiKey) {
      predictionError.value = "请先在 AI 设置中配置 API Key";
      return null;
    }

    const seq = ++requestSeq;
    predictionLoading.value = true;
    predictionError.value = "";

    try {
      const model = safeGetItem(MODEL_KEY) || settings.aiModel || DEFAULT_MODEL;
      const messages = buildPredictionMessages(stock, intradayData, klineData);

      const result = await invoke("call_llm", {
        apiKey,
        model,
        messages,
        tools: [],
        reasoningEffort: "low",
        thinkingEnabled: false,
      });

      if (seq !== requestSeq) return null;

      const content = result?.choices?.[0]?.message?.content;
      const parsed = extractJson(content);
      const rawPoints = parsed?.points;
      const isHK = stock.market === "HK" || /^\d{5}$/.test(stock.code || "");
      const lastTime = intradayData.items[intradayData.items.length - 1]?.time || "";
      const lastPrice = intradayData.items[intradayData.items.length - 1]?.price ?? 0;
      let points = normalizePoints(rawPoints, intradayData, stock.code || "", isHK);
      if (!points.length && Array.isArray(rawPoints) && rawPoints.length > 0) {
        points = anchorAndClampPoints(
          shiftPointsToFuture(rawPoints, lastTime, isHK),
          lastTime, lastPrice, intradayData.preClose, stock.code || ""
        );
      }

      if (!points.length) {
          console.warn("[AI预测] 没有有效预测点", {
            lastTime: intradayData.items[intradayData.items.length - 1]?.time,
            rawCount: Array.isArray(rawPoints) ? rawPoints.length : 0,
            firstRaw: Array.isArray(rawPoints) ? rawPoints[0] : null,
            normalizedCount: points.length,
          });
          const allInPast = Array.isArray(rawPoints) && rawPoints.length > 0 &&
            rawPoints.every((p) => padTime(p?.time) <= lastTime);
          predictionError.value = allInPast
            ? `AI 返回的预测时间已过期（当前最新分时 ${lastTime}），请重试`
            : `AI 未能返回有效的预测点（原始点数 ${Array.isArray(rawPoints) ? rawPoints.length : 0}，最新分时 ${lastTime}），请重试`;
        prediction.value = null;
        return null;
      }

      const data = {
        points,
        model,
        generatedAt: Date.now(),
      };
      prediction.value = data;
      return data;
    } catch (e) {
      if (seq !== requestSeq) return null;
      console.error("AI 分时预测失败:", e);
      predictionError.value = `AI 预测失败: ${e}`;
      prediction.value = null;
      return null;
    } finally {
      if (seq === requestSeq) predictionLoading.value = false;
    }
  }

  function clearPrediction() {
    requestSeq++;
    prediction.value = null;
    predictionLoading.value = false;
    predictionError.value = "";
  }

  return {
    prediction,
    predictionLoading,
    predictionError,
    loadPrediction,
    clearPrediction,
  };
}

/** 构造发送给 LLM 的消息 */
function buildPredictionMessages(stock, intradayData, klineData) {
  const items = intradayData.items;
  // 只取最近 60 根，避免 prompt 过长
  const recent = items.slice(-60);
  const lastTime = items[items.length - 1]?.time || "";
  const lastPrice = items[items.length - 1]?.price ?? 0;

  const rows = recent.map((it) =>
    `${it.time},${it.price.toFixed(2)},${(it.avgPrice || 0).toFixed(2)},${(it.vwap || 0).toFixed(2)},${Math.round(it.volume || 0)}`
  ).join("\n");

  let klineSummary = "（无）";
  if (Array.isArray(klineData) && klineData.length > 0) {
    const recentK = klineData.slice(-10);
    klineSummary = recentK
      .map((k) => `${k.date},${k.open},${k.close},${k.high},${k.low}`)
      .join("\n");
  }

  const isHK = stock.market === "HK" || /^\d{5}$/.test(stock.code || "");
  const marketRule = isHK
    ? "港股无涨跌停限制，交易时段 9:30-12:00 / 13:00-16:00"
    : "A 股主板 ±10%，创业板/科创板 ±20%，北交所 ±30%；交易时段 9:30-11:30 / 13:00-15:00";

  const prompt = `你是一个 A 股/港股分时走势预测引擎。请基于用户提供的最近分时数据和日K数据，预测未来 30 分钟价格走势。

要求：
1. 只输出 JSON，不要输出任何解释、Markdown 或代码块。
2. JSON 格式固定为：{"points":[{"time":"HH:mm","price":12.34,"lower":12.30,"upper":12.38}]}
3. price/lower/upper 都保留 2 位小数。
4. 【最重要】当前最新分时时间是 ${lastTime}，最新价是 ${lastPrice}。预测必须从 ${lastTime} 的下一分钟开始，连续输出未来 30 分钟；第一个预测点的 price 必须落在 ${lastPrice} 的 ±0.3% 以内（预测线从最新价自然延伸），绝不能从 09:31 等过早时间开始。如果临近收盘，只输出到收盘前最后一分钟。
5. A 股中午 11:30-13:00 休市，不要跨午休输出；港股 12:00-13:00 休市，也不要跨休市输出。
6. 预测价格不能超过涨跌停价（如果有）。
7. lower 必须小于等于 price，upper 必须大于等于 price。
8. 走势判断必须客观平衡：未来 30 分钟可以上涨、下跌或横盘，绝不能无条件偏向单一方向（尤其禁止系统性看空）。短线应延续最近 10-15 分钟的趋势，同时结合最新价与均价/VWAP 的相对位置做适度均值回归，给出合理折中；所有预测点必须与 ${lastPrice} 保持同一数量级，不得整体大幅低于或高于最新价。
9. 如果数据不足或无法预测，返回 {"points":[]}。

当前股票：${stock.name}（${stock.code}）
昨收：${intradayData.preClose}
市场规则：${marketRule}

最近分时数据（time,price,avgPrice,vwap,volume）：
${rows}

最近日K（date,open,close,high,low）：
${klineSummary}`;

  return [
    { role: "system", content: "你是一个严谨的量化预测引擎，只输出 JSON。" },
    { role: "user", content: prompt },
  ];
}


/** 判断预测时间是否在交易时段内（A 股 9:30-11:30/13:00-15:00，港股 9:30-12:00/13:00-16:00） */
function isSessionMinute(time, isHK) {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const t = h * 60 + m;
  if (isHK) {
    return (t >= 570 && t <= 720) || (t >= 780 && t <= 960);
  }
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

/** 生成下一分钟 HH:mm */
function nextMinute(time) {
  const [h, m] = time.split(":").map(Number);
  let nh = h;
  let nm = m + 1;
  if (nm >= 60) {
    nh += 1;
    nm = 0;
  }
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/** 时间串规范化为 HH:mm（模型可能输出 9:31 而非 09:31，字符串比较会错乱） */
function padTime(time) {
  const s = String(time || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return s;
  return `${String(Number(m[1])).padStart(2, "0")}:${String(Number(m[2])).padStart(2, "0")}`;
}

/** 保留 2 位小数 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 预测点后处理（防"预测线永远向下"的关键）：
 * 1. 锚定 — 模型输出的首点价若偏离最新实际价超过 0.3%，把整条预测线整体平移
 *    （保留相对形态），使预测线从最新价自然延伸，消除 LLM 系统性看空或量纲
 *    错乱导致的跳空下坠；
 * 2. 约束 — 每个预测点钳制在 [涨跌停区间 ∩ 最新价 ±3%]（30 分钟窗口）内，
 *    lower/upper 始终包住 price。
 */
function anchorAndClampPoints(points, lastTime, lastPrice, preClose, stockCode) {
  if (!Array.isArray(points) || points.length === 0) return points;

  const limitPct = getLimitPct(stockCode);
  const hasLimit = limitPct > 0 && Number.isFinite(preClose) && preClose > 0;
  const limitUp = hasLimit ? preClose * (1 + limitPct / 100) : Infinity;
  const limitDown = hasLimit ? preClose * (1 - limitPct / 100) : -Infinity;

  // 首点锚定：只平移未来点，锚点（lastTime, lastPrice）原样保留
  const firstFuture = points.find((p) => p.time > lastTime);
  let offset = 0;
  if (firstFuture && Number.isFinite(lastPrice) && lastPrice > 0) {
    const dev = lastPrice - Number(firstFuture.price);
    if (Number.isFinite(dev) && Math.abs(dev) / lastPrice > 0.003) offset = dev;
  }

  const band = Number.isFinite(lastPrice) && lastPrice > 0 ? lastPrice * 0.03 : Infinity;
  const loPrice = Number.isFinite(lastPrice) ? lastPrice - band : -Infinity;
  const hiPrice = Number.isFinite(lastPrice) ? lastPrice + band : Infinity;
  const out = [];
  for (const p of points) {
    if (p.time <= lastTime) {
      out.push(p);
      continue;
    }
    let price = Number(p.price) + offset;
    price = Math.min(Math.max(price, Math.max(limitDown, loPrice)), Math.min(limitUp, hiPrice));
    let lower = Number(p.lower) + offset;
    let upper = Number(p.upper) + offset;
    lower = Number.isFinite(lower) && lower > 0 ? Math.min(lower, price) : price;
    upper = Number.isFinite(upper) && upper > 0 ? Math.max(upper, price) : price;
    out.push({ time: p.time, price: round2(price), lower: round2(lower), upper: round2(upper) });
  }
  return out;
}

/**
 * 兜底：当 LLM 返回的时间全部早于当前最新分时（例如模型从 09:31 开始输出，
 * 但当前已经是 10:30），就把这条 30 分钟形态整体平移到当前时间之后，
 * 保留模型给出的价格序列，只修正时间锚点。
 */
function shiftPointsToFuture(rawPoints, lastTime, isHK) {
  if (!lastTime) return [];
  const out = [];
  let t = lastTime;
  let safety = 0;

  for (const raw of rawPoints) {
    t = nextMinute(t);
    safety++;
    if (safety > 2000) break;

    // 跳过午休/非交易时段；如果越过收盘仍找不到有效时间则放弃
    while (!isSessionMinute(t, isHK)) {
      t = nextMinute(t);
      safety++;
      if (safety > 2000) return out;
    }

    const price = Number(typeof raw === "number" ? raw : raw?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const lower = Number(raw?.lower);
    const upper = Number(raw?.upper);
    out.push({
      time: t,
      price,
      lower: Number.isFinite(lower) && lower > 0 ? lower : price,
      upper: Number.isFinite(upper) && upper > 0 ? upper : price,
    });
  }

  return out;
}


/** 规范化/过滤预测点 */
function normalizePoints(rawPoints, intradayData, stockCode = "", isHK = false) {
  if (!Array.isArray(rawPoints)) return [];

  const items = intradayData.items;
  const lastTime = items[items.length - 1]?.time || "";
  const lastPrice = items[items.length - 1]?.price;

  const seen = new Set();
  let points = [];

  // 如果 LLM 返回的第一个点不是从下一分钟开始，则用当前实际价作为锚点拼接
  let needsAnchor = true;
  for (const raw of rawPoints) {
    const time = padTime(raw?.time);
    const price = Number(raw?.price);
    if (!time || !Number.isFinite(price) || price <= 0) continue;
    if (time <= lastTime) continue; // 只保留未来点，避免和实际线重叠
      if (!isSessionMinute(time, isHK)) continue; // 跳过午休/非交易时段
    if (seen.has(time)) continue;
    seen.add(time);

    if (needsAnchor) {
      if (lastTime && lastPrice > 0) {
        points.push({ time: lastTime, price: lastPrice, lower: lastPrice, upper: lastPrice });
      }
      needsAnchor = false;
    }

    const lower = Number(raw?.lower);
    const upper = Number(raw?.upper);
    points.push({
      time,
      price,
      lower: Number.isFinite(lower) && lower > 0 ? lower : price,
      upper: Number.isFinite(upper) && upper > 0 ? upper : price,
    });
  }

  // 如果没有任何未来点，则不返回锚点
  if (needsAnchor) {
      // 模型可能没按当前时间输出，尝试把整段形态平移到当前时间之后
      points = shiftPointsToFuture(rawPoints, lastTime, isHK);
    }

  // 按时间排序，防止 LLM 返回乱序
  points.sort((a, b) => a.time.localeCompare(b.time));

  // 锚定 + 约束：保证预测线从最新实际价自然延伸，且不越出合理区间
  return anchorAndClampPoints(points, lastTime, lastPrice, intradayData.preClose, stockCode);
}
