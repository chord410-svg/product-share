(function () {
  const STORAGE_KEY = "resource_nav_packages_v1";
  const CARD_SIZE_KEY = "resource_nav_card_size_v1";
  const LAST_SESSION_ENTRY_KEY = "resource_nav_last_session_entry_v1";
  const MAX_PACKAGES = 10;
  const RESOURCE_DATA_VERSION = "20260524-output-tabs-return-session";
  const DRAFT_SAVE_DELAY_MS = 700;
  const state = {
    topics: [],
    resources: [],
    packages: [],
    activePackageId: "",
    category: "",
    selectedTopics: new Set(),
    district: "",
    urgency: "",
    smartQueryText: "",
    smartQueryAppliedText: "",
    packageIds: new Set(),
    hasUrlContext: false,
    sessionToken: "",
    apiBase: "",
    source: "direct",
    hasSessionParam: false,
    hasApiBaseParam: false,
    apiBaseSource: "missing",
    runtimeConfigChecked: false,
    sessionUser: null,
    sessionValid: false,
    sessionFailureReason: "",
    guildId: "",
    resultChannelId: "",
    activeView: "nav",
    cardSize: localStorage.getItem(CARD_SIZE_KEY) || "medium",
    expandedPackageIds: new Set(),
    draftSaveTimer: null,
    packageSaveState: "idle",
  };

  const HELP_CONTENT = {
    smart: {
      title: "智慧查詢怎麼用",
      body: `
        <p>輸入補充描述後按「套用智慧查詢」，系統會依文字重新排序並高亮較可能相關的卡片。</p>
        <ul>
          <li>會做：比對資源名稱、摘要、下一步、文件、身份/情境、電話確認問題。</li>
          <li>不會做：不會刪掉其他卡片，不會判定資格，不會承諾補助一定通過。</li>
          <li>適合輸入：獨居、最近沒錢買飯、家屬不穩定。</li>
        </ul>
      `,
    },
    google: {
      title: "Google 延伸搜尋怎麼用",
      body: `
        <p>按下後會用目前條件組成搜尋詞，開啟 Google 搜尋頁補查外部資料。</p>
        <ul>
          <li>搜尋詞來源：行政區、主題、子主題、已選資源線索、智慧查詢補充文字。</li>
          <li>只會開 Google 搜尋頁，不抓取 Google 結果，也不會整理回站內資料。</li>
          <li>適合用在：站內資料不足、想找最新公告、想補查民間資源或官方流程。</li>
        </ul>
      `,
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function newId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayLabel() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) return "未記錄";
    const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function versionedAsset(path) {
    return path + (path.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(RESOURCE_DATA_VERSION);
  }

  function parseParams() {
    const params = new URLSearchParams(window.location.search);
    state.category = params.get("category") || "";
    const topicParam = params.get("topics") || "";
    topicParam.split(",").filter(Boolean).forEach((key) => state.selectedTopics.add(key));
    const source = params.get("source") || "direct";
    state.sessionToken = params.get("session") || "";
    state.apiBase = (params.get("api_base") || "").replace(/\/$/, "");
    state.guildId = params.get("guild") || "";
    state.resultChannelId = params.get("result_channel") || "";
    state.source = source;
    state.hasSessionParam = Boolean(state.sessionToken);
    state.hasApiBaseParam = Boolean(state.apiBase);
    state.apiBaseSource = state.apiBase ? "url" : "missing";
    state.district = params.get("district") || "";
    state.hasUrlContext = Boolean(state.category || topicParam);
    renderIdentity("checking", source === "discord" ? "Discord 入口，等待身份確認" : "未連結 Discord，請回 Discord 重新開啟入口");
  }

  function apiUrl(path) {
    if (!state.apiBase) return "";
    return state.apiBase + path;
  }

  function rememberSessionEntryUrl() {
    if (!state.sessionToken || !state.apiBase) return;
    try {
      const currentParams = new URLSearchParams(window.location.search);
      const params = new URLSearchParams();
      if (state.category) params.set("category", state.category);
      if (state.selectedTopics.size) params.set("topics", Array.from(state.selectedTopics).join(","));
      if (currentParams.get("channel_id")) params.set("channel_id", currentParams.get("channel_id"));
      if (state.guildId) params.set("guild", state.guildId);
      if (state.resultChannelId) params.set("result_channel", state.resultChannelId);
      if (state.district) params.set("district", state.district);
      params.set("source", "discord");
      params.set("session", state.sessionToken);
      params.set("api_base", state.apiBase);
      const entryUrl = "./resource-nav.html?" + params.toString();
      sessionStorage.setItem(LAST_SESSION_ENTRY_KEY, entryUrl);
      localStorage.setItem(LAST_SESSION_ENTRY_KEY, entryUrl);
    } catch (error) {
      console.info("remember resource nav entry failed", error);
    }
  }

  async function apiFetch(path, options) {
    if (!state.sessionToken) {
      throw new Error("no_session");
    }
    if (!state.apiBase) {
      throw new Error("no_api_base");
    }
    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + state.sessionToken,
    };
    let response;
    try {
      response = await fetch(apiUrl(path), {
        ...(options || {}),
        headers: { ...headers, ...((options && options.headers) || {}) },
      });
    } catch (error) {
      throw new Error("api_unreachable");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      if (response.status === 401 || data.error === "invalid_or_expired_session" || data.error === "auth_required") {
        throw new Error("invalid_or_expired_session");
      }
      if (response.status === 404) {
        throw new Error("api_old_version");
      }
      throw new Error(data.error || "api_unavailable");
    }
    return data;
  }

  function identityText() {
    if (!state.sessionValid || !state.sessionUser) return "";
    const name = state.sessionUser.name || "Discord 使用者";
    const id = state.sessionUser.id || "";
    return name + (id ? " / " + id : "");
  }

  function renderIdentity(status, reason) {
    const pill = $("sourceStatus");
    if (!pill) return;
    pill.classList.remove("is-linked", "is-offline", "is-error");
    if (status === "linked") {
      pill.classList.add("is-linked");
      pill.textContent = "已連結 Discord：" + identityText();
      return;
    }
    if (status === "offline") {
      pill.classList.add("is-offline");
      pill.textContent = "未連結 Discord，請回 Discord 重新開啟入口";
      return;
    }
    if (status === "error") {
      pill.classList.add("is-error");
    }
    pill.textContent = reason || "Discord 身份未確認";
  }

  function sessionReasonLabel(reason) {
    const labels = {
      verified: "已完成 Discord 身份驗證。",
      no_session: "網址沒有 session；請從 Discord 資源導航入口重新開啟。",
      no_api_base: "網址沒有 api_base；Bot 可能尚未帶入 API 網址，或 RESOURCE_NAV_API_BASE / WEB_B_SUBMIT_URL 尚未設定。",
      runtime_api_base: "網址內的 API 無法使用，已改用網站 runtime config 內的 API base 重試。",
      session_expired: "後端回覆 session 無效或過期；token 已不存在或已超過有效時間，請回 Discord 重新點入口。",
      api_unreachable: "公開 API 網址連不上；通常是 Cloudflare tunnel 已失效、DNS 解析不到，或 Bot API 沒有啟動。",
      api_old_version: "公開 API 可連上，但不是新版資源包 API；請確認 Bot 已重啟到新版 server。",
      api_unavailable: "API 回覆異常；請確認 Bot 已重啟，且公開網址指向新版 server。",
      api_failed: "正式流程送出失敗；已改用本機預覽結果。",
      missing_session: "缺少 Discord session 或 API 網址；已改用本機預覽結果。",
    };
    return labels[reason] || "尚未完成驗證。";
  }

  function renderSessionDebug() {
    const sessionStatus = $("sessionTokenStatus");
    const apiBaseStatus = $("apiBaseStatus");
    const verifyStatus = $("sessionVerifyStatus");
    const reasonStatus = $("sessionReasonStatus");
    if (!sessionStatus || !apiBaseStatus || !verifyStatus || !reasonStatus) return;
    sessionStatus.textContent = state.hasSessionParam ? "有 session 參數" : "缺少 session 參數";
    if (state.apiBaseSource === "runtime") {
      apiBaseStatus.textContent = "由 runtime config 補上";
    } else {
      apiBaseStatus.textContent = state.hasApiBaseParam ? "有 api_base 參數" : "缺少 api_base 參數";
    }
    verifyStatus.textContent = state.sessionValid ? "已驗證 Discord 身份" : "未完成後端驗證";
    reasonStatus.textContent = state.sessionValid
      ? sessionReasonLabel("verified")
      : sessionReasonLabel(state.sessionFailureReason || "missing_session");
  }

  async function applyRuntimeApiBase() {
    if (state.runtimeConfigChecked) return false;
    state.runtimeConfigChecked = true;
    const runtimeUrls = [
      "https://raw.githubusercontent.com/chord410-svg/product-share/main/resource-nav-runtime.json?v=" + Date.now(),
      "./resource-nav-runtime.json?v=" + Date.now(),
    ];
    try {
      let nextApiBase = "";
      for (const url of runtimeUrls) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (response.ok) {
            const data = await response.json();
            const apiBase = String(data.api_base || "").replace(/\/$/, "");
            if (apiBase && apiBase !== state.apiBase) {
              nextApiBase = apiBase;
              break;
            }
          }
        } catch (error) {
          console.info("resource runtime config fetch failed", url, error);
        }
      }
      if (!nextApiBase) return false;
      state.apiBase = nextApiBase;
      state.apiBaseSource = "runtime";
      state.sessionFailureReason = "runtime_api_base";
      renderSessionDebug();
      return true;
    } catch (error) {
      console.info("resource runtime config unavailable", error);
      return false;
    }
  }

  async function verifySession() {
    const loginStatus = $("loginStatus");
    if (!state.sessionToken) {
      state.sessionValid = false;
      state.sessionFailureReason = "no_session";
      loginStatus.textContent = state.source === "discord"
        ? "已從 Discord 入口開啟，但網址沒有 session。可先產生本機預覽結果；若要保存到 Discord 私密 QR，請回 Discord 重新點入口。"
        : "未取得 Discord session：可瀏覽與點選資源，也可先產生本機預覽結果；若要保存到 Discord 私密 QR，請回 Discord 重新點入口。";
      renderIdentity("offline");
      renderSessionDebug();
      return;
    }
    if (!state.apiBase) {
      if (await applyRuntimeApiBase()) {
        return verifySession();
      }
      state.sessionValid = false;
      state.sessionFailureReason = "no_api_base";
      loginStatus.textContent = "已取得 session，但網址沒有 api_base，網站不知道要向哪個 Bot API 驗證身份。可先產生本機預覽結果；若要保存到 Discord 私密 QR，請確認 Bot 入口已更新後重新開啟。";
      renderIdentity("error", "API 未設定");
      renderSessionDebug();
      return;
    }
    try {
      const data = await apiFetch("/api/v1/resource/session?token=" + encodeURIComponent(state.sessionToken), {
        method: "GET",
        headers: {},
      });
      state.sessionValid = true;
      state.sessionFailureReason = "";
      state.sessionUser = data.user || null;
      rememberSessionEntryUrl();
      renderIdentity("linked");
      loginStatus.textContent = "已連結 Discord：" + identityText() + "。草稿與結果會保存到你的資源組合工作台。";
      renderSessionDebug();
    } catch (error) {
      if (await applyRuntimeApiBase()) {
        return verifySession();
      }
      state.sessionValid = false;
      if (error.message === "invalid_or_expired_session") {
        state.sessionFailureReason = "session_expired";
        renderIdentity("error", "session 已失效");
      } else if (error.message === "api_unreachable") {
        state.sessionFailureReason = "api_unreachable";
        renderIdentity("error", "API 連不上");
      } else if (error.message === "api_old_version") {
        state.sessionFailureReason = "api_old_version";
        renderIdentity("error", "API 版本不符");
      } else {
        state.sessionFailureReason = "api_unavailable";
        renderIdentity("error", "API 異常");
      }
      loginStatus.textContent = "已從 Discord 入口開啟，但後端驗證未通過：" + sessionReasonLabel(state.sessionFailureReason) + " 可先產生本機預覽結果；若要保存到 Discord 私密 QR，請回 Discord 重新點入口。";
      renderSessionDebug();
      console.info("resource session verification failed", error);
    }
  }

  async function loadJson(path, fallbackPath) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) return response.json();
    } catch (error) {
      console.info(path + " load failed, trying fallback", error);
    }
    const fallback = await fetch(fallbackPath, { cache: "no-store" });
    if (!fallback.ok) throw new Error(path + " and fallback load failed");
    return fallback.json();
  }

  function getCurrentTopic() {
    return state.topics.find((topic) => topic.key === state.category) || state.topics[0];
  }

  function normalizeCategory() {
    if (!state.topics.length) return;
    if (!state.topics.some((topic) => topic.key === state.category)) {
      state.category = state.topics[0].key;
    }
  }

  function normalizeSelectedTopics() {
    const topic = getCurrentTopic();
    if (!topic) return;
    const validKeys = new Set((topic.options || []).map((option) => option.key));
    state.selectedTopics = new Set(Array.from(state.selectedTopics).filter((key) => validKeys.has(key)));
  }

  function topicLabel(topicKey) {
    const topic = state.topics.find((item) => item.key === topicKey);
    return topic ? topic.title : topicKey;
  }

  function optionLabels(topic) {
    const map = new Map((topic.options || []).map((option) => [option.key, option.label]));
    return Array.from(state.selectedTopics).map((key) => map.get(key) || key);
  }

  function asList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function uniqueList(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function resourceIdentityTags(resource) {
    return uniqueList([
      ...asList(resource.eligibility_tags),
      ...asList(resource.urgency_tags),
    ]);
  }

  function normalizeCardSize(size) {
    return ["small", "medium", "large"].includes(size) ? size : "medium";
  }

  function renderCardSizeControls() {
    document.querySelectorAll("[data-card-size]").forEach((button) => {
      const active = button.dataset.cardSize === state.cardSize;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function setCardSize(size) {
    state.cardSize = normalizeCardSize(size);
    localStorage.setItem(CARD_SIZE_KEY, state.cardSize);
    renderCardSizeControls();
    renderCards();
  }

  function resourceById(id) {
    return state.resources.find((resource) => resource.id === id) || null;
  }

  function categoryAccent(category) {
    const colors = {
      care_professional: "#0f8f5f",
      transport: "#2563eb",
      assistive_accessibility: "#7c3aed",
      multi_professional: "#b7791f",
      informal: "#dc6b19",
      foreign_caregiver: "#c026d3",
      other: "#0f766e",
    };
    return colors[category] || "#0f766e";
  }

  function selectedPackageResources() {
    const byId = new Map(state.resources.map((resource) => [resource.id, resource]));
    return Array.from(state.packageIds).map((id) => byId.get(id)).filter(Boolean);
  }

  function derivedIdentityTags() {
    return uniqueList(selectedPackageResources().flatMap(resourceIdentityTags));
  }

  function isFamilyVisible(resource) {
    return resource.public_allowed !== false && resource.status !== "過期";
  }

  async function copyText(text) {
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    area.value = text;
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function openHelpDialog(kind) {
    const content = HELP_CONTENT[kind];
    if (!content) return;
    $("helpDialogTitle").textContent = content.title;
    $("helpDialogBody").innerHTML = content.body;
    $("helpDialog").hidden = false;
  }

  function closeHelpDialog() {
    $("helpDialog").hidden = true;
  }

  function readPackages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          name: String(item.name || "臨時資源包"),
          note: String(item.note || ""),
          resourceIds: Array.isArray(item.resourceIds) ? item.resourceIds.map(String) : [],
          district: String(item.district || ""),
          category: String(item.category || ""),
          selectedTopicKeys: Array.isArray(item.selectedTopicKeys) ? item.selectedTopicKeys.map(String) : [],
          urgency: String(item.urgency || ""),
          smartQueryText: String(item.smartQueryText || ""),
          smartQueryAppliedAt: String(item.smartQueryAppliedAt || ""),
          derivedIdentityTags: Array.isArray(item.derivedIdentityTags) ? item.derivedIdentityTags.map(String) : [],
          guildId: String(item.guildId || ""),
          resultChannelId: String(item.resultChannelId || ""),
          createdAt: String(item.createdAt || nowIso()),
          updatedAt: String(item.updatedAt || nowIso()),
          status: String(item.status || (item.shareUrl ? "result_ready" : "draft")),
          outputMode: String(item.outputMode || "family"),
          shareUrl: String(item.shareUrl || ""),
          sharePageId: String(item.sharePageId || ""),
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_PACKAGES);
    } catch (error) {
      console.info("resource package storage unreadable", error);
      return [];
    }
  }

  function writePackages() {
    try {
      state.packages = state.packages
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_PACKAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
    } catch (error) {
      console.info("resource package storage failed", error);
    }
  }

  function defaultPackageName() {
    const district = state.district || "未指定地區";
    const topic = getCurrentTopic();
    const selectedLabels = optionLabels(topic).slice(0, 3);
    const middle = selectedLabels.length ? selectedLabels : [topic ? topic.title : "資源"];
    return [district, ...middle, todayLabel()].filter(Boolean).join(" / ");
  }

  function currentPackage() {
    let item = state.packages.find((pkg) => pkg.id === state.activePackageId);
    if (!item) {
      item = createPackage(defaultPackageName(), { save: false });
    }
    return item;
  }

  function createPackage(name, options) {
    const created = {
      id: newId("pkg"),
      name: name || "臨時資源包",
      note: "",
      resourceIds: [],
      district: state.district,
      category: state.category,
      selectedTopicKeys: Array.from(state.selectedTopics),
      urgency: state.urgency,
      smartQueryText: state.smartQueryText,
      smartQueryAppliedAt: "",
      derivedIdentityTags: [],
      guildId: state.guildId,
      resultChannelId: state.resultChannelId,
      status: "draft",
      outputMode: "family",
      shareUrl: "",
      sharePageId: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.packages.unshift(created);
    state.activePackageId = created.id;
    state.packageIds = new Set();
    if (!options || options.save !== false) writePackages();
    return created;
  }

  function syncPackageFromState() {
    const item = currentPackage();
    item.name = item.name || defaultPackageName();
    item.note = item.note || "";
    item.resourceIds = Array.from(state.packageIds);
    item.district = state.district;
    item.category = state.category;
    item.selectedTopicKeys = Array.from(state.selectedTopics);
    item.urgency = state.urgency;
    item.smartQueryText = state.smartQueryText;
    item.derivedIdentityTags = derivedIdentityTags();
    item.guildId = state.guildId;
    item.resultChannelId = state.resultChannelId;
    item.outputMode = item.outputMode || "family";
    if (item.status !== "result_pending" && item.status !== "result_ready") item.status = "draft";
    item.updatedAt = nowIso();
    writePackages();
    scheduleDraftSave();
  }

  function markSmartQueryApplied() {
    const item = currentPackage();
    item.smartQueryAppliedAt = nowIso();
    writePackages();
  }

  function applyPackageContext(item) {
    state.activePackageId = item.id;
    state.packageIds = new Set(item.resourceIds || []);
    state.district = item.district || state.district;
    state.category = item.category || state.category;
    state.selectedTopics = new Set(item.selectedTopicKeys || []);
    state.urgency = item.urgency || "";
    state.smartQueryText = item.smartQueryText || "";
    state.smartQueryAppliedText = item.smartQueryAppliedAt ? state.smartQueryText : "";
    state.guildId = item.guildId || state.guildId;
    state.resultChannelId = item.resultChannelId || state.resultChannelId;
    normalizeCategory();
    normalizeSelectedTopics();
  }

  function renderPackageManager() {
    currentPackage();
  }

  function switchView(view) {
    state.activeView = view === "workbench" ? "workbench" : "nav";
    const isNav = state.activeView === "nav";
    $("navView").hidden = !isNav;
    $("workbenchView").hidden = isNav;
    $("navView").classList.toggle("is-active", isNav);
    $("workbenchView").classList.toggle("is-active", !isNav);
    $("navTabButton").classList.toggle("is-active", isNav);
    $("workbenchTabButton").classList.toggle("is-active", !isNav);
    $("navTabButton").setAttribute("aria-selected", isNav ? "true" : "false");
    $("workbenchTabButton").setAttribute("aria-selected", isNav ? "false" : "true");
    if (document.activeElement && document.activeElement.classList.contains("view-tab")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (state.activeView === "workbench") {
      renderPackage();
      if (state.sessionValid) loadRemotePackages();
      renderWorkbench();
    }
  }

  function statusLabel(status) {
    const labels = {
      draft: "草稿",
      result_pending: "結果產生中",
      result_ready: "已產生結果",
      result_failed: "結果失敗",
    };
    return labels[status] || "草稿";
  }

  function modeLabel(mode) {
    const labels = {
      family: "家屬版",
      phone: "電話確認",
      admin: "行政申請",
      handoff: "交接摘要",
    };
    return labels[mode] || "家屬版";
  }

  function packageTopicText(item) {
    const topic = state.topics.find((row) => row.key === item.category);
    const optionMap = new Map(((topic && topic.options) || []).map((option) => [option.key, option.label]));
    const labels = (item.selectedTopicKeys || []).map((key) => optionMap.get(key) || key).filter(Boolean);
    return labels.length ? labels.join("、") : (topic ? topic.title : "未指定子主題");
  }

  function renderWorkbench() {
    const status = $("workbenchStatus");
    const list = $("workbenchList");
    const empty = $("workbenchEmpty");
    if (!status || !list || !empty) return;
    list.innerHTML = "";
    if (!state.sessionValid) {
      status.textContent = "未連結 Discord，請回 Discord 重新開啟入口。";
      empty.hidden = false;
      empty.textContent = "目前是未登入瀏覽，只能使用本機暫存，不能讀取個人資源組合。";
      return;
    }
    status.textContent = "目前查看 " + identityText() + " 的資源組合。";
    const packages = state.packages.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    empty.hidden = packages.length > 0;
    empty.textContent = "目前還沒有資源組合。回到資源導航，點選卡片後會先建立草稿。";
    packages.forEach((item) => {
      const card = document.createElement("article");
      const isExpanded = state.expandedPackageIds.has(item.id);
      card.className = "workbench-card" + (isExpanded ? " is-expanded" : "");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      card.title = "點擊可展開或收合已選資源清單";
      const toggleExpanded = () => {
        if (state.expandedPackageIds.has(item.id)) state.expandedPackageIds.delete(item.id);
        else state.expandedPackageIds.add(item.id);
        renderWorkbench();
      };
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, select, textarea")) return;
        toggleExpanded();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleExpanded();
      });

      const head = document.createElement("div");
      head.className = "workbench-card-head";
      const titleWrap = document.createElement("div");
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = "資源組合｜" + (item.district || "未指定地區");
      const title = document.createElement("h3");
      title.textContent = item.name || "臨時資源包";
      titleWrap.append(eyebrow, title);
      const badge = document.createElement("span");
      badge.className = "status-badge " + String(item.status || "draft").replace("_", "-");
      badge.textContent = statusLabel(item.status);
      head.append(titleWrap, badge);

      const meta = document.createElement("p");
      meta.className = "workbench-meta";
      meta.textContent = [
        packageTopicText(item),
        "資源 " + (item.resourceIds || []).length + " 筆",
        "更新 " + formatDateTime(item.updatedAt),
      ].join("｜");

      const actions = document.createElement("div");
      actions.className = "workbench-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-action";
      edit.textContent = "繼續編輯";
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        applyPackageContext(item);
        switchView("nav");
        render();
      });
      const view = document.createElement("button");
      view.type = "button";
      view.className = "primary-action";
      view.textContent = item.shareUrl ? "查看結果" : "查看結果";
      view.addEventListener("click", async (event) => {
        event.stopPropagation();
        await openOrCreatePackageResult(item, view);
      });
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-action";
      copy.textContent = "另存副本";
      copy.title = "複製這包資源成新的草稿，不改原本紀錄。";
      copy.addEventListener("click", async (event) => {
        event.stopPropagation();
        const duplicate = {
          ...item,
          id: newId("pkg"),
          name: (item.name || "資源組合") + " 副本",
          status: "draft",
          shareUrl: "",
          sharePageId: "",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        state.packages.unshift(duplicate);
        applyPackageContext(duplicate);
        syncPackageFromState();
        await saveDraftNow();
        switchView("nav");
        render();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger-action";
      remove.textContent = "刪除";
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!window.confirm("確定刪除這個資源組合？")) return;
        try {
          await apiFetch("/api/v1/resource/packages/" + encodeURIComponent(item.id), { method: "DELETE" });
          state.packages = state.packages.filter((pkg) => pkg.id !== item.id);
          state.expandedPackageIds.delete(item.id);
          if (state.activePackageId === item.id) state.activePackageId = "";
          renderWorkbench();
        } catch (error) {
          window.alert("刪除失敗，請稍後再試。");
        }
      });
      actions.append(edit, view, copy, remove);

      const expanded = document.createElement("div");
      expanded.className = "workbench-expanded";
      expanded.hidden = !isExpanded;
      const expandedTitle = document.createElement("h4");
      expandedTitle.textContent = "已選資源清單";
      const selectedList = document.createElement("div");
      selectedList.className = "workbench-resource-list";
      const resourceIds = item.resourceIds || [];
      if (!resourceIds.length) {
        const none = document.createElement("p");
        none.className = "workbench-expanded-empty";
        none.textContent = "這個資源組合尚未加入資源。";
        selectedList.appendChild(none);
      } else {
        resourceIds.forEach((resourceId) => {
          const resource = resourceById(resourceId);
          const row = document.createElement("div");
          row.className = "workbench-resource-row";
          row.style.setProperty("--row-accent", categoryAccent(resource ? resource.category : ""));
          const text = document.createElement("div");
          const strong = document.createElement("strong");
          strong.textContent = resource ? resource.name : resourceId;
          const metaLine = document.createElement("span");
          const confidence = resource ? (resource.confidence || resource.source_type || "待確認") : "資料尚未載入";
          metaLine.textContent = resource ? topicLabel(resource.category) + "｜" + confidence : "資料尚未載入";
          text.append(strong, metaLine);
          const rowRemove = document.createElement("button");
          rowRemove.type = "button";
          rowRemove.textContent = "移除";
          rowRemove.addEventListener("click", (event) => {
            event.stopPropagation();
            item.resourceIds = (item.resourceIds || []).filter((id) => id !== resourceId);
            item.status = "draft";
            item.shareUrl = "";
            item.sharePageId = "";
            item.updatedAt = nowIso();
            applyPackageContext(item);
            syncPackageFromState();
            renderCards();
            renderPackage();
            renderWorkbench();
          });
          row.append(text, rowRemove);
          selectedList.appendChild(row);
        });
      }
      expanded.append(expandedTitle, selectedList);

      card.append(head, meta, actions, expanded);
      list.appendChild(card);
    });
  }

  function normalizeServerPackage(record) {
    return {
      id: String(record.package_id || record.id || ""),
      name: String(record.name || "臨時資源包"),
      note: String(record.note || ""),
      resourceIds: Array.isArray(record.resource_ids) ? record.resource_ids.map(String) : [],
      district: String(record.district || ""),
      category: String(record.category || ""),
      selectedTopicKeys: Array.isArray(record.selected_topic_keys) ? record.selected_topic_keys.map(String) : [],
      urgency: String(record.urgency || ""),
      smartQueryText: String(record.smart_query_text || ""),
      smartQueryAppliedAt: "",
      derivedIdentityTags: [],
      guildId: String(record.guild_id || ""),
      resultChannelId: String(record.result_channel_id || ""),
      status: String(record.status || (record.share_url ? "result_ready" : "draft")),
      outputMode: String(record.output_mode || "family"),
      shareUrl: String(record.share_url || ""),
      sharePageId: String(record.share_page_id || ""),
      createdAt: record.created_at ? new Date(Number(record.created_at) * 1000).toISOString() : nowIso(),
      updatedAt: record.updated_at ? new Date(Number(record.updated_at) * 1000).toISOString() : nowIso(),
    };
  }

  async function loadRemotePackages() {
    if (!state.sessionValid) return [];
    try {
      const data = await apiFetch("/api/v1/resource/packages", { method: "GET", headers: {} });
      const packages = Array.isArray(data.packages) ? data.packages.map(normalizeServerPackage).filter((item) => item.id) : [];
      state.packages = packages;
      renderWorkbench();
      return packages;
    } catch (error) {
      console.info("resource packages load failed", error);
      return [];
    }
  }

  function packagePayload(item, overrides) {
    return {
      packageId: item.id,
      name: item.name || defaultPackageName(),
      note: item.note || "",
      category: item.category || state.category,
      selectedTopicKeys: item.selectedTopicKeys || Array.from(state.selectedTopics),
      district: item.district || state.district,
      urgency: item.urgency || state.urgency,
      smartQueryText: item.smartQueryText || state.smartQueryText,
      resourceIds: item.resourceIds || Array.from(state.packageIds),
      outputMode: item.outputMode || "family",
      guildId: item.guildId || state.guildId,
      resultChannelId: item.resultChannelId || state.resultChannelId,
      ...(overrides || {}),
    };
  }

  function scheduleDraftSave() {
    if (!state.sessionValid || !state.packageIds.size) return;
    if (state.draftSaveTimer) window.clearTimeout(state.draftSaveTimer);
    state.packageSaveState = "waiting";
    state.draftSaveTimer = window.setTimeout(() => {
      saveDraftNow();
    }, DRAFT_SAVE_DELAY_MS);
  }

  async function saveDraftNow() {
    if (!state.sessionValid || !state.packageIds.size) return null;
    const item = currentPackage();
    state.packageSaveState = "saving";
    try {
      const data = await apiFetch("/api/v1/resource/packages/draft", {
        method: "POST",
        body: JSON.stringify(packagePayload(item, { status: "draft" })),
      });
      const saved = normalizeServerPackage(data.package || {});
      const index = state.packages.findIndex((pkg) => pkg.id === item.id);
      const merged = { ...item, ...saved, resourceIds: item.resourceIds, derivedIdentityTags: item.derivedIdentityTags };
      if (index >= 0) state.packages[index] = merged;
      else state.packages.unshift(merged);
      state.activePackageId = merged.id;
      state.packageSaveState = "saved";
      renderWorkbench();
      renderPackage();
      return merged;
    } catch (error) {
      state.packageSaveState = "failed";
      console.info("resource draft save failed", error);
      renderPackage();
      return null;
    }
  }

  function createChip(labelText, selected, onToggle) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-chip" + (selected ? " is-selected" : "");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.textContent = labelText;
    button.addEventListener("click", onToggle);
    return button;
  }

  function renderCategorySelect() {
    const select = $("categorySelect");
    select.innerHTML = "";
    state.topics.forEach((topic) => {
      const option = document.createElement("option");
      option.value = topic.key;
      option.textContent = topic.channel_name + "｜" + topic.title;
      select.appendChild(option);
    });
    if (!state.category && state.topics[0]) state.category = state.topics[0].key;
    select.value = state.category;
    select.onchange = () => {
      state.category = select.value;
      state.selectedTopics.clear();
      syncPackageFromState();
      render();
    };
  }

  function renderTopicChips(topic) {
    const wrap = $("topicChips");
    wrap.innerHTML = "";
    (topic.options || []).forEach((item) => {
      wrap.appendChild(createChip(item.label, state.selectedTopics.has(item.key), () => {
        if (state.selectedTopics.has(item.key)) state.selectedTopics.delete(item.key);
        else state.selectedTopics.add(item.key);
        syncPackageFromState();
        renderTopicChips(topic);
        renderCards();
        renderPackage();
        updateGoogleButton();
      }));
    });
  }

  function setupFilters() {
    $("navTabButton").addEventListener("click", () => switchView("nav"));
    $("workbenchTabButton").addEventListener("click", () => switchView("workbench"));
    $("refreshWorkbench").addEventListener("click", async () => {
      if (state.sessionValid) await loadRemotePackages();
      renderWorkbench();
    });
    $("packageNameInput").addEventListener("input", (event) => {
      const item = currentPackage();
      item.name = event.target.value.trim() || defaultPackageName();
      syncPackageFromState();
      renderWorkbench();
    });
    $("districtSelect").addEventListener("change", (event) => {
      state.district = event.target.value;
      syncPackageFromState();
      renderCards();
    });
    $("urgencySelect").addEventListener("change", (event) => {
      state.urgency = event.target.value;
      syncPackageFromState();
      renderCards();
    });
    $("smartQueryInput").addEventListener("input", (event) => {
      state.smartQueryText = event.target.value.trim();
      syncPackageFromState();
      updateGoogleButton();
    });
    $("applySmartQuery").addEventListener("click", () => {
      state.smartQueryAppliedText = state.smartQueryText;
      markSmartQueryApplied();
      syncPackageFromState();
      renderCards();
    });
    $("googleSearchButton").addEventListener("click", () => {
      const url = buildGoogleSearchUrl();
      $("googleSearchButton").dataset.searchUrl = url;
      window.open(url, "_blank", "noopener,noreferrer");
    });
    document.querySelectorAll("[data-help]").forEach((button) => {
      button.addEventListener("click", () => openHelpDialog(button.dataset.help || ""));
    });
    $("closeHelpDialog").addEventListener("click", closeHelpDialog);
    $("helpDialog").addEventListener("click", (event) => {
      if (event.target === $("helpDialog")) closeHelpDialog();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("helpDialog").hidden) closeHelpDialog();
    });
    document.querySelectorAll("[data-card-size]").forEach((button) => {
      button.addEventListener("click", () => setCardSize(button.dataset.cardSize || "medium"));
    });
    renderCardSizeControls();
    $("saveDraftButton").addEventListener("click", updateCurrentDraft);
  }

  function matchesResource(resource) {
    if (resource.category !== state.category) return false;
    if (resource.status === "停用" || resource.status === "過期") return false;
    if (state.selectedTopics.size > 0) {
      const resourceTopics = new Set(resource.topics || []);
      if (!Array.from(state.selectedTopics).some((key) => resourceTopics.has(key))) return false;
    }
    if (state.district) {
      const districts = resource.districts || [];
      if (!districts.includes("全新北") && !districts.includes("全台") && !districts.includes(state.district)) {
        return false;
      }
    }
    if (state.urgency) {
      const urgencyTags = resource.urgency_tags || [];
      if (!urgencyTags.includes(state.urgency)) return false;
    }
    return true;
  }

  function queryTerms(text) {
    return uniqueList(String(text || "")
      .toLowerCase()
      .split(/[\s,，、。；;：:！!？?／/]+/)
      .map((term) => term.trim())
      .filter(Boolean));
  }

  function smartHaystack(resource) {
    return [
      resource.name,
      resource.public_summary,
      resource.summary,
      resource.public_next_step,
      resource.next_step,
      resource.public_contact,
      resource.contact,
      ...asList(resource.public_required_documents),
      ...resourceIdentityTags(resource),
      ...asList(resource.phone_check_questions),
      resource.internal_notes,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function scoreResource(resource) {
    const query = state.smartQueryAppliedText.trim().toLowerCase();
    if (!query) return 0;
    const haystack = smartHaystack(resource);
    const terms = queryTerms(query);
    let score = haystack.includes(query) ? 3 : 0;
    terms.forEach((term) => {
      if (haystack.includes(term)) score += term.length >= 3 ? 2 : 1;
    });
    return score;
  }

  function sortResults(results) {
    const scored = results.map((resource) => ({ resource, score: scoreResource(resource) }));
    if (state.smartQueryAppliedText) {
      scored.sort((a, b) => b.score - a.score || a.resource.name.localeCompare(b.resource.name, "zh-Hant"));
    }
    return scored;
  }

  function cardSummary(resource) {
    const summary = String(resource.public_summary || resource.summary || "").trim();
    const body = String(resource.body || "").trim();
    if (summary && body && body !== summary && !summary.includes(body)) {
      return summary + " " + body;
    }
    return summary || body || "請開啟來源或內部註記確認資源內容。";
  }

  function familyText(resource) {
    return [
      resource.name,
      resource.public_summary || resource.summary || "",
      "下一步：" + (resource.public_next_step || resource.next_step || "請先確認申請條件與受理狀態。"),
      "聯絡/申請：" + (resource.public_contact || resource.contact || "依來源公告"),
      asList(resource.public_required_documents).length
        ? "可先準備：" + asList(resource.public_required_documents).join("、")
        : "",
    ].filter(Boolean).join("\n");
  }

  function phoneText(resource) {
    const questions = asList(resource.phone_check_questions);
    return [
      resource.name,
      "聯絡/申請：" + (resource.public_contact || resource.contact || "依來源公告"),
      questions.length ? "電話確認：" + questions.join("；") : "電話確認：是否仍受理、資格條件、需要文件、服務區域。",
      resource.internal_notes ? "內部提醒：" + resource.internal_notes : "",
    ].filter(Boolean).join("\n");
  }

  function adminText(resource) {
    const docs = asList(resource.public_required_documents);
    const flags = asList(resource.risk_flags);
    return [
      resource.name,
      "狀態：" + (resource.status || "待確認"),
      "資料來源：" + (resource.source_url || "未提供"),
      "最後確認：" + (resource.last_checked_at || "待確認"),
      "下次檢查：" + (resource.next_review_at || "未設定"),
      docs.length ? "文件：" + docs.join("、") : "文件：待確認",
      flags.length ? "注意：" + flags.join("、") : "",
    ].filter(Boolean).join("\n");
  }

  function handoffText(resource) {
    return [
      resource.name,
      "建議下一步：" + (resource.public_next_step || resource.next_step || "請先確認資格與受理狀態。"),
      "電話確認：" + (asList(resource.phone_check_questions).join("；") || "資格、文件、服務區域、是否仍受理。"),
      resource.internal_notes ? "內部註記：" + resource.internal_notes : "",
    ].filter(Boolean).join("\n");
  }

  function togglePackageResource(resource) {
    const willAdd = !state.packageIds.has(resource.id);
    if (willAdd) state.packageIds.add(resource.id);
    else state.packageIds.delete(resource.id);
    syncPackageFromState();
    renderCards();
    renderPackage();
    const notice = $("navPackageNotice");
    if (notice) {
      notice.textContent = (willAdd ? "已加入：" : "已移除：") + resource.name + "。到「我的資源組合」可管理與產生結果。";
    }
  }

  function renderDerivedIdentityChips() {
    const panel = document.querySelector(".selected-insights");
    const wrap = $("derivedIdentityChips");
    const tags = derivedIdentityTags();
    wrap.innerHTML = "";
    if (!tags.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "insight-chip";
      chip.textContent = tag;
      wrap.appendChild(chip);
    });
  }

  function renderCards() {
    const topic = getCurrentTopic();
    const cards = $("cards");
    state.cardSize = normalizeCardSize(state.cardSize);
    cards.classList.remove("card-size-small", "card-size-medium", "card-size-large");
    cards.classList.add("card-size-" + state.cardSize);
    renderCardSizeControls();
    const scoredResults = sortResults(state.resources.filter(matchesResource));
    const results = scoredResults.map((item) => item.resource);
    $("currentScope").textContent = topic.title + "資源";
    const selectedLabels = optionLabels(topic);
    $("scopeMeta").textContent = [
      state.district ? "行政區：" + state.district : "行政區不限",
      selectedLabels.length ? "子主題：" + selectedLabels.join("、") : "尚未指定子主題",
      state.smartQueryAppliedText ? "智慧查詢已套用：" + state.smartQueryAppliedText : "",
      "共 " + results.length + " 筆",
    ].filter(Boolean).join("｜");

    updateGoogleButton();
    renderDerivedIdentityChips();

    cards.innerHTML = "";
    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "目前條件沒有符合的資源。可以放寬行政區或子主題，或用 Google 延伸搜尋補查。";
      cards.appendChild(empty);
      renderPackage();
      return;
    }

    const template = $("resourceCardTemplate");
    scoredResults.forEach(({ resource, score }) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector(".resource-card");
      card.id = "resource-card-" + resource.id;
      card.classList.toggle("is-selected", state.packageIds.has(resource.id));
      card.classList.toggle("smart-match", Boolean(state.smartQueryAppliedText && score > 0));
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a, summary, details, input, select, textarea")) return;
        togglePackageResource(resource);
      });
      node.querySelector(".category").textContent = topicLabel(resource.category);
      node.querySelector(".checked-at-inline").textContent = "確認：" + (resource.last_checked_at || "待確認");
      const title = node.querySelector("h3");
      title.innerHTML = "";
      if (resource.source_url) {
        const link = document.createElement("a");
        link.href = resource.source_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = resource.name;
        title.appendChild(link);
      } else {
        title.textContent = resource.name;
      }
      node.querySelector(".confidence").textContent = resource.confidence || resource.status || "待確認";
      const smartHit = node.querySelector(".smart-hit");
      if (state.smartQueryAppliedText && score > 0) {
        smartHit.hidden = false;
        smartHit.textContent = "智慧查詢命中 " + score;
      }
      node.querySelector(".summary").textContent = cardSummary(resource);
      node.querySelector(".eligibility").textContent = asList(resource.eligibility_tags).join("、") || "身份/情境未標示";
      const urgencyTags = asList(resource.urgency_tags);
      node.querySelector(".urgency-tags").textContent = urgencyTags.length ? "急迫性：" + urgencyTags.join("、") : "";
      node.querySelector(".next-step").textContent = resource.public_next_step || resource.next_step || "請先確認個案條件與受理狀態。";
      node.querySelector(".contact").textContent = resource.public_contact || resource.contact || "依來源公告";
      const docs = asList(resource.public_required_documents);
      node.querySelector(".required-docs").textContent = docs.length ? docs.join("、") : "待確認";

      const note = node.querySelector(".internal-note");
      note.textContent = resource.internal_notes || "尚無內部註記。";
      const questions = node.querySelector(".phone-questions");
      asList(resource.phone_check_questions).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        questions.appendChild(li);
      });
      if (!questions.children.length) {
        const li = document.createElement("li");
        li.textContent = "資格、文件、服務區域、是否仍受理。";
        questions.appendChild(li);
      }
      const flags = node.querySelector(".risk-flags");
      asList(resource.risk_flags).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        flags.appendChild(li);
      });
      if (!flags.children.length) {
        const li = document.createElement("li");
        li.textContent = "尚無特殊提醒。";
        flags.appendChild(li);
      }
      cards.appendChild(node);
    });
    renderPackage();
  }

  function buildFamilyPackageText(items) {
    const visibleItems = items.filter(isFamilyVisible);
    return [
      "家屬版資源包：" + currentPackage().name,
      currentPackage().note ? "情境：" + currentPackage().note : "",
      "",
      ...visibleItems.map((resource, index) => (index + 1) + ". " + familyText(resource)),
    ].filter(Boolean).join("\n\n");
  }

  function buildPhonePackageText(items) {
    return [
      "個管師電話確認清單：" + currentPackage().name,
      "",
      ...items.map((resource, index) => (index + 1) + ". " + phoneText(resource)),
    ].join("\n\n");
  }

  function buildAdminPackageText(items) {
    return [
      "行政申請清單：" + currentPackage().name,
      "",
      ...items.map((resource, index) => (index + 1) + ". " + adminText(resource)),
    ].join("\n\n");
  }

  function packagePurposeText(items) {
    const topic = getCurrentTopic();
    const tags = derivedIdentityTags();
    return [
      "本次資源包目的：" + currentPackage().name,
      state.district ? "行政區：" + state.district : "",
      topic ? "主題：" + topic.title : "",
      tags.length ? "線索：" + tags.join("、") : "",
      state.smartQueryText ? "補充描述：" + state.smartQueryText : "",
      "已選資源：" + items.length + " 筆",
    ].filter(Boolean).join("｜");
  }

  function buildHandoffPackageText(items) {
    return [
      "交接摘要：" + currentPackage().name,
      packagePurposeText(items),
      currentPackage().note ? "備註：" + currentPackage().note : "",
      "",
      ...items.map((resource, index) => (index + 1) + ". " + handoffText(resource)),
    ].filter(Boolean).join("\n\n");
  }

  function buildPackageOutput(items, mode) {
    if (!items.length) return "";
    if (mode === "phone") return buildPhonePackageText(items);
    if (mode === "admin") return buildAdminPackageText(items);
    if (mode === "handoff") return buildHandoffPackageText(items);
    const skipped = items.some((resource) => !isFamilyVisible(resource))
      ? "\n\n（已排除不可公開或過期資源）"
      : "";
    return buildFamilyPackageText(items) + skipped;
  }

  function fallbackReason() {
    if (state.sessionFailureReason) return state.sessionFailureReason;
    if (!state.sessionToken) return "no_session";
    if (!state.apiBase) return "no_api_base";
    return "api_failed";
  }

  function openLocalResult(reason) {
    syncPackageFromState();
    const item = currentPackage();
    writePackages();
    const params = new URLSearchParams({
      package_id: item.id,
      mode: "local",
      reason: reason || "session_expired",
    });
    window.location.href = "./resource-package-result.html?" + params.toString();
  }

  async function openOrCreatePackageResult(item, button) {
    if (item.shareUrl && item.status === "result_ready") {
      window.open(item.shareUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.status === "result_pending" && !item.shareUrl) {
      $("packageStatus").textContent = "結果產生中，稍後可再按查看結果。";
      return;
    }
    if (!item.resourceIds || !item.resourceIds.length) {
      $("packageStatus").textContent = "請先加入至少一筆資源，再查看結果。";
      return;
    }
    applyPackageContext(item);
    renderPackage();
    await submitResourcePackage(button);
  }

  async function submitResourcePackage(sourceButton) {
    const item = currentPackage();
    if (state.draftSaveTimer) {
      window.clearTimeout(state.draftSaveTimer);
      state.draftSaveTimer = null;
    }
    const payload = {
      packageId: item.id,
      name: item.name || defaultPackageName(),
      note: item.note || "",
      category: state.category,
      selectedTopicKeys: Array.from(state.selectedTopics),
      district: state.district,
      urgency: state.urgency,
      smartQueryText: state.smartQueryText,
      resourceIds: Array.from(state.packageIds),
      outputMode: item.outputMode || "family",
      guildId: state.guildId,
      resultChannelId: state.resultChannelId,
      status: "result_pending",
    };
    const button = sourceButton || null;
    const oldText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "正在產生...";
    }
    if (!state.sessionValid) {
      $("packageStatus").textContent = "session 無效或 API 未連上，正在產生本機預覽結果。此結果不會進 Discord 私密 QR。";
      openLocalResult(fallbackReason());
      return;
    }
    $("packageStatus").textContent = "正在發布正式資源包結果，完成後會跳到 Web B 結果頁並保存到 Discord 私密 QR。";
    try {
      const data = await apiFetch("/api/v1/resource/packages", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (data.package) {
        const saved = normalizeServerPackage(data.package);
        item.status = saved.status;
        item.shareUrl = saved.shareUrl;
        item.sharePageId = saved.sharePageId;
        item.updatedAt = saved.updatedAt;
        renderWorkbench();
      }
      if (data.share_url) {
        window.location.href = data.share_url;
        return;
      }
      if (data.share_status === "pending") {
        $("packageStatus").textContent = "主結果已建立，正式 QR / 分享頁正在背景產生；先開啟本機 Web B 預覽。";
        openLocalResult("publish_pending");
        return;
      }
      $("packageStatus").textContent = "資源包已儲存，但沒有取得結果連結。";
    } catch (error) {
      console.error(error);
      $("packageStatus").textContent = "正式發布失敗，改產生本機預覽結果。此結果不會進 Discord 私密 QR。";
      openLocalResult(error.message || "api_failed");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function updateCurrentDraft() {
    syncPackageFromState();
    if (state.draftSaveTimer) {
      window.clearTimeout(state.draftSaveTimer);
      state.draftSaveTimer = null;
    }
    const button = $("saveDraftButton");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "儲存中...";
    try {
      writePackages();
      if (state.sessionValid && state.packageIds.size) {
        const saved = await saveDraftNow();
        if (!saved) throw new Error("draft_save_failed");
        $("packageStatus").textContent = "已更新儲存。草稿會保存到我的資源組合。";
      } else if (!state.packageIds.size) {
        $("packageStatus").textContent = "已更新本機暫存。尚未加入資源。";
      } else {
        $("packageStatus").textContent = "已更新本機暫存。未連結 Discord，不能保存到個人工作台。";
      }
      renderWorkbench();
    } catch (error) {
      console.info("manual draft save failed", error);
      $("packageStatus").textContent = "更新儲存失敗，可先繼續使用本機暫存。";
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function renderPackage() {
    renderPackageManager();
    const items = selectedPackageResources();
    const item = currentPackage();
    const countText = items.length + " 筆";
    $("packageNameInput").value = item.name || defaultPackageName();
    $("packageCount").textContent = countText;
    const saveHint = state.sessionValid
      ? (state.packageSaveState === "saving" ? "草稿保存中。" : state.packageSaveState === "failed" ? "草稿保存失敗，可繼續使用本機暫存。" : "草稿會保存到我的資源組合。")
      : "未連結 Discord，僅能本機暫存。";
    $("packageStatus").textContent = items.length
      ? "已加入 " + items.length + " 筆資源，可到下方資源組合卡片展開查看。 " + saveHint
      : "尚未加入資源。 " + saveHint;

    renderDerivedIdentityChips();
    updateGoogleButton();
  }

  function buildGooglePrompt() {
    const topic = getCurrentTopic();
    const selectedLabels = optionLabels(topic);
    const parts = [
      "新北市",
      state.district,
      topic ? topic.title : "",
      ...selectedLabels,
      ...derivedIdentityTags(),
      state.urgency,
      state.smartQueryText,
      "長照 資源 社會局 申請",
    ].filter(Boolean);
    return Array.from(new Set(parts)).join(" ");
  }

  function buildGoogleSearchUrl() {
    return "https://www.google.com/search?q=" + encodeURIComponent(buildGooglePrompt());
  }

  function updateGoogleButton() {
    const button = $("googleSearchButton");
    const url = buildGoogleSearchUrl();
    button.dataset.searchUrl = url;
    button.title = buildGooglePrompt();
  }

  function render() {
    const topic = getCurrentTopic();
    $("districtSelect").value = state.district;
    $("urgencySelect").value = state.urgency;
    $("smartQueryInput").value = state.smartQueryText;
    renderCategorySelect();
    renderTopicChips(topic);
    renderCards();
  }

  async function init() {
    parseParams();
    setupFilters();
    try {
      const [topicsData, resourceData] = await Promise.all([
        loadJson(versionedAsset("./resource-nav-topics.json"), versionedAsset("../../../data/resource_nav/topics.json")),
        loadJson(versionedAsset("./resource-nav-resources.json"), versionedAsset("../../../data/resource_nav/resources.json")),
      ]);
      state.topics = topicsData.topics || [];
      state.resources = resourceData.resources || [];
      await verifySession();
      normalizeCategory();
      normalizeSelectedTopics();
      state.packages = state.sessionValid ? await loadRemotePackages() : readPackages();
      if (state.hasUrlContext) {
        createPackage(defaultPackageName(), { save: false });
      } else if (state.packages.length) {
        applyPackageContext(state.packages[0]);
      } else {
        createPackage(defaultPackageName());
      }
      render();
      renderWorkbench();
    } catch (error) {
      $("scopeMeta").textContent = "資料載入失敗，請稍後再試。";
      $("cards").innerHTML = '<div class="empty">無法載入資源資料。</div>';
      console.error(error);
    }
  }

  init();
})();
