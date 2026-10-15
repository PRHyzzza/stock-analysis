import { computed, ref, watch } from "vue";
import { usePositions } from "./usePositions.js";

/**
 * usePortfolio — 持仓组合层分析（纯计算 + 行业标签缓存）
 *
 * 目的：把 usePositions 的「逐只盈亏」升级为「组合视角」——
 *   1. 当日盈亏（需 prevClose，来自行情刷新写入 position 的字段）
 *   2. 仓位权重（按市值占比，用于集中度判断）
 *   3. 估值指标（加权 PE，仅统计有效 PE > 0 的持仓）
 *   4. 行业集中度（行业标签来自东财，逐只懒加载 + localStorage 缓存）
 *   5. 风险指标（最大单票权重、HHI、盈亏比、上涨/下跌家数）
 *
 * 口径约定：
 *   - 所有金额一律折合人民币（港股按 usePositions.fxRate 换算），与 usePositions 一致
 *   - 资产类别只区分「A股 / 港股」，不臆造板块（北交所归 A 股）
 *   - 行业标签可能缺失（港股无行业分析、抓取失败、未登录）——缺失时如实披露覆盖率，
 *     禁止把「未取到」当作「无行业」并入统计（见 PROJECT.md §7.22 同类口径要求）
 *   - 本 composable 是**单例**：行业缓存与请求去重跨组件共享，避免反复抓取
 *
 * 行业标签来源：命令 `get_stock_industry` 的 `industry_name` 字段。
 * 该命令内部是「抓行情页 HTML + 东财 HSF10」两次请求，较重且可能失败，
 * 故：逐只串行拉取、命中缓存不再请求、失败静默（不阻断组合面板），
 * 并在 UI 明示覆盖率。
 */

const INDUSTRY_CACHE_KEY = "stock-analysis-industry-cache";

/** 行业标签缓存有效期：30 天（行业归属极少变化） */
const INDUSTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 判断是否为港股（5 位数字代码），与 usePositions 保持一致 */
function isHK(code) {
  return /^\d{5}$/.test(code);
}

/**
 * 资产类别标签：只区分 A股 / 港股（不做板块臆造）
 * @param {string} code
 * @returns {"A股"|"港股"}
 */
export function assetClassOf(code) {
  return isHK(code) ? "港股" : "A股";
}

