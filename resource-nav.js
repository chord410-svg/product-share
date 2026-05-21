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
    identities: new Set(),
    district: "",
    urgency: "",
    smartQueryText: "",
    googlePromptEdited: false,
    packageIds: new Set(),
    conclusionVisible: false,
  };

  const identityOptions = [
    "低收",
    "中低收",
    "弱勢",
    "高齡",
    "身心障礙",
    "長照需求",
    "外籍看護",
    "家庭照顧者",
    "急難",
  ];

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
    $("sourceStatus").textContent = source === "discord" ? "Discord 入口" : "直接開啟";
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

  function isFamilyVisible(resource) {
    return resource.public_allowed !== false && resource.status !== "過期";
  }

  async function copyText(text) {
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = $("packageOutput");
    const old = area.value;
    area.value = text;
    area.select();
    document.execCommand("copy");
    area.value = old;
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
          identities: Array.isArray(item.identities) ? item.identities.map(String) : [],
          urgency: String(item.urgency || ""),
          smartQueryText: String(item.smartQueryText || ""),
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
      identities: Array.from(state.identities),
      urgency: state.urgency,
      smartQueryText: state.smartQueryText,
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
    item.name = $("packageNameInput").value.trim() || item.name || "臨時資源包";
    item.note = $("packageNoteInput").value.trim();
    item.resourceIds = Array.from(state.packageIds);
    item.district = state.district;
    item.category = state.category;
    item.selectedTopicKeys = Array.from(state.selectedTopics);
    item.identities = Array.from(state.identities);
    item.urgency = state.urgency;
    item.smartQueryText = state.smartQueryText;
    item.updatedAt = nowIso();
    writePackages();
  }

  function applyPackageContext(item) {
    state.activePackageId = item.id;
    state.packageIds = new Set(item.resourceIds || []);
    state.district = item.district || state.district;
    state.category = item.category || state.category;
    state.selectedTopics = new Set(item.selectedTopicKeys || []);
    state.identities = new Set(item.identities || []);
    state.urgency = item.urgency || "";
    state.smartQueryText = item.smartQueryText || "";
    state.googlePromptEdited = false;
    state.conclusionVisible = false;
  }

  function renderPackageManager() {
    const item = currentPackage();
    $("packageNameInput").value = item.name || "";
    $("packageNoteInput").value = item.note || "";
    const select = $("packageSelect");
    select.innerHTML = "";
    state.packages.forEach((pkg) => {
      const option = document.createElement("option");
      option.value = pkg.id;
      option.textContent = pkg.name + "｜" + (pkg.resourceIds || []).length + " 筆";
      select.appendChild(option);
    });
    select.value = item.id;
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

  function markPromptStale() {
    state.googlePromptEdited = false;
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
      markPromptStale();
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
        markPromptStale();
        syncPackageFromState();
        renderTopicChips(topic);
        renderCards();
      }));
    });
  }

  function renderIdentityChips() {
    const wrap = $("identityChips");
    wrap.innerHTML = "";
    identityOptions.forEach((item) => {
      wrap.appendChild(createChip(item, state.identities.has(item), () => {
        if (state.identities.has(item)) state.identities.delete(item);
        else state.identities.add(item);
        markPromptStale();
        syncPackageFromState();
        renderIdentityChips();
        renderCards();
      }));
    });
  }

  function setupFilters() {
    $("districtSelect").addEventListener("change", (event) => {
      state.district = event.target.value;
      markPromptStale();
      syncPackageFromState();
      renderCards();
    });
    $("urgencySelect").addEventListener("change", (event) => {
      state.urgency = event.target.value;
      markPromptStale();
      syncPackageFromState();
      renderCards();
    });
    $("smartQueryInput").addEventListener("input", (event) => {
      state.smartQueryText = event.target.value.trim();
      markPromptStale();
      syncPackageFromState();
      renderGooglePrompt();
      renderConclusion();
    });
    $("googlePrompt").addEventListener("input", () => {
      state.googlePromptEdited = true;
      updateGoogleLink();
    });
    $("packageNameInput").addEventListener("input", () => {
      syncPackageFromState();
      renderPackage();
      renderConclusion();
    });
    $("packageNoteInput").addEventListener("input", () => {
      syncPackageFromState();
      renderConclusion();
    });
    $("packageSelect").addEventListener("change", (event) => {
      const item = state.packages.find((pkg) => pkg.id === event.target.value);
      if (!item) return;
      applyPackageContext(item);
      render();
    });
    $("newPackage").addEventListener("click", () => {
      createPackage(defaultPackageName());
      render();
    });
    $("duplicatePackage").addEventListener("click", () => {
      const item = currentPackage();
      const copy = {
        ...item,
        id: newId("pkg"),
        name: item.name + " 複本",
        resourceIds: [...item.resourceIds],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.packages.unshift(copy);
      applyPackageContext(copy);
      writePackages();
      render();
    });
    $("deletePackage").addEventListener("click", () => {
      state.packages = state.packages.filter((pkg) => pkg.id !== state.activePackageId);
      if (!state.packages.length) createPackage(defaultPackageName(), { save: false });
      applyPackageContext(state.packages[0]);
      writePackages();
      render();
    });
    $("packageMode").addEventListener("change", renderPackage);
    $("generateConclusion").addEventListener("click", () => {
      state.conclusionVisible = true;
      renderConclusion();
      $("conclusionPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("copyConclusionFamily").addEventListener("click", async () => {
      await copyText(buildFamilyPackageText(selectedPackageResources()));
    });
    $("copyConclusionHandoff").addEventListener("click", async () => {
      await copyText(buildHandoffPackageText(selectedPackageResources()));
    });
    $("copyPackage").addEventListener("click", async () => {
      await copyText($("packageOutput").value);
    });
    $("clearPackage").addEventListener("click", () => {
      state.packageIds.clear();
      state.conclusionVisible = false;
      syncPackageFromState();
      renderCards();
      renderPackage();
      renderConclusion();
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
    if (state.identities.size > 0) {
      const tags = resource.eligibility_tags || [];
      if (!Array.from(state.identities).some((identity) => tags.some((tag) => tag.includes(identity)))) return false;
    }
    if (state.urgency) {
      const urgencyTags = resource.urgency_tags || [];
      if (!urgencyTags.includes(state.urgency)) return false;
    }
    return true;
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

  function outputTextFor(resource, mode) {
    if (mode === "phone") return phoneText(resource);
    if (mode === "admin") return adminText(resource);
    if (mode === "handoff") return handoffText(resource);
    return familyText(resource);
  }

  function togglePackageResource(resource) {
    if (state.packageIds.has(resource.id)) state.packageIds.delete(resource.id);
    else state.packageIds.add(resource.id);
    state.conclusionVisible = false;
    syncPackageFromState();
    renderCards();
    renderPackage();
    renderConclusion();
  }

  function renderCards() {
    const topic = getCurrentTopic();
    const cards = $("cards");
    const results = state.resources.filter(matchesResource);
    $("currentScope").textContent = topic.title + "資源";
    const selectedLabels = optionLabels(topic);
    $("scopeMeta").textContent = [
      state.district ? "行政區：" + state.district : "行政區不限",
      selectedLabels.length ? "子主題：" + selectedLabels.join("、") : "尚未指定子主題",
      state.identities.size ? "身份：" + Array.from(state.identities).join("、") : "身份不限",
      state.smartQueryText ? "智慧查詢：" + state.smartQueryText : "",
      "共 " + results.length + " 筆",
    ].filter(Boolean).join("｜");

    renderGooglePrompt();

    cards.innerHTML = "";
    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "目前條件沒有符合的資源。可以放寬身份/行政區，或調整智慧查詢後使用 Google 延伸搜尋。";
      cards.appendChild(empty);
      renderPackage();
      return;
    }

    const template = $("resourceCardTemplate");
    results.forEach((resource) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector(".resource-card");
      card.id = "resource-card-" + resource.id;
      card.classList.toggle("is-selected", state.packageIds.has(resource.id));
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a, summary, details, input, select, textarea")) return;
        togglePackageResource(resource);
      });
      node.querySelector(".category").textContent = topicLabel(resource.category);
      node.querySelector("h3").textContent = resource.name;
      node.querySelector(".confidence").textContent = resource.confidence || resource.status || "待確認";
      node.querySelector(".summary").textContent = resource.public_summary || resource.summary || "";
      node.querySelector(".eligibility").textContent = (resource.eligibility_tags || []).join("、") || "未標示";
      node.querySelector(".next-step").textContent = resource.public_next_step || resource.next_step || "請先確認個案條件與受理狀態。";
      node.querySelector(".contact").textContent = resource.public_contact || resource.contact || "依來源公告";
      const docs = asList(resource.public_required_documents);
      node.querySelector(".required-docs").textContent = docs.join("、");
      if (!docs.length) node.querySelector(".required-docs-row").remove();
      node.querySelector(".checked-at").textContent = "最後確認：" + (resource.last_checked_at || "待確認");
      const source = node.querySelector(".source");
      source.href = resource.source_url || "#";
      if (!resource.source_url) source.removeAttribute("href");

      const addButton = node.querySelector(".add-package");
      addButton.textContent = state.packageIds.has(resource.id) ? "已加入資源包" : "加入資源包";
      addButton.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePackageResource(resource);
      });
      node.querySelector(".copy-family").addEventListener("click", async (event) => {
        event.stopPropagation();
        await copyText(familyText(resource));
      });
      node.querySelector(".copy-phone").addEventListener("click", async (event) => {
        event.stopPropagation();
        await copyText(phoneText(resource));
      });

      const note = node.querySelector(".internal-note");
      note.textContent = resource.internal_notes || "尚無內部註記。";
      const questions = node.querySelector(".phone-questions");
      asList(resource.phone_check_questions).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        questions.appendChild(li);
      });
      if (!questions.children.length) questions.remove();
      const flags = node.querySelector(".risk-flags");
      asList(resource.risk_flags).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        flags.appendChild(li);
      });
      if (!flags.children.length) flags.remove();
      cards.appendChild(node);
    });
    renderPackage();
  }

  function selectedPackageResources() {
    const byId = new Map(state.resources.map((resource) => [resource.id, resource]));
    return Array.from(state.packageIds).map((id) => byId.get(id)).filter(Boolean);
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

  function renderPackage() {
    renderPackageManager();
    const items = selectedPackageResources();
    const mode = $("packageMode").value;
    const wrap = $("packageItems");
    wrap.innerHTML = "";
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
        state.conclusionVisible = false;
        syncPackageFromState();
        renderCards();
        renderPackage();
        renderConclusion();
      });
      wrap.appendChild(row);
    });

    $("packageOutput").value = buildPackageOutput(items, mode);
  }

  function packagePurposeText(items) {
    const topic = getCurrentTopic();
    return [
      "本次資源包目的：" + currentPackage().name,
      state.district ? "行政區：" + state.district : "",
      topic ? "主題：" + topic.title : "",
      state.identities.size ? "身份/情境：" + Array.from(state.identities).join("、") : "",
      state.smartQueryText ? "補充描述：" + state.smartQueryText : "",
      "已選資源：" + items.length + " 筆",
    ].filter(Boolean).join("｜");
  }

  function renderList(list, items, fallback) {
    list.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.textContent = fallback;
      list.appendChild(li);
      return;
    }
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function renderConclusion() {
    const panel = $("conclusionPanel");
    const items = selectedPackageResources();
    if (!state.conclusionVisible || !items.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    $("conclusionTitle").textContent = currentPackage().name || "案家資源包結論";
    $("conclusionMeta").textContent = packagePurposeText(items);

    const priority = $("priorityList");
    priority.innerHTML = "";
    items.forEach((resource, index) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#conclusion-resource-" + resource.id;
      link.textContent = resource.name;
      li.append(link, document.createTextNode("：" + (resource.public_next_step || resource.next_step || "先確認資格與受理狀態。")));
      priority.appendChild(li);
    });

    const phonePlan = $("phonePlanList");
    phonePlan.innerHTML = "";
    items.forEach((resource) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#conclusion-resource-" + resource.id;
      link.textContent = resource.name;
      li.append(link, document.createTextNode("：" + (asList(resource.phone_check_questions).join("；") || "確認資格、文件與是否仍受理。")));
      phonePlan.appendChild(li);
    });

    $("familyMessage").textContent = buildFamilyPackageText(items);
    renderList(
      $("documentList"),
      uniqueList(items.flatMap((resource) => asList(resource.public_required_documents))),
      "尚無文件欄位，請依來源公告確認。"
    );
    renderList(
      $("riskList"),
      uniqueList(items.flatMap((resource) => asList(resource.risk_flags)).concat(items.map((resource) => resource.internal_notes || ""))),
      "尚無特殊風險提醒。"
    );

    const details = $("conclusionDetails");
    details.innerHTML = "";
    items.forEach((resource) => {
      const section = document.createElement("section");
      section.className = "conclusion-resource";
      section.id = "conclusion-resource-" + resource.id;
      section.innerHTML = [
        "<h4>" + resource.name + "</h4>",
        "<dl>",
        "<div><dt>適用條件</dt><dd>" + ((resource.eligibility_tags || []).join("、") || "未標示") + "</dd></div>",
        "<div><dt>申請方式</dt><dd>" + (resource.public_next_step || resource.next_step || "請先確認申請條件與受理狀態。") + "</dd></div>",
        "<div><dt>聯絡資訊</dt><dd>" + (resource.public_contact || resource.contact || "依來源公告") + "</dd></div>",
        "<div><dt>文件</dt><dd>" + (asList(resource.public_required_documents).join("、") || "待確認") + "</dd></div>",
        "<div><dt>來源</dt><dd><a href=\"" + (resource.source_url || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\">查看來源</a></dd></div>",
        "<div><dt>最後確認</dt><dd>" + (resource.last_checked_at || "待確認") + "</dd></div>",
        "<div><dt>內部註記</dt><dd>" + (resource.internal_notes || "尚無內部註記。") + "</dd></div>",
        "<div><dt>電話確認</dt><dd>" + (asList(resource.phone_check_questions).join("；") || "資格、文件、服務區域、是否仍受理。") + "</dd></div>",
        "</dl>",
      ].join("");
      details.appendChild(section);
    });
  }

  function buildGooglePrompt() {
    const topic = getCurrentTopic();
    const selectedLabels = optionLabels(topic);
    const parts = [
      "新北市",
      state.district,
      topic ? topic.title : "",
      ...selectedLabels,
      ...Array.from(state.identities),
      state.urgency,
      state.smartQueryText,
      "長照 資源 社會局 申請",
    ].filter(Boolean);
    return Array.from(new Set(parts)).join(" ");
  }

  function renderGooglePrompt() {
    if (!state.googlePromptEdited) {
      $("googlePrompt").value = buildGooglePrompt();
    }
    updateGoogleLink();
  }

  function updateGoogleLink() {
    const prompt = $("googlePrompt").value.trim() || buildGooglePrompt();
    const url = "https://www.google.com/search?q=" + encodeURIComponent(prompt);
    const link = $("googleSearchLink");
    link.href = url;
    link.title = prompt;
  }

  function render() {
    const topic = getCurrentTopic();
    $("districtSelect").value = state.district;
    $("urgencySelect").value = state.urgency;
    $("smartQueryInput").value = state.smartQueryText;
    renderCategorySelect();
    renderTopicChips(topic);
    renderIdentityChips();
    renderCards();
    renderConclusion();
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
      if (!state.category && state.topics[0]) state.category = state.topics[0].key;
      state.packages = readPackages();
      if (state.packages.length) {
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
