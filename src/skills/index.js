/**
 * Skills Index
 * 集中注册、合并所有技能模块。
 * 每个 skill 文件默认导出 { name, description, tools, toolImpl, systemPrompt }。
 */

import StockQuote from "./StockQuote.js";
import KlineAnalysis from "./KlineAnalysis.js";
import MoneyFlow from "./MoneyFlow.js";
import Industry from "./Industry.js";
import MarketIndices from "./MarketIndices.js";
import WebSearch from "./WebSearch.js";

/** 所有技能列表 */
export const SKILLS = [
  StockQuote,
  KlineAnalysis,
  MoneyFlow,
  Industry,
  MarketIndices,
  WebSearch,
];

/** 合并所有工具的 tool_definitions（发给 LLM 用） */
export function getMergedTools(opts = {}) {
  const exclude = opts.excludeSkills || [];
  return SKILLS
    .filter((s) => !exclude.includes(s.name))
    .flatMap((s) => s.tools);
}

/** 合并所有工具的 toolImpl（本地执行用） */
export function getMergedToolImpl(opts = {}) {
  const exclude = opts.excludeSkills || [];
  return SKILLS
    .filter((s) => !exclude.includes(s.name))
    .reduce((acc, s) => Object.assign(acc, s.toolImpl), {});
}

/** 合并所有技能的 systemPrompt 描述 */
export function getMergedSystemPrompt() {
  return SKILLS.map((s) => s.systemPrompt).join("\n\n");
}

/**
 * 获取指定名称的工具实现
 * @param {string} name - 工具/函数名称
 * @returns {Function|undefined}
 */
export function getToolImpl(name, opts = {}) {
  return getMergedToolImpl(opts)[name];
}