/** 加载行业缓存 { code: { industry, ts } } */
function loadIndustryCache() {
  try {
    const raw = localStorage.getItem(INDUSTRY_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 单例实例 */
let _instance = null;

export function usePortfolio() {
  if (_instance) return _instance;

  const {
    positionStats,
    fxRate,
    hasHK,
    totalCostCNY,
    totalMarketValueCNY,
    totalProfitCNY,
    totalProfitPctCNY,
  } = usePositions();

  /** 行业缓存 { code: { industry, ts } }，持久化避免重复抓取 */
  const industryCache = ref(loadIndustryCache());
  /** 正在抓取行业标签的代码集合（用于去重与 UI 加载态） */
  const industryLoading = ref([]);
  /** 行业抓取失败过的代码（本轮会话内不再重试，避免反复打接口） */
  const industryFailed = ref([]);

  watch(industryCache, (val) => {
    try {
      localStorage.setItem(INDUSTRY_CACHE_KEY, JSON.stringify(val));
    } catch { /* ignore quota errors */ }
  }, { deep: true });

  /**
   * 取某代码的行业标签（仅读缓存，不发请求）
   * @returns {string} 行业名，未命中返回 ""
   */
  function industryOf(code) {
    const hit = industryCache.value[code];
    if (!hit || !hit.industry) return "";
    if (Date.now() - (hit.ts || 0) > INDUSTRY_TTL_MS) return ""; // 过期视为未知
    return hit.industry;
  }

  /**
   * 为一批代码补齐行业标签（逐只串行；命中缓存/已失败则跳过）
   *
   * 刻意串行：`get_stock_industry` 每次打两个外部接口（行情页 HTML + HSF10），
   * 并发会显著提高被限流概率；组合面板最多几十只，串行可接受。
   * 任何失败都不抛出——组合面板的其余部分照常可用。
   *
   * @param {string[]} codes
   * @param {(code: string) => Promise<string>} fetcher 注入的抓取函数（便于测试/解耦 invoke）
   */
  async function ensureIndustries(codes, fetcher) {
    const need = (codes || []).filter(
      (c) => c && !industryOf(c) && !industryLoading.value.includes(c) && !industryFailed.value.includes(c)
    );
    if (need.length === 0) return;

    for (const code of need) {
      industryLoading.value = [...industryLoading.value, code];
      try {
        const name = await fetcher(code);
        if (name && name !== "港股") {
          industryCache.value = {
            ...industryCache.value,
            [code]: { industry: name, ts: Date.now() },
          };
        } else {
          // 港股无行业分析（后端固定返回「港股」）：不算失败，但也不写入缓存污染统计
          industryFailed.value = [...industryFailed.value, code];
        }
      } catch {
        industryFailed.value = [...industryFailed.value, code];
      } finally {
        industryLoading.value = industryLoading.value.filter((c) => c !== code);
      }
    }
  }

  /** 手动重试行业抓取（清空失败记录，供 UI「重试」按钮） */
  function resetIndustryFailures() {
    industryFailed.value = [];
  }

  // ── 逐只组合行（含当日盈亏、权重、行业）──
  /**
   * 每行附加字段：
   *   marketValueCNY / costCNY / profitCNY      折合人民币
   *   dayProfitCNY / dayChangePct               当日盈亏（需 prevClose，缺失为 null）
   *   weightPct                                 市值权重（占组合总市值 %）
   *   assetClass / industry / industryKnown     资产类别 + 行业标签（及是否取到）
   */
  const rows = computed(() => {
    const total = totalMarketValueCNY.value;
    return positionStats.value.map((p) => {
      const rate = p.isHK ? fxRate.value : 1;
      const marketValueCNY = p.marketValue * rate;
      const costCNY = p.totalCost * rate;
      const profitCNY = marketValueCNY - costCNY;

      // 当日盈亏：需要昨收。取不到（新增持仓尚未刷新行情 / 接口失败）时为 null，
      // 不能拿成本价凑数，否则会把「未知」显示成「持平」。
      const prevClose = Number(p.prevClose) || 0;
      const currentPrice = Number(p.currentPrice) || 0;
      const hasPrev = prevClose > 0 && currentPrice > 0;
      const dayProfitCNY = hasPrev ? (currentPrice - prevClose) * (p.quantity || 0) * rate : null;
      const dayChangePct = hasPrev ? ((currentPrice - prevClose) / prevClose) * 100 : null;

      const industry = industryOf(p.code);
      return {
        ...p,
        rate,
        marketValueCNY,
        costCNY,
        profitCNY,
        dayProfitCNY,
        dayChangePct,
        weightPct: total > 0 ? (marketValueCNY / total) * 100 : 0,
        assetClass: assetClassOf(p.code),
        industry,
        industryKnown: !!industry,
      };
    });
  });

  /** 组合当日盈亏合计（折合人民币）；只要有一行缺昨收就标记为不完整 */
  const dayProfit = computed(() => {
    const known = rows.value.filter((r) => r.dayProfitCNY != null);
    return {
      value: known.reduce((s, r) => s + r.dayProfitCNY, 0),
      /** 参与计算的持仓数 */
      covered: known.length,
      /** 缺昨收的持仓数（>0 时 UI 必须标注「部分持仓未计」） */
      missing: rows.value.length - known.length,
      /** 组合当日盈亏率（相对昨收市值；无有效数据为 null） */
      pct: (() => {
        if (known.length === 0) return null;
        const base = known.reduce((s, r) => s + (r.marketValueCNY - r.dayProfitCNY), 0);
        return base > 0 ? (known.reduce((s, r) => s + r.dayProfitCNY, 0) / base) * 100 : null;
      })(),
    };
  });

  /** 上涨 / 下跌 / 平盘家数（按当日涨跌幅，缺昨收的不计） */
  const dayBreadth = computed(() => {
    let up = 0, down = 0, flat = 0;
    for (const r of rows.value) {
      if (r.dayChangePct == null) continue;
      if (r.dayChangePct > 0) up++;
      else if (r.dayChangePct < 0) down++;
      else flat++;
    }
    return { up, down, flat };
  });

  /** 当日最赚 / 最亏的一只（按当日盈亏金额，缺昨收不计） */
  const dayBestWorst = computed(() => {
    const known = rows.value.filter((r) => r.dayProfitCNY != null);
    if (known.length === 0) return { best: null, worst: null };
    const sorted = [...known].sort((a, b) => b.dayProfitCNY - a.dayProfitCNY);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  });

  /** 持仓盈亏排序（按浮动盈亏金额） */
  const rowsByProfit = computed(() =>
    [...rows.value].sort((a, b) => b.profitCNY - a.profitCNY)
  );

  /** 占比最大的单票（集中度风险） */
  const topHolding = computed(() => {
    if (rows.value.length === 0) return null;
    return [...rows.value].sort((a, b) => b.weightPct - a.weightPct)[0];
  });

  /** 前 3 大持仓权重合计 */
  const top3WeightPct = computed(() =>
    [...rows.value]
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 3)
      .reduce((s, r) => s + r.weightPct, 0)
  );

  /**
   * 赫芬达尔指数 HHI = Σ(权重²)，0–10000
   * 口径：>2500 视为高度集中，1500–2500 中度，<1500 分散（行业常用的粗分档）
   */
  const hhi = computed(() =>
    rows.value.reduce((s, r) => s + Math.pow(r.weightPct, 2), 0)
  );

  /** 集中度分级文案 */
  const concentration = computed(() => {
    const h = hhi.value;
    if (rows.value.length <= 1) return { level: "单一", hint: "仅一只持仓，无分散可言" };
    if (h > 2500) return { level: "高度集中", hint: "单票波动主导组合，注意回撤" };
    if (h >= 1500) return { level: "中度集中", hint: "分散度一般" };
    return { level: "较为分散", hint: "个股风险相对摊薄" };
  });

  /** 按资产类别聚合（A股 / 港股，含权重） */
  const byAssetClass = computed(() => {
    const total = totalMarketValueCNY.value;
    const map = new Map();
    for (const r of rows.value) {
      const cur = map.get(r.assetClass) || { key: r.assetClass, count: 0, marketValueCNY: 0, profitCNY: 0 };
      cur.count += 1;
      cur.marketValueCNY += r.marketValueCNY;
      cur.profitCNY += r.profitCNY;
      map.set(r.assetClass, cur);
    }
    return [...map.values()]
      .map((g) => ({ ...g, weightPct: total > 0 ? (g.marketValueCNY / total) * 100 : 0 }))
      .sort((a, b) => b.marketValueCNY - a.marketValueCNY);
  });

  /**
   * 按行业聚合（仅统计已取到行业标签的持仓）
   * 另返回覆盖情况，供 UI 如实标注「行业数据缺失 N 只」。
   */
  const byIndustry = computed(() => {
    const total = totalMarketValueCNY.value;
    const known = rows.value.filter((r) => r.industryKnown);
    const knownValue = known.reduce((s, r) => s + r.marketValueCNY, 0);
    const map = new Map();
    for (const r of known) {
      const cur = map.get(r.industry) || { key: r.industry, count: 0, marketValueCNY: 0, profitCNY: 0, codes: [] };
      cur.count += 1;
      cur.marketValueCNY += r.marketValueCNY;
      cur.profitCNY += r.profitCNY;
      cur.codes.push(r.code);
      map.set(r.industry, cur);
    }
    return {
      groups: [...map.values()]
        .map((g) => ({
          ...g,
          weightPct: knownValue > 0 ? (g.marketValueCNY / knownValue) * 100 : 0,
          /** 占整个组合的比例（与 maxIndustryWeightPct 同口径） */
          portfolioPct: total > 0 ? (g.marketValueCNY / total) * 100 : 0,
        }))
        .sort((a, b) => b.marketValueCNY - a.marketValueCNY),
      knownCount: known.length,
      unknownCount: rows.value.length - known.length,
      /** 行业标签覆盖率（%） */
      coveragePct: rows.value.length > 0 ? (known.length / rows.value.length) * 100 : 0,
      /** 已知持仓的市值合计（分母说明用） */
      knownValueCNY: knownValue,
    };
  });

  /** 最大行业权重（占整个组合；仅在有行业数据时给值） */
  const maxIndustryWeightPct = computed(() => {
    const g = byIndustry.value.groups;
    return g.length > 0 ? g[0].portfolioPct : null;
  });

  /**
   * 加权市盈率：仅统计 PE > 0（亏损股 PE ≤ 0 无法加权，剔除并披露）
   * 权重用市值；港股 PE 由腾讯接口给出，与 A 股同口径（不做汇率调整——PE 是无量纲比值）
   */
  const weightedPE = computed(() => {
    const valid = rows.value.filter((r) => Number(r.pe) > 0 && r.marketValueCNY > 0);
    if (valid.length === 0) return { value: null, covered: 0, excluded: rows.value.length };
    const num = valid.reduce((s, r) => s + Number(r.pe) * r.marketValueCNY, 0);
    const den = valid.reduce((s, r) => s + r.marketValueCNY, 0);
    return {
      value: den > 0 ? num / den : null,
      covered: valid.length,
      excluded: rows.value.length - valid.length,
    };
  });

  /** 持仓数量 */
  const count = computed(() => rows.value.length);

  /** 组合是否为空 */
  const isEmpty = computed(() => rows.value.length === 0);

  _instance = {
    // 原始汇总（透传 usePositions，便于组件只用一处 import）
    totalCostCNY,
    totalMarketValueCNY,
    totalProfitCNY,
    totalProfitPctCNY,
    hasHK,
    fxRate,
    // 组合分析
    rows,
    rowsByProfit,
    count,
    isEmpty,
    dayProfit,
    dayBreadth,
    dayBestWorst,
    topHolding,
    top3WeightPct,
    hhi,
    concentration,
    byAssetClass,
    byIndustry,
    maxIndustryWeightPct,
    weightedPE,
    // 行业标签
    industryCache,
    industryLoading,
    industryFailed,
    industryOf,
    ensureIndustries,
    resetIndustryFailures,
  };
  return _instance;
}
