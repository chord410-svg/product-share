(function () {
  const state = {
    topics: [],
    resources: [],
    category: "",
    selectedTopics: new Set(),
    identities: new Set(),
    district: "",
    urgency: "",
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
    select.addEventListener("change", () => {
      state.category = select.value;
      state.selectedTopics.clear();
      render();
    });
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
  }

  function matchesResource(resource) {
    if (resource.category !== state.category) return false;
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
      return;
    }

    const template = $("resourceCardTemplate");
    results.forEach((resource) => {
      const node = template.content.cloneNode(true);
      node.querySelector(".category").textContent = topicLabel(resource.category);
      node.querySelector("h3").textContent = resource.name;
      node.querySelector(".confidence").textContent = resource.confidence || "待確認";
      node.querySelector(".summary").textContent = resource.summary || "";
      node.querySelector(".eligibility").textContent = (resource.eligibility_tags || []).join("、") || "未標示";
      node.querySelector(".next-step").textContent = resource.next_step || "請先確認個案條件與受理狀態。";
      node.querySelector(".contact").textContent = resource.contact || "依來源公告";
      node.querySelector(".checked-at").textContent = "最後確認：" + (resource.last_checked_at || "待確認");
      const source = node.querySelector(".source");
      source.href = resource.source_url || "#";
      if (!resource.source_url) source.removeAttribute("href");
      const note = node.querySelector(".internal-note");
      note.textContent = resource.internal_notes || "";
      if (!note.textContent) note.remove();
      cards.appendChild(node);
    });
  }

  function updateAssistant(topic, selectedLabels) {
    $("assistantIntro").textContent = "目前你在「" + topic.title + "」範圍內查詢。";
    const questions = [
      "個案目前最急的是錢、物資、人力、交通，還是申請流程？",
      "是否有低收/中低收、身障、外籍看護、獨居或急難條件？",
      "需要今天處理、這週處理，還是先收集備案？",
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
