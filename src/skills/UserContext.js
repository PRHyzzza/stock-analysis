/**
 * UserContext Skill
 * 用户上下文数据：用户画像读写 + 港元兑人民币汇率
 * 用于个性化分析（结合画像）与港股金额换算
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "user-context",
  description: "用户画像与汇率工具",

  tools: [
    {
      type: "function",
      function: {
        name: "read_user_profile",
        description:
          "读取用户的投资画像（Markdown 文本）：风险偏好、持仓偏好、投资风格、关注标的等。" +
          "用户要求个性化分析（如「结合我的情况分析」「适不适合我」）时读取，让建议更贴合用户。",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "save_user_profile",
        description:
          "保存用户投资画像（Markdown 文本），会覆盖现有内容。仅当用户明确要求记录画像信息时使用，" +
          "且必须在现有内容基础上追加而非重写，避免丢失用户已保存的信息。",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "完整的画像 Markdown 内容（需包含原有内容 + 新增内容）",
            },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_fx_rate",
        description:
          "获取港元兑人民币汇率（CNY per HKD），约 0.9 左右。分析港股价格、市值、金额换算为人民币时使用。",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ],

  toolImpl: {
    async read_user_profile() {
      try {
        return await invoke("read_user_profile");
      } catch (e) {
        return `[错误] 读取用户画像失败: ${e}`;
      }
    },
    async save_user_profile({ content }) {
      try {
        await invoke("save_user_profile", { content });
        return "用户画像已保存";
      } catch (e) {
        return `[错误] 保存用户画像失败: ${e}`;
      }
    },
    async get_fx_rate() {
      try {
        return JSON.stringify(await invoke("get_fx_rate"), null, 2);
      } catch (e) {
        return `[错误] 获取汇率失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 用户上下文
\`read_user_profile\` 读取用户投资画像（风险偏好/持仓风格/关注标的），做个性化分析时使用；\`save_user_profile\` 保存画像（必须保留原有内容仅追加，用户明确要求时才调用）；\`get_fx_rate\` 获取港元兑人民币汇率，分析港股金额时换算用。`,
};
