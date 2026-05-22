(function () {
  const STORAGE_KEY = "resource_nav_packages_v1";
  const MAX_PACKAGES = 10;
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
    sessionUser: null,
    sessionValid: false,
    sessionFailureReason: "",
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

  function parseParams() {
    const params = new URLSearchParams(window.location.search);
    state.category = params.get("category") || "";
    const topicParam = params.get("topics") || "";
    topicParam.split(",").filter(Boolean).forEach((key) => state.selectedTopics.add(key));
    const source = params.get("source") || "direct";
    state.sessionToken = params.get("session") || "";
    state.apiBase = (params.get("api_base") || "").replace(/\/$/, "");
    state.source = source;
    state.hasSessionParam = Boolean(state.sessionToken);
    state.hasApiBaseParam = Boolean(state.apiBase);
    state.district = params.get("district") || "";
    state.hasUrlContext = Boolean(state.category || topicParam);
    $("sourceStatus").textContent = source === "discord" ? "Discord 入口" : "直接開啟";
  }

  function apiUrl(path) {
    if (!state.apiBase) return "";
    return state.apiBase + path;
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
    const response = await fetch(apiUrl(path), {
      ...(options || {}),
      headers: { ...headers, ...((options && options.headers) || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "resource api failed");
    }
    return data;
  }

  function sessionReasonLabel(reason) {
    const labels = {
      verified: "已完成 Discord 身份驗證。",
      no_session: "網址沒有 session；請從 Discord 資源導航入口重新開啟。",
      no_api_base: "網址沒有 api_base；Bot 可能尚未帶入 API 網址，或 RESOURCE_NAV_API_BASE / WEB_B_SUBMIT_URL 尚未設定。",
      session_expired: "後端回覆 session 無效或過期；請回 Discord 重新點入口。",
      api_unavailable: "API 連不上或還不是新版；請確認 Bot 已重啟，且公開網址指向新版 server。",
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
    apiBaseStatus.textContent = state.hasApiBaseParam ? "有 api_base 參數" : "缺少 api_base 參數";
    verifyStatus.textContent = state.sessionValid ? "已驗證 Discord 身份" : "未完成後端驗證";
    reasonStatus.textContent = state.sessionValid
      ? sessionReasonLabel("verified")
      : sessionReasonLabel(state.sessionFailureReason || "missing_session");
  }

  async function verifySession() {
    const loginStatus = $("loginStatus");
    if (!state.sessionToken) {
      state.sessionValid = false;
      state.sessionFailureReason = "no_session";
      loginStatus.textContent = state.source === "discord"
        ? "已從 Discord 入口開啟，但網址沒有 session。可先產生本機預覽結果；若要保存到 Discord 私密 QR，請回 Discord 重新點入口。"
        : "未取得 Discord session：可瀏覽與點選資源，也可先產生本機預覽結果；若要保存到 Discord 私密 QR，請回 Discord 重新點入口。";
      $("sourceStatus").textContent = "未登入瀏覽";
      renderSessionDebug();
      return;
    }
    if (!state.apiBase) {
      state.sessionValid = false;
      state.sessionFailureReason = "no_api_base";
      loginStatus.textContent = "已取得 session，但網址沒有 api_base，網站不知道要向哪個 Bot API 驗證身份。可先產生本機預覽結果；若要保存到 Discord 私密 QR，請確認 Bot 入口已更新後重新開啟。";
      $("sourceStatus").textContent = "API 未設定";
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
      const name = state.sessionUser && state.sessionUser.name ? state.sessionUser.name : "Discord 使用者";
      $("sourceStatus").textContent = "已連結 Discord";
      loginStatus.textContent = "已以 " + name + " 的 Discord 身份開啟。資源包結果會保存到你的私密結果入口。";
      renderSessionDebug();
    } catch (error) {
      state.sessionValid = false;
      state.sessionFailureReason = error.message === "invalid_or_expired_session" ? "session_expired" : "api_unavailable";
      $("sourceStatus").textContent = "session 已失效";
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
          createdAt: String(item.createdAt || nowIso()),
          updatedAt: String(item.updatedAt || nowIso()),
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
    return district + (topic ? topic.title : "資源") + "資源包";
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
    item.updatedAt = nowIso();
    writePackages();
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
    normalizeCategory();
    normalizeSelectedTopics();
  }

  function renderPackageManager() {
    currentPackage();
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
    $("packageToggle").addEventListener("click", () => {
      document.querySelector(".package-panel").classList.toggle("is-open");
    });
    $("packageMode").addEventListener("change", renderPackage);
    $("generateResult").addEventListener("click", async () => {
      syncPackageFromState();
      if (!state.packageIds.size) {
        $("packageStatus").textContent = "請先加入至少一筆資源，再產生資源包結果。";
        return;
      }
      await submitResourcePackage();
    });
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
    if (state.packageIds.has(resource.id)) state.packageIds.delete(resource.id);
    else state.packageIds.add(resource.id);
    syncPackageFromState();
    renderCards();
    renderPackage();
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

  async function submitResourcePackage() {
    const item = currentPackage();
    const payload = {
      name: item.name || defaultPackageName(),
      note: item.note || "",
      category: state.category,
      selectedTopicKeys: Array.from(state.selectedTopics),
      district: state.district,
      urgency: state.urgency,
      smartQueryText: state.smartQueryText,
      resourceIds: Array.from(state.packageIds),
      outputMode: $("packageMode").value,
    };
    const button = $("generateResult");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "正在產生...";
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
      if (data.share_url) {
        window.location.href = data.share_url;
        return;
      }
      $("packageStatus").textContent = "資源包已儲存，但沒有取得結果連結。";
    } catch (error) {
      console.error(error);
      $("packageStatus").textContent = "正式發布失敗，改產生本機預覽結果。此結果不會進 Discord 私密 QR。";
      openLocalResult(error.message || "api_failed");
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function renderPackage() {
    renderPackageManager();
    const items = selectedPackageResources();
    const mode = $("packageMode").value;
    const wrap = $("packageItems");
    const countText = items.length + " 筆";
    wrap.innerHTML = "";
    $("packageCount").textContent = countText;
    $("packageToggleCount").textContent = countText;
    $("packageStatus").textContent = items.length
      ? "已加入 " + items.length + " 筆資源。"
      : "尚未加入資源。";

    items.forEach((resource) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "package-item";
      row.textContent = "移除｜" + resource.name;
      row.addEventListener("click", () => {
        state.packageIds.delete(resource.id);
        syncPackageFromState();
        renderCards();
        renderPackage();
      });
      wrap.appendChild(row);
    });

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
        loadJson("./resource-nav-topics.json", "../../../data/resource_nav/topics.json"),
        loadJson("./resource-nav-resources.json", "../../../data/resource_nav/resources.json"),
      ]);
      state.topics = topicsData.topics || [];
      state.resources = resourceData.resources || [];
      await verifySession();
      normalizeCategory();
      normalizeSelectedTopics();
      state.packages = readPackages();
      if (state.hasUrlContext) {
        createPackage(defaultPackageName(), { save: false });
      } else if (state.packages.length) {
        applyPackageContext(state.packages[0]);
      } else {
        createPackage(defaultPackageName());
      }
      render();
    } catch (error) {
      $("scopeMeta").textContent = "資料載入失敗，請稍後再試。";
      $("cards").innerHTML = '<div class="empty">無法載入資源資料。</div>';
      console.error(error);
    }
  }

  init();
})();
