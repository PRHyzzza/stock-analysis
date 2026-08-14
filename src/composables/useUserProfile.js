import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 用户画像 — AI 自动维护的 markdown 文件
 *
 * 流程：
 *   1. App 启动时 loadProfile() 读取本地 user-profile.md
 *   2. AI 对话时将画像注入系统提示词
 *   3. 每轮对话结束后，自动调用 AI 更新画像（增量进化）
 *   4. saveProfile() 写入 user-profile.md 到 Tauri app data dir
 */
function useUserProfile() {
  const profileContent = ref("");       // md 原文
  const loading = ref(false);
  const error = ref("");

  /** 从文件读取画像 */
  async function loadProfile() {
    loading.value = true;
    error.value = "";
    try {
      profileContent.value = await invoke("read_user_profile");
    } catch (e) {
      console.error("加载用户画像失败:", e);
      error.value = e?.message || String(e);
      profileContent.value = "";
    } finally {
      loading.value = false;
    }
  }

  // 写串行链：并发保存（AI 后台更新 vs 手动编辑）时按调用顺序依次写入，
  // 避免"先读后写"交错导致最终状态不是最后一次写入
  let saveChain = Promise.resolve();

  /** 保存画像到文件（串行化，后一次覆盖前一次） */
  function saveProfile(content) {
    saveChain = saveChain.then(async () => {
      try {
        await invoke("save_user_profile", { content });
        profileContent.value = content;
      } catch (e) {
        console.error("保存用户画像失败:", e);
        error.value = e?.message || String(e);
      }
    });
    return saveChain;
  }

  /** 获取注入 AI 上下文的画像文本 */
  function getProfileForContext() {
    const content = profileContent.value;
    if (!content || !content.trim()) return "";
    return content.trim();
  }

  return {
    profileContent,
    loading,
    error,
    loadProfile,
    saveProfile,
    getProfileForContext,
  };
}

// ── 单例（跨组件共享同一份画像状态）──
let _singleton = null;
export function useUserProfileSingleton() {
  if (!_singleton) _singleton = useUserProfile();
  return _singleton;
}
