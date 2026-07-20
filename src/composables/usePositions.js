import { ref, watch } from "vue";

const STORAGE_KEY = "stock-analysis-positions";

function loadPositions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * 持仓状态管理（含 localStorage 持久化）
 * 每条持仓: { code, name, buyPrice, quantity, buyDate, addedAt }
 */
export function usePositions() {
  const positions = ref(loadPositions());

  // 持久化
  watch(positions, (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  }, { deep: true });

  function addPosition(pos) {
    if (!pos || !pos.code) return;
    // 同只股票只保留一条，后加覆盖
    const idx = positions.value.findIndex((p) => p.code === pos.code);
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const entry = {
      ...pos,
      buyPrice: Number(pos.buyPrice) || 0,
      quantity: Number(pos.quantity) || 0,
      buyDate: pos.buyDate || dateStr,
      addedAt: dateStr,
    };
    if (idx !== -1) {
      positions.value[idx] = entry;
    } else {
      positions.value.push(entry);
    }
    positions.value = [...positions.value];
  }

  function removePosition(code) {
    positions.value = positions.value.filter((p) => p.code !== code);
    positions.value = [...positions.value];
  }

  function updatePositionQuote(code, quote) {
    const idx = positions.value.findIndex((p) => p.code === code);
    if (idx !== -1) {
      positions.value[idx] = { ...positions.value[idx], ...quote };
      positions.value = [...positions.value];
    }
  }

  return {
    positions,
    addPosition,
    removePosition,
    updatePositionQuote,
  };
}
