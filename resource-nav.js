(function () {
  const STORAGE_KEY = "resource_nav_packages_v1";
  const CARD_SIZE_KEY = "resource_nav_card_size_v1";
  const LAST_SESSION_ENTRY_KEY = "resource_nav_last_session_entry_v1";
  const PENDING_SESSION_ENTRY_KEY = "resource_nav_pending_session_entry_v1";
  const LAST_IDENTITY_KEY = "resource_nav_last_identity_v1";
  const MAX_PACKAGES = 10;
  const RESOURCE_DATA_VERSION = "20260531-print-output";
  const DRAFT_SAVE_DELAY_MS = 700;
  const AREA_CITY = "新北市";
  const CITYWIDE_AREA_VALUES = new Set(["新北市", "全新北", "全台"]);
  const VALID_COVERAGE_SCOPES = new Set(["citywide", "district", "cross_district", "unknown"]);
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
    smartSearchResults: null,
    smartSearchNotice: "",
    smartSearchMode: "",
    smartSearchDegraded: false,
    smartSearchSearchQuery: "",
    packageIds: new Set(),
    hasUrlContext: false,
    sessionToken: "",
    apiBase: "",
    source: "direct",
    hasSessionParam: false,
    hasApiBaseParam: false,
    apiBaseSource: "missing",
    runtimeConfigChecked: false,
    sessionVerifyBusy: false,
    sessionUser: null,
    sessionValid: false,
    sessionFailureReason: "",
    packageDataSource: "local_cache",
    packageLoadError: "",
    guildId: "",
    resultChannelId: "",
    activeView: "nav",
    cardSize: localStorage.getItem(CARD_SIZE_KEY) || "medium",
    expandedPackageIds: new Set(),
    expandedQrPackageIds: new Set(),
    qrDataUrls: new Map(),
    debugMode: false,
    draftSaveTimer: null,
    packageSaveState: "idle",
  };

  const HELP_CONTENT = {
    smart: {
      title: "智慧查詢怎麼用",
      body: `
        <p>智慧搜尋會交給後端依行政區規則建立搜尋池，再用語意/文字比對排序，不只是目前畫面排序。</p>
        <ul>
          <li>一般瀏覽：選新北市只看新北市級資源；選永和區只看永和區加新北市級資源。</li>
          <li>智慧搜尋：選新北市時，會搜尋新北市級 + 下轄行政區資源；選單一行政區時，只搜尋該區 + 新北市級。</li>
          <li>不會做：不會判定資格、不承諾補助、不把其他區資料塞進一般瀏覽。</li>
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
    state.debugMode = params.get("debug") === "1";
    state.hasSessionParam = Boolean(state.sessionToken);
    state.hasApiBaseParam = Boolean(state.apiBase);
    state.apiBaseSource = state.apiBase ? "url" : "missing";
    state.district = normalizeArea(params.get("district") || "");
    state.hasUrlContext = Boolean(state.category || topicParam);
    rememberSessionEntryUrl({ verified: false });
    renderIdentity("checking", source === "discord" ? "Discord 入口，等待身份確認" : "未連結 Discord，請回 Discord 重新開啟入口");
  }

  function apiUrl(path) {
    if (!state.apiBase) return "";
    return state.apiBase + path;
  }

  function buildSessionEntryUrl(apiBase) {
    if (!state.sessionToken || !apiBase) return "";
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
    params.set("api_base", apiBase);
    return "./resource-nav.html?" + params.toString();
  }

  function rememberSessionEntryUrl(options) {
    const verified = Boolean(options && options.verified);
    const entryUrl = buildSessionEntryUrl(state.apiBase);
    if (!entryUrl) return;
    try {
      sessionStorage.setItem(PENDING_SESSION_ENTRY_KEY, entryUrl);
      localStorage.setItem(PENDING_SESSION_ENTRY_KEY, entryUrl);
      if (verified) {
        sessionStorage.setItem(LAST_SESSION_ENTRY_KEY, entryUrl);
        localStorage.setItem(LAST_SESSION_ENTRY_KEY, entryUrl);
      }
    } catch (error) {
      console.info("remember resource nav entry failed", error);
    }
  }

  function readStoredEntryUrl(key) {
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
    } catch (error) {
      console.info("stored resource nav entry unreadable", key, error);
      return "";
    }
  }

  function rememberIdentity(user) {
    if (!user || !user.id) return;
    const payload = {
      id: String(user.id || ""),
      name: String(user.name || "Discord 使用者"),
      savedAt: nowIso(),
    };
    try {
      localStorage.setItem(LAST_IDENTITY_KEY, JSON.stringify(payload));
      sessionStorage.setItem(LAST_IDENTITY_KEY, JSON.stringify(payload));
    } catch (error) {
      console.info("remember resource nav identity failed", error);
    }
  }

  function readRememberedIdentity() {
    try {
      const raw = sessionStorage.getItem(LAST_IDENTITY_KEY) || localStorage.getItem(LAST_IDENTITY_KEY) || "";
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.id) return null;
      return {
        id: String(data.id || ""),
        name: String(data.name || "Discord 使用者"),
        savedAt: String(data.savedAt || ""),
      };
    } catch (error) {
      console.info("stored resource nav identity unreadable", error);
      return null;
    }
  }

  function apiBaseFromEntryUrl(entryUrl) {
    try {
      if (!entryUrl || !entryUrl.includes("resource-nav.html")) return "";
      const url = new URL(entryUrl, window.location.href);
      return String(url.searchParams.get("api_base") || "").replace(/\/$/, "");
    } catch (error) {
      console.info("stored resource nav entry invalid", error);
      return "";
    }
  }

  function applyStoredApiBase() {
    const candidates = [
      readStoredEntryUrl(LAST_SESSION_ENTRY_KEY),
      readStoredEntryUrl(PENDING_SESSION_ENTRY_KEY),
    ];
    for (const entryUrl of candidates) {
      const apiBase = apiBaseFromEntryUrl(entryUrl);
      if (apiBase && apiBase !== state.apiBase) {
        state.apiBase = apiBase;
        state.apiBaseSource = "stored";
        state.sessionFailureReason = "stored_api_base";
        renderSessionDebug();
        return true;
      }
    }
    return false;
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
      if ([502, 503, 504].includes(response.status) || data.error === "upstream_unreachable") {
        throw new Error("api_unreachable");
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

  function rememberedIdentityText() {
    const identity = readRememberedIdentity();
    if (!identity) return "";
    return identity.name + (identity.id ? " / " + identity.id : "");
  }

  function updateRetrySessionButton() {
    const button = $("retrySessionVerify");
    if (!button) return;
    const shouldShow = Boolean(state.sessionToken && !state.sessionValid && state.sessionFailureReason);
    button.hidden = !shouldShow;
    button.disabled = state.sessionVerifyBusy;
    button.textContent = state.sessionVerifyBusy ? "驗證中..." : "重新驗證";
  }

  function renderIdentity(status, reason) {
    const pill = $("sourceStatus");
    updateRetrySessionButton();
    if (!pill) return;
    pill.classList.remove("is-linked", "is-offline", "is-error");
    if (status === "linked") {
      pill.classList.add("is-linked");
      pill.textContent = "已連結 Discord：" + identityText();
      updateRetrySessionButton();
      return;
    }
    if (status === "offline") {
      pill.classList.add("is-offline");
      const cached = rememberedIdentityText();
      pill.textContent = cached
        ? "曾連結 Discord：" + cached + "；目前未完成後端驗證"
        : "未連結 Discord，請回 Discord 重新開啟入口";
      updateRetrySessionButton();
      return;
    }
    if (status === "error") {
      pill.classList.add("is-error");
      const cached = rememberedIdentityText();
      if (cached) {
        pill.textContent = "曾連結 Discord：" + cached + "；" + (reason || "目前 API/Session 無法驗證");
        updateRetrySessionButton();
        return;
      }
    }
    pill.textContent = reason || "Discord 身份未確認";
    updateRetrySessionButton();
  }

  function sessionReasonLabel(reason) {
    const labels = {
      verified: "已完成 Discord 身份驗證。",
      no_session: "網址沒有 session；請從 Discord 資源導航入口重新開啟。",
      no_api_base: "網址沒有 api_base；Bot 可能尚未帶入 API 網址，或 RESOURCE_NAV_API_BASE / WEB_B_SUBMIT_URL 尚未設定。",
      runtime_api_base: "網址內的 API 無法使用，已改用網站 runtime config 內的 API base 重試。",
      stored_api_base: "網站 runtime config 無法取得時，已改用此瀏覽器上次保存的 API base 重試。",
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
    const debugPanel = $("sessionDebug");
    if (debugPanel) {
      debugPanel.hidden = state.sessionValid && !state.debugMode;
    }
    const sessionStatus = $("sessionTokenStatus");
    const apiBaseStatus = $("apiBaseStatus");
    const verifyStatus = $("sessionVerifyStatus");
    const reasonStatus = $("sessionReasonStatus");
    if (!sessionStatus || !apiBaseStatus || !verifyStatus || !reasonStatus) return;
    sessionStatus.textContent = state.hasSessionParam ? "有 session 參數" : "缺少 session 參數";
    if (state.apiBaseSource === "runtime") {
      apiBaseStatus.textContent = "由 runtime config 補上";
    } else if (state.apiBaseSource === "stored") {
      apiBaseStatus.textContent = "由瀏覽器保存入口補上";
    } else {
      apiBaseStatus.textContent = state.hasApiBaseParam ? "有 api_base 參數" : "缺少 api_base 參數";
    }
    verifyStatus.textContent = state.sessionValid ? "已驗證 Discord 身份" : "未完成後端驗證";
    reasonStatus.textContent = state.sessionValid
      ? sessionReasonLabel("verified")
      : sessionReasonLabel(state.sessionFailureReason || "missing_session");
    updateRetrySessionButton();
  }

  async function applyRuntimeApiBase(options) {
    const force = Boolean(options && options.force);
    if (force) state.runtimeConfigChecked = false;
    if (state.runtimeConfigChecked) return applyStoredApiBase();
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
      if (!nextApiBase) return applyStoredApiBase();
      state.apiBase = nextApiBase;
      state.apiBaseSource = "runtime";
      state.sessionFailureReason = "runtime_api_base";
      renderSessionDebug();
      rememberSessionEntryUrl({ verified: false });
      return true;
    } catch (error) {
      console.info("resource runtime config unavailable", error);
      return applyStoredApiBase();
    }
  }

  async function verifySession() {
    const loginStatus = $("loginStatus");
    if (!state.sessionToken) {
      state.sessionValid = false;
      state.sessionFailureReason = "no_session";
      loginStatus.textContent = state.source === "discord"
        ? "已從 Discord 入口開啟，但網址沒有 session。可先看本機快取與本機預覽；若要保存到後端，請回 Discord 重新點入口。"
        : "未取得 Discord session：可瀏覽與點選資源，也可先產生本機預覽結果；若要保存到後端，請回 Discord 重新點入口。";
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
      loginStatus.textContent = "已取得 session，但網址沒有 api_base，網站不知道要向哪個 Bot API 驗證身份。可先看本機快取與本機預覽；若要保存到後端，請確認 Bot 入口已更新後重新開啟。";
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
      rememberSessionEntryUrl({ verified: true });
      rememberIdentity(state.sessionUser);
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
      loginStatus.textContent = "已從 Discord 入口開啟，但後端驗證未通過：" + sessionReasonLabel(state.sessionFailureReason) + " 可先看本機快取與本機預覽；若要保存到後端，請回 Discord 重新點入口。";
      renderSessionDebug();
      console.info("resource session verification failed", error);
    }
  }

  async function retrySessionVerification() {
    if (state.sessionVerifyBusy) return;
    state.sessionVerifyBusy = true;
    state.runtimeConfigChecked = false;
    state.sessionFailureReason = "";
    renderIdentity("checking", "正在重新驗證 Discord 身份");
    try {
      await verifySession();
      if (state.sessionValid) {
        state.packages = await loadRemotePackages();
        if (state.packages.length && !state.activePackageId) {
          applyPackageContext(state.packages[0]);
        }
        render();
        renderWorkbench();
        renderExchange();
      }
    } finally {
      state.sessionVerifyBusy = false;
      updateRetrySessionButton();
      renderSessionDebug();
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


  function normalizeArea(value) {
    const text = String(value || "").trim();
    return text === "全新北" ? AREA_CITY : text;
  }

  function clearSmartSearchResults() {
    state.smartSearchResults = null;
    state.smartSearchNotice = "";
    state.smartSearchMode = "";
    state.smartSearchDegraded = false;
    state.smartSearchSearchQuery = "";
  }

  function resourceDistricts(resource) {
    return asList(resource.districts).map(normalizeArea).filter(Boolean);
  }

  function coverageScope(resource) {
    const raw = String(resource.coverage_scope || "").trim();
    if (VALID_COVERAGE_SCOPES.has(raw)) return raw;
    const districts = resourceDistricts(resource);
    if (!districts.length) return "unknown";
    if (districts.some((item) => CITYWIDE_AREA_VALUES.has(item))) return "citywide";
    return districts.length === 1 ? "district" : "cross_district";
  }

  function isCitywideResource(resource) {
    return coverageScope(resource) === "citywide" || resourceDistricts(resource).some((item) => CITYWIDE_AREA_VALUES.has(item));
  }

  function resourceCoversArea(resource, area) {
    const normalized = normalizeArea(area);
    if (!normalized) return true;
    if (isCitywideResource(resource)) return true;
    return resourceDistricts(resource).includes(normalized);
  }

  function browseAreaRank(resource) {
    const area = normalizeArea(state.district);
    if (!area) return 30;
    if (area === AREA_CITY) return isCitywideResource(resource) ? 10 : Infinity;
    if (!resourceCoversArea(resource, area)) return Infinity;
    return isCitywideResource(resource) ? 20 : 10;
  }

  function smartAreaRank(resource) {
    const area = normalizeArea(state.district);
    const scope = coverageScope(resource);
    if (!area) return 30;
    if (area === AREA_CITY) {
      if (isCitywideResource(resource)) return 10;
      return ["district", "cross_district"].includes(scope) ? 20 : Infinity;
    }
    if (resourceCoversArea(resource, area) && !isCitywideResource(resource)) return 10;
    return isCitywideResource(resource) ? 20 : Infinity;
  }

  function coverageScopeLabel(resource) {
    const scope = coverageScope(resource);
    const districts = resourceDistricts(resource).filter((item) => !CITYWIDE_AREA_VALUES.has(item));
    if (isCitywideResource(resource)) return "新北市級";
    if (scope === "district" && districts[0]) return districts[0];
    if (scope === "cross_district" && districts.length) return "跨區";
    return "範圍待確認";
  }

  function smartGroupLabel(resource) {
    const scope = coverageScope(resource);
    const districts = resourceDistricts(resource).filter((item) => !CITYWIDE_AREA_VALUES.has(item));
    if (isCitywideResource(resource)) return "新北市級";
    if (scope === "district" && districts[0]) return districts[0];
    if (scope === "cross_district" && districts.length) return "跨區：" + districts.join("、");
    return "範圍待確認";
  }

  function smartResultFor(resource) {
    if (!state.smartSearchResults) return null;
    return state.smartSearchResults.get(resource.id) || state.smartSearchResults.get(resource.resource_id) || null;
  }

  function smartEngineLabel() {
    if (!state.smartQueryAppliedText) return "";
    if (state.smartSearchMode === "resource_vector_bge") {
      return state.smartSearchDegraded ? "語意搜尋（GLM 降級）" : "語意搜尋";
    }
    if (state.smartSearchMode === "resource_keyword_fallback") return "關鍵字備援";
    if (state.smartSearchMode === "local_fallback") return "本頁排序備援";
    return "智慧搜尋";
  }

  function scopeDescription() {
    const area = normalizeArea(state.district);
    if (state.smartQueryAppliedText) {
      const label = smartEngineLabel();
      const query = state.smartSearchSearchQuery ? "｜搜尋詞：" + state.smartSearchSearchQuery : "";
      if (state.smartSearchNotice) return (label ? label + "｜" : "") + state.smartSearchNotice + query;
      if (area === AREA_CITY) return (label ? label + "｜" : "") + "智慧搜尋範圍：新北市級 + 新北市下轄行政區資源。" + query;
      if (area) return (label ? label + "｜" : "") + "智慧搜尋範圍：" + area + " + 新北市級資源。" + query;
      return (label ? label + "｜" : "") + "智慧搜尋範圍：全部資源。" + query;
    }
    if (area === AREA_CITY) return "一般瀏覽：只顯示新北市級資源。";
    if (area) return "一般瀏覽：優先顯示 " + area + "，並附新北市級通用資源。";
    return "一般瀏覽：不限行政區，顯示全部資料。";
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

  function sourceDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return "外部網站";
    }
  }

  function confirmOpenSource(resource, url) {
    if (state.cardSize !== "small") return true;
    return window.confirm(
      "即將開啟來源網站：\n\n" +
      (resource.name || "未命名資源") +
      "\n" +
      sourceDomain(url) +
      "\n\n小卡片模式容易誤觸，確定要離開目前頁面嗎？"
    );
  }

  async function copyPackageLink(item, button) {
    if (!item.shareUrl) return;
    const oldText = button.textContent;
    try {
      await copyText(item.shareUrl);
      button.textContent = "已複製";
      button.classList.add("is-done");
      window.setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove("is-done");
      }, 1200);
    } catch (error) {
      button.textContent = "複製失敗";
      window.setTimeout(() => { button.textContent = oldText; }, 1200);
    }
  }

  function apiHeaders(extra) {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + state.sessionToken,
      ...(extra || {}),
    };
  }

  function downloadTextFile(filename, mimeType, text) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function safeFilename(text, suffix) {
    const base = String(text || "resource-pack")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80)
      .replace(/^-|-$/g, "") || "resource-pack";
    return base + "." + suffix;
  }

  async function exportPackage(item, format, button) {
    if (!state.sessionValid) {
      window.alert("請從 Discord 重新開啟入口後再匯出封包。");
      return;
    }
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "匯出中...";
    try {
      const response = await fetch(
        apiUrl("/api/v1/resource/packages/" + encodeURIComponent(item.id) + "/export?format=" + encodeURIComponent(format)),
        { method: "GET", headers: apiHeaders({}) }
      );
      const text = await response.text();
      if (!response.ok) throw new Error(text || "export_failed");
      const isMarkdown = format === "markdown" || format === "md";
      downloadTextFile(
        safeFilename(item.name, isMarkdown ? "resourcepack.md" : "resourcepack.json"),
        isMarkdown ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
        text
      );
      button.textContent = "已匯出";
      button.classList.add("is-done");
      window.setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove("is-done");
      }, 1200);
    } catch (error) {
      console.info("resource package export failed", error);
      button.textContent = "匯出失敗";
      window.setTimeout(() => { button.textContent = oldText; }, 1400);
    } finally {
      button.disabled = false;
    }
  }

  async function importResourcePackPayload(payload, button) {
    if (!state.sessionValid) {
      $("importResourcePackStatus").textContent = "請從 Discord 重新開啟入口後再匯入到個人工作台。";
      return;
    }
    const oldText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "匯入中...";
    }
    try {
      const response = await fetch(apiUrl("/api/v1/resource/packages/import"), {
        method: "POST",
        headers: apiHeaders({}),
        body: JSON.stringify(payload),
      });
      let data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.error === "personal_data_warning") {
        const ok = window.confirm(
          "封包名稱或備註疑似含個資：\n\n" +
          (Array.isArray(data.warnings) ? data.warnings.join("、") : "未列明") +
          "\n\n請先確認不含姓名、電話、身分證、完整地址。仍要匯入成自己的草稿嗎？"
        );
        if (!ok) {
          $("importResourcePackStatus").textContent = "已取消匯入，請先清理封包內容。";
          return;
        }
        const retry = await fetch(apiUrl("/api/v1/resource/packages/import"), {
          method: "POST",
          headers: apiHeaders({}),
          body: JSON.stringify({ ...payload, allowPersonalData: true }),
        });
        data = await retry.json().catch(() => ({}));
        if (!retry.ok || data.ok === false) throw new Error(data.error || "import_failed");
      } else if (!response.ok || data.ok === false) {
        throw new Error(data.error || "import_failed");
      }
      const imported = normalizeServerPackage(data.package || {});
      state.packages = [imported, ...state.packages.filter((item) => item.id !== imported.id)];
      applyPackageContext(imported);
      render();
      renderPackage();
      renderWorkbench();
      renderExchange();
      $("importResourcePackStatus").textContent = "已匯入成新的草稿：" + imported.name;
      switchView("workbench");
    } catch (error) {
      $("importResourcePackStatus").textContent = "匯入失敗：" + (error.message || "格式不支援或封包不完整");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  function detectImportFormat(text, filename) {
    const lowerName = String(filename || "").toLowerCase();
    const trimmed = String(text || "").trim();
    if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || trimmed.includes("RESOURCE_PACK_MANIFEST")) {
      return "markdown";
    }
    return "json";
  }

  async function importResourcePackFromInputs(button) {
    const fileInput = $("resourcePackFileInput");
    const pasteInput = $("resourcePackPasteInput");
    const urlInput = $("resourcePackUrlInput");
    const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    const url = urlInput ? urlInput.value.trim() : "";
    if (file) {
      const text = await file.text();
      await importResourcePackPayload({ format: detectImportFormat(text, file.name), content: text }, button);
      return;
    }
    const pasted = pasteInput ? pasteInput.value.trim() : "";
    if (pasted) {
      await importResourcePackPayload({ format: detectImportFormat(pasted, ""), content: pasted }, button);
      return;
    }
    if (url) {
      await importResourcePackPayload({ format: "url", url }, button);
      return;
    }
    $("importResourcePackStatus").textContent = "請先選擇檔案、貼上封包內容，或貼上 Web B 結果連結。";
  }

  async function ensurePackageQr(item, button) {
    if (!item.id || !item.shareUrl || state.qrDataUrls.has(item.id)) return;
    if (!state.sessionValid) throw new Error("auth_required");
    const oldText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "產生中...";
    }
    try {
      const data = await apiFetch("/api/v1/resource/packages/" + encodeURIComponent(item.id) + "/qr", {
        method: "GET",
        headers: {},
      });
      const raw = data.qr_png_base64 || "";
      if (!raw) throw new Error(data.error || "qr_unavailable");
      state.qrDataUrls.set(item.id, "data:image/png;base64," + raw);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function togglePackageQr(item, button) {
    if (!item.shareUrl || item.status !== "result_ready") return;
    if (state.expandedQrPackageIds.has(item.id)) {
      state.expandedQrPackageIds.delete(item.id);
      renderWorkbench();
      return;
    }
    try {
      await ensurePackageQr(item, button);
      state.expandedQrPackageIds.add(item.id);
    } catch (error) {
      state.qrDataUrls.set(item.id, "");
      state.expandedQrPackageIds.add(item.id);
    }
    renderWorkbench();
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
          items: Array.isArray(item.items) ? item.items : [],
          outputs: Array.isArray(item.outputs) ? item.outputs : [],
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
      items: [],
      outputs: [],
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
    const allowedViews = new Set(["nav", "workbench", "exchange"]);
    state.activeView = allowedViews.has(view) ? view : "nav";
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const isActive = panel.id === state.activeView + "View";
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });
    document.querySelectorAll(".view-tab").forEach((button) => {
      const isActive = button.dataset.view === state.activeView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (document.activeElement && document.activeElement.classList.contains("view-tab")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (state.activeView === "workbench") {
      renderPackage();
      if (state.sessionValid) loadRemotePackages();
      renderWorkbench();
    } else if (state.activeView === "exchange") {
      if (state.sessionValid) loadRemotePackages();
      renderExchange();
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
    const packages = state.packages.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    let emptyText = "目前還沒有資源組合。回到資源導航，點選卡片後會先建立草稿。";
    if (!state.sessionValid) {
      const cached = rememberedIdentityText();
      status.textContent = packages.length
        ? "目前顯示本機快取" + (cached ? "（曾連結 " + cached + "）" : "") + "；API/session 未驗證，不能寫入後端。"
        : "未連結 Discord，請回 Discord 重新開啟入口。";
      emptyText = "目前是未登入瀏覽，只能使用本機暫存，不能讀取個人資源組合。";
    } else if (state.packageDataSource === "local_cache") {
      status.textContent = "目前查看 " + identityText() + " 的本機快取；後端同步暫時失敗：" + sessionReasonLabel(state.packageLoadError || "api_unavailable");
    } else {
      status.textContent = "目前查看 " + identityText() + " 的資源組合，已由後端同步。";
    }
    empty.hidden = packages.length > 0;
    empty.textContent = emptyText;
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
      const duplicateButton = document.createElement("button");
      duplicateButton.type = "button";
      duplicateButton.className = "copy-action";
      duplicateButton.textContent = "複製此副本";
      duplicateButton.title = "複製這包資源成新的草稿，不改原本紀錄。";
      duplicateButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const duplicate = {
          ...item,
          id: newId("pkg"),
          name: (item.name || "資源組合") + " 副本",
          status: "draft",
          shareUrl: "",
          sharePageId: "",
          outputs: [],
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
      remove.disabled = !state.sessionValid;
      remove.title = state.sessionValid ? "" : "重新連結 Discord 後才能刪除後端資源組合。";
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!state.sessionValid) return;
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
      actions.append(edit, view, duplicateButton, remove);
      if (item.status === "result_ready" && item.shareUrl) {
        const copyLink = document.createElement("button");
        copyLink.type = "button";
        copyLink.className = "link-action";
        copyLink.textContent = "複製連結";
        copyLink.addEventListener("click", async (event) => {
          event.stopPropagation();
          await copyPackageLink(item, copyLink);
        });
        const qrButton = document.createElement("button");
        qrButton.type = "button";
        qrButton.className = "qr-action";
        qrButton.textContent = state.expandedQrPackageIds.has(item.id) ? "收合 QR CODE" : "查看 QR CODE";
        qrButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          await togglePackageQr(item, qrButton);
        });
        const printButton = document.createElement("button");
        printButton.type = "button";
        printButton.className = "print-action";
        printButton.textContent = "列印 / 另存 PDF";
        printButton.title = "開啟 Web B 結果頁並叫出列印視窗，可在瀏覽器選擇另存 PDF。";
        printButton.addEventListener("click", (event) => {
          event.stopPropagation();
          openResultUrl(item.shareUrl, true);
        });
        actions.append(copyLink, qrButton, printButton);
      }

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

      const qrPanel = document.createElement("div");
      qrPanel.className = "workbench-qr-panel";
      qrPanel.hidden = !state.expandedQrPackageIds.has(item.id);
      if (!qrPanel.hidden) {
        const qrTitle = document.createElement("h4");
        qrTitle.textContent = "QR CODE 與結果連結";
        const dataUrl = state.qrDataUrls.get(item.id) || "";
        if (dataUrl) {
          const img = document.createElement("img");
          img.src = dataUrl;
          img.alt = item.name + " QR Code";
          const link = document.createElement("a");
          link.href = item.shareUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = item.shareUrl;
          qrPanel.append(qrTitle, img, link);
        } else {
          const errorText = document.createElement("p");
          errorText.className = "workbench-expanded-empty";
          errorText.textContent = "QR 暫時無法產生，可先使用複製連結。";
          qrPanel.append(qrTitle, errorText);
        }
      }

      card.append(head, meta, actions, expanded, qrPanel);
      list.appendChild(card);
    });
  }

  function renderExchange() {
    const status = $("exchangeStatus");
    const list = $("exchangeExportList");
    const empty = $("exchangeEmpty");
    if (!status || !list || !empty) return;
    list.innerHTML = "";
    if (!state.sessionValid) {
      status.textContent = "未連結 Discord，請回 Discord 重新開啟入口後再匯入或匯出資源副本。";
      empty.hidden = false;
      empty.textContent = "目前是未登入瀏覽，不能讀取個人資源組合，也不能匯入到個人工作台。";
      return;
    }
    status.textContent = "目前可匯入到 " + identityText() + "，也可匯出自己的資源組合。";
    const packages = state.packages.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    empty.hidden = packages.length > 0;
    empty.textContent = "目前沒有可匯出的資源組合。";
    packages.forEach((item) => {
      const card = document.createElement("article");
      card.className = "exchange-card";
      const head = document.createElement("div");
      head.className = "exchange-card-head";
      const titleWrap = document.createElement("div");
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = statusLabel(item.status) + "｜" + (item.district || "未指定地區");
      const title = document.createElement("h3");
      title.textContent = item.name || "臨時資源包";
      titleWrap.append(eyebrow, title);
      const count = document.createElement("span");
      count.className = "package-count";
      count.textContent = (item.resourceIds || []).length + " 筆";
      head.append(titleWrap, count);

      const meta = document.createElement("p");
      meta.className = "muted-text";
      meta.textContent = [
        packageTopicText(item),
        "更新 " + formatDateTime(item.updatedAt),
      ].join("｜");

      const actions = document.createElement("div");
      actions.className = "exchange-actions";
      const exportJson = document.createElement("button");
      exportJson.type = "button";
      exportJson.className = "export-action";
      exportJson.textContent = "匯出封包 JSON";
      exportJson.title = "下載可再次匯入的 .resourcepack.json。";
      exportJson.addEventListener("click", async () => {
        await exportPackage(item, "json", exportJson);
      });
      const exportMarkdown = document.createElement("button");
      exportMarkdown.type = "button";
      exportMarkdown.className = "export-action";
      exportMarkdown.textContent = "匯出 Markdown";
      exportMarkdown.title = "下載可閱讀的 Markdown，內含可還原封包區塊。";
      exportMarkdown.addEventListener("click", async () => {
        await exportPackage(item, "markdown", exportMarkdown);
      });
      const printButton = document.createElement("button");
      printButton.type = "button";
      printButton.className = "print-action";
      printButton.textContent = "列印 / 另存 PDF";
      printButton.title = item.shareUrl ? "開啟 Web B 結果頁並叫出列印視窗，可在瀏覽器選擇另存 PDF。" : "草稿會先產生 Web B 結果，再開啟列印頁。";
      printButton.addEventListener("click", async () => {
        await openOrCreatePackageResult(item, printButton, { print: true });
      });
      actions.append(exportJson, exportMarkdown, printButton);
      card.append(head, meta, actions);
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
      items: Array.isArray(record.items) ? record.items : [],
      outputs: Array.isArray(record.outputs) ? record.outputs : [],
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
      state.packageDataSource = "server";
      state.packageLoadError = "";
      writePackages();
      renderWorkbench();
      renderExchange();
      return packages;
    } catch (error) {
      console.info("resource packages load failed", error);
      state.packageDataSource = "local_cache";
      state.packageLoadError = error.message || "api_unavailable";
      const cached = readPackages();
      if (cached.length || !state.packages.length) state.packages = cached;
      renderWorkbench();
      renderExchange();
      return state.packages;
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
      state.packageDataSource = "server";
      state.packageLoadError = "";
      writePackages();
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
      clearSmartSearchResults();
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
        clearSmartSearchResults();
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
    $("exchangeTabButton").addEventListener("click", () => switchView("exchange"));
    const retryButton = $("retrySessionVerify");
    if (retryButton) {
      retryButton.addEventListener("click", retrySessionVerification);
    }
    $("refreshWorkbench").addEventListener("click", async () => {
      if (state.sessionValid) await loadRemotePackages();
      renderWorkbench();
      renderExchange();
    });
    $("packageNameInput").addEventListener("input", (event) => {
      const item = currentPackage();
      item.name = event.target.value.trim() || defaultPackageName();
      syncPackageFromState();
      renderWorkbench();
    });
    $("districtSelect").addEventListener("change", (event) => {
      state.district = normalizeArea(event.target.value);
      clearSmartSearchResults();
      syncPackageFromState();
      renderCards();
    });
    $("urgencySelect").addEventListener("change", (event) => {
      state.urgency = event.target.value;
      clearSmartSearchResults();
      syncPackageFromState();
      renderCards();
    });
    $("smartQueryInput").addEventListener("input", (event) => {
      state.smartQueryText = event.target.value.trim();
      clearSmartSearchResults();
      syncPackageFromState();
      updateGoogleButton();
    });
    $("applySmartQuery").addEventListener("click", applySmartSearch);
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
    $("importResourcePackButton").addEventListener("click", async () => {
      await importResourcePackFromInputs($("importResourcePackButton"));
    });
    $("clearImportResourcePackButton").addEventListener("click", () => {
      $("resourcePackFileInput").value = "";
      $("resourcePackUrlInput").value = "";
      $("resourcePackPasteInput").value = "";
      $("importResourcePackStatus").textContent = "匯入會歸到目前 Discord 使用者底下。";
    });
  }

  function matchesBaseResource(resource) {
    if (resource.category !== state.category) return false;
    if (resource.status === "停用" || resource.status === "過期") return false;
    if (state.selectedTopics.size > 0) {
      const resourceTopics = new Set(resource.topics || []);
      if (!Array.from(state.selectedTopics).some((key) => resourceTopics.has(key))) return false;
    }
    if (state.urgency) {
      const urgencyTags = resource.urgency_tags || [];
      if (!urgencyTags.includes(state.urgency)) return false;
    }
    return true;
  }

  function matchesResource(resource) {
    if (!matchesBaseResource(resource)) return false;
    const rank = state.smartQueryAppliedText ? smartAreaRank(resource) : browseAreaRank(resource);
    return Number.isFinite(rank);
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
      resource.coverage_scope,
      resource.service_area_note,
      ...asList(resource.districts),
      ...asList(resource.public_required_documents),
      ...resourceIdentityTags(resource),
      ...asList(resource.phone_check_questions),
      resource.internal_notes,
      resource.embedding_text,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function scoreResource(resource) {
    const backend = smartResultFor(resource);
    if (backend) return Number(backend.score || 0);
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
      scored.sort((a, b) => b.score - a.score || smartAreaRank(a.resource) - smartAreaRank(b.resource) || a.resource.name.localeCompare(b.resource.name, "zh-Hant"));
      return scored;
    }
    scored.sort((a, b) => browseAreaRank(a.resource) - browseAreaRank(b.resource) || a.resource.name.localeCompare(b.resource.name, "zh-Hant"));
    return scored;
  }

  async function requestSmartSearch() {
    if (!state.apiBase) throw new Error("no_api_base");
    let response;
    try {
      response = await fetch(apiUrl("/api/v1/resource/smart-search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_area: normalizeArea(state.district),
          category: state.category,
          topics: Array.from(state.selectedTopics),
          urgency: state.urgency,
          query: state.smartQueryAppliedText,
          limit: 100,
        }),
      });
    } catch (error) {
      throw new Error("api_unreachable");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "smart_search_failed");
    const map = new Map();
    (data.results || []).forEach((item) => {
      const id = String(item.resource_id || item.id || "");
      if (id) map.set(id, item);
    });
    state.smartSearchResults = map;
    state.smartSearchMode = data.engine || "backend";
    state.smartSearchDegraded = Boolean(data.query_degraded);
    state.smartSearchSearchQuery = data.search_query || state.smartQueryAppliedText;
    state.smartSearchNotice = (data.scope && (data.scope.description || data.scope.search_pool)) || "";
  }

  async function applySmartSearch() {
    const button = $("applySmartQuery");
    const originalText = button.textContent;
    state.smartQueryAppliedText = state.smartQueryText;
    clearSmartSearchResults();
    markSmartQueryApplied();
    syncPackageFromState();
    if (!state.smartQueryAppliedText) {
      renderCards();
      return;
    }
    button.disabled = true;
    button.textContent = "搜尋中...";
    try {
      await requestSmartSearch();
    } catch (error) {
      state.smartSearchMode = "local_fallback";
      state.smartSearchDegraded = true;
      state.smartSearchSearchQuery = state.smartQueryAppliedText;
      state.smartSearchNotice = "智慧搜尋 API 暫時不可用，已改用本頁資料做排序；正式語意搜尋需後端服務正常。";
      console.info("resource smart search fallback", error);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      renderCards();
    }
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
    const scopeMeta = $("scopeMeta");
    scopeMeta.textContent = [
      state.district ? "行政區：" + normalizeArea(state.district) : "行政區不限",
      selectedLabels.length ? "子主題：" + selectedLabels.join("、") : "尚未指定子主題",
      state.smartQueryAppliedText ? "智慧搜尋已套用：" + state.smartQueryAppliedText : "",
      "共 " + results.length + " 筆",
    ].filter(Boolean).join("｜");
    const scopeNote = document.createElement("span");
    scopeNote.className = "smart-scope-note";
    scopeNote.textContent = scopeDescription();
    scopeMeta.append("｜", scopeNote);

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
    let lastSmartGroup = "";
    scoredResults.forEach(({ resource, score }) => {
      if (state.smartQueryAppliedText) {
        const group = smartGroupLabel(resource);
        if (group !== lastSmartGroup) {
          lastSmartGroup = group;
          const heading = document.createElement("div");
          heading.className = "scope-group-heading";
          heading.textContent = group;
          cards.appendChild(heading);
        }
      }
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
        link.addEventListener("click", (event) => {
          if (!confirmOpenSource(resource, resource.source_url)) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
        title.appendChild(link);
      } else {
        title.textContent = resource.name;
      }
      const scopeBadge = node.querySelector(".scope-badge");
      scopeBadge.textContent = coverageScopeLabel(resource);
      scopeBadge.classList.add("scope-" + coverageScope(resource));
      node.querySelector(".confidence").textContent = resource.confidence || resource.status || "待確認";
      const smartHit = node.querySelector(".smart-hit");
      const smartResult = smartResultFor(resource);
      if (state.smartQueryAppliedText && (score > 0 || smartResult)) {
        smartHit.hidden = false;
        smartHit.textContent = smartResult && smartResult.match_reason ? smartResult.match_reason : "智慧查詢命中 " + score;
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

  function withPrintParam(url, shouldPrint) {
    if (!shouldPrint || !url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      parsed.searchParams.set("print", "1");
      return parsed.toString();
    } catch (error) {
      return url + (url.includes("?") ? "&" : "?") + "print=1";
    }
  }

  function openResultUrl(url, shouldPrint) {
    window.open(withPrintParam(url, shouldPrint), "_blank", "noopener,noreferrer");
  }

  function openLocalResult(reason, options = {}) {
    syncPackageFromState();
    const item = currentPackage();
    writePackages();
    const params = new URLSearchParams({
      package_id: item.id,
      mode: "local",
      reason: reason || "session_expired",
    });
    if (options.print) params.set("print", "1");
    window.location.href = "./resource-package-result.html?" + params.toString();
  }

  async function openOrCreatePackageResult(item, button, options = {}) {
    if (item.shareUrl && item.status === "result_ready") {
      openResultUrl(item.shareUrl, Boolean(options.print));
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
    await submitResourcePackage(button, options);
  }

  async function submitResourcePackage(sourceButton, options = {}) {
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
      $("packageStatus").textContent = "session 無效或 API 未連上，正在產生本機預覽結果。此結果不會寫入後端，也不會產生正式分享連結。";
      openLocalResult(fallbackReason(), options);
      return;
    }
    $("packageStatus").textContent = "正在發布正式資源包結果，完成後會跳到 Web B 結果頁；卡片可直接複製連結或查看 QR。";
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
        window.location.href = withPrintParam(data.share_url, Boolean(options.print));
        return;
      }
      if (data.share_status === "pending") {
        $("packageStatus").textContent = "主結果已建立，正式 QR / 分享頁正在背景產生；先開啟本機 Web B 預覽。";
        openLocalResult("publish_pending", options);
        return;
      }
      $("packageStatus").textContent = "資源包已儲存，但沒有取得結果連結。";
    } catch (error) {
      console.error(error);
      $("packageStatus").textContent = "正式發布失敗，改產生本機預覽結果。此結果不會寫入後端，也不會產生正式分享連結。";
      openLocalResult(error.message || "api_failed", options);
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
    renderExchange();
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
      state.packages = readPackages();
      if (state.sessionValid) {
        await loadRemotePackages();
      } else {
        state.packageDataSource = state.packages.length ? "local_cache" : "empty";
      }
      if (state.hasUrlContext) {
        createPackage(defaultPackageName(), { save: false });
      } else if (state.packages.length) {
        applyPackageContext(state.packages[0]);
      } else {
        createPackage(defaultPackageName());
      }
      render();
      renderWorkbench();
      renderExchange();
    } catch (error) {
      $("scopeMeta").textContent = "資料載入失敗，請稍後再試。";
      $("cards").innerHTML = '<div class="empty">無法載入資源資料。</div>';
      console.error(error);
    }
  }

  init();
})();
