(function () {
  const state = {
    topics: [],
    resources: [],
    category: "",
    selectedTopics: new Set(),
    identities: new Set(),
    district: "",
    urgency: "",
    packageIds: new Set(),
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
      render();
    };
  }

  function renderTopicChecks(topic) {
    const wrap = $("topicChecks");
    wrap.innerHTML = "";
    (topic.options || []).forEach((item) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.key;
      input.checked = state.selectedTopics.has(item.key);
      input.addEventListener("change", () => {
        if (input.checked) state.selectedTopics.add(item.key);
        else state.selectedTopics.delete(item.key);
        renderCards();
      });
      label.append(input, document.createTextNode(item.label));
      wrap.appendChild(label);
    });
  }

  function renderIdentityChecks() {
    const wrap = $("identityChecks");
    wrap.innerHTML = "";
    identityOptions.forEach((item) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item;
      input.checked = state.identities.has(item);
      input.addEventListener("change", () => {
        if (input.checked) state.identities.add(item);
        else state.identities.delete(item);
        renderCards();
      });
      label.append(input, document.createTextNode(item));
      wrap.appendChild(label);
    });
  }

  function setupFilters() {
    $("districtSelect").addEventListener("change", (event) => {
      state.district = event.target.value;
      renderCards();
    });
    $("urgencySelect").addEventListener("change", (event) => {
      state.urgency = event.target.value;
      renderCards();
    });
    $("packageMode").addEventListener("change", renderPackage);
    $("copyPackage").addEventListener("click", async () => {
      await copyText($("packageOutput").value);
    });
    $("clearPackage").addEventListener("click", () => {
      state.packageIds.clear();
      renderCards();
      renderPackage();
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

  function outputTextFor(resource, mode) {
    if (mode === "phone") return phoneText(resource);
    if (mode === "admin") return adminText(resource);
    return familyText(resource);
  }

  function renderCards() {
    const topic = getCurrentTopic();
    const cards = $("cards");
    const results = state.resources.filter(matchesResource);
    $("currentScope").textContent = topic.title + "資源";
    const selectedLabels = optionLabels(topic);
    $("scopeMeta").textContent = [
      selectedLabels.length ? "子主題：" + selectedLabels.join("、") : "尚未指定子主題",
      state.district ? "行政區：" + state.district : "行政區不限",
      state.identities.size ? "身份：" + Array.from(state.identities).join("、") : "身份不限",
      "共 " + results.length + " 筆",
    ].join("｜");

    updateAssistant(topic, selectedLabels);
    updateGoogleLink(topic, selectedLabels);

    cards.innerHTML = "";
    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "目前條件沒有符合的資源。可以放寬身份/行政區，或使用 Google 延伸搜尋。";
      cards.appendChild(empty);
      renderPackage();
      return;
    }

    const template = $("resourceCardTemplate");
    results.forEach((resource) => {
      const node = template.content.cloneNode(true);
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
      addButton.addEventListener("click", () => {
        if (state.packageIds.has(resource.id)) state.packageIds.delete(resource.id);
        else state.packageIds.add(resource.id);
        renderCards();
        renderPackage();
      });
      node.querySelector(".copy-family").addEventListener("click", async () => {
        await copyText(familyText(resource));
      });
      node.querySelector(".copy-phone").addEventListener("click", async () => {
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
    return state.resources.filter((resource) => state.packageIds.has(resource.id));
  }

  function renderPackage() {
    const items = selectedPackageResources();
    const mode = $("packageMode").value;
    const visibleItems = mode === "family" ? items.filter(isFamilyVisible) : items;
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
        renderCards();
        renderPackage();
      });
      wrap.appendChild(row);
    });

    if (!items.length) {
      $("packageOutput").value = "";
      return;
    }
    const title = mode === "phone"
      ? "個管師電話確認清單"
      : mode === "admin"
        ? "行政申請清單"
        : "案家資源包";
    const skipped = mode === "family" && visibleItems.length !== items.length
      ? "\n\n（已排除不可公開或過期資源）"
      : "";
    $("packageOutput").value = [
      title,
      "產生時間：" + new Date().toLocaleString("zh-TW"),
      "",
      ...visibleItems.map((resource, index) => (index + 1) + ". " + outputTextFor(resource, mode)),
    ].join("\n\n") + skipped;
  }

  function updateAssistant(topic, selectedLabels) {
    $("assistantIntro").textContent = "目前你在「" + topic.title + "」範圍內查詢。";
    const questions = [
      "個案目前最急的是錢、物資、人力、交通，還是申請流程？",
      "是否有低收/中低收、身障、外籍看護、獨居或急難條件？",
      "需要今天處理、這週處理，還是先收集備案？",
      "要輸出給家屬看，還是先做電話確認？",
    ];
    if (selectedLabels.length) {
      questions.unshift("你已選「" + selectedLabels.join("、") + "」，是否要再用身份條件縮小？");
    }
    const wrap = $("assistantQuestions");
    wrap.innerHTML = "";
    questions.slice(0, 4).forEach((text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      wrap.appendChild(button);
    });
  }

  function updateGoogleLink(topic, selectedLabels) {
    const queryParts = [
      "新北市",
      state.district,
      topic.title,
      ...selectedLabels,
      ...Array.from(state.identities),
      state.urgency,
      "資源",
      "社會局",
    ].filter(Boolean);
    const deduped = Array.from(new Set(queryParts)).join(" ");
    const url = "https://www.google.com/search?q=" + encodeURIComponent(deduped);
    const link = $("googleSearchLink");
    link.href = url;
    link.title = deduped;
  }

  function render() {
    const topic = getCurrentTopic();
    renderCategorySelect();
    renderTopicChecks(topic);
    renderIdentityChecks();
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
      if (!state.category && state.topics[0]) state.category = state.topics[0].key;
      render();
    } catch (error) {
      $("scopeMeta").textContent = "資料載入失敗，請稍後再試。";
      $("cards").innerHTML = '<div class="empty">無法載入資源資料。</div>';
      console.error(error);
    }
  }

  init();
})();
