(function () {
  const STORAGE_KEY = "resource_nav_packages_v1";
  const RESOURCE_DATA_VERSION = "20260522-session-fix";
  let topics = [];
  let resources = [];
  let activePackage = null;
  let selectedResources = [];

  function $(id) {
    return document.getElementById(id);
  }

  function asList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function uniqueList(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function versionedAsset(path) {
    return path + (path.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(RESOURCE_DATA_VERSION);
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

  function packageIdFromUrl() {
    return new URLSearchParams(window.location.search).get("package_id") || "";
  }

  function isLocalPreviewMode() {
    return new URLSearchParams(window.location.search).get("mode") === "local";
  }

  function readPackages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.info("resource package storage unreadable", error);
      return [];
    }
  }

  function topicByKey(key) {
    return topics.find((topic) => topic.key === key);
  }

  function optionLabels(topic, selectedKeys) {
    const map = new Map((topic?.options || []).map((option) => [option.key, option.label]));
    return asList(selectedKeys).map((key) => map.get(key) || key);
  }

  function resourceIdentityTags(resource) {
    return uniqueList([
      ...asList(resource.eligibility_tags),
      ...asList(resource.urgency_tags),
    ]);
  }

  function isFamilyVisible(resource) {
    return resource.public_allowed !== false && resource.status !== "過期";
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

  function buildFamilyPackageText() {
    const visibleItems = selectedResources.filter(isFamilyVisible);
    return [
      "家屬版資源包：" + activePackage.name,
      activePackage.note ? "情境：" + activePackage.note : "",
      "",
      ...visibleItems.map((resource, index) => (index + 1) + ". " + familyText(resource)),
    ].filter(Boolean).join("\n\n");
  }

  function buildPhonePackageText() {
    return [
      "個管師電話確認清單：" + activePackage.name,
      "",
      ...selectedResources.map((resource, index) => (index + 1) + ". " + phoneText(resource)),
    ].join("\n\n");
  }

  function buildAdminPackageText() {
    return [
      "行政申請清單：" + activePackage.name,
      "",
      ...selectedResources.map((resource, index) => (index + 1) + ". " + adminText(resource)),
    ].join("\n\n");
  }

  function packagePurposeText() {
    const topic = topicByKey(activePackage.category);
    const tags = uniqueList(selectedResources.flatMap(resourceIdentityTags));
    return [
      "本次資源包目的：" + activePackage.name,
      activePackage.district ? "行政區：" + activePackage.district : "",
      topic ? "主題：" + topic.title : "",
      optionLabels(topic, activePackage.selectedTopicKeys).length
        ? "子主題：" + optionLabels(topic, activePackage.selectedTopicKeys).join("、")
        : "",
      tags.length ? "線索：" + tags.join("、") : "",
      activePackage.smartQueryText ? "補充描述：" + activePackage.smartQueryText : "",
      "已選資源：" + selectedResources.length + " 筆",
    ].filter(Boolean).join("｜");
  }

  function buildHandoffPackageText() {
    return [
      "交接摘要：" + activePackage.name,
      packagePurposeText(),
      activePackage.note ? "備註：" + activePackage.note : "",
      "",
      ...selectedResources.map((resource, index) => (index + 1) + ". " + handoffText(resource)),
    ].filter(Boolean).join("\n\n");
  }

  async function copyText(text) {
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = $("resultCopyScratch");
    area.value = text;
    area.select();
    document.execCommand("copy");
    area.value = "";
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

  function appendLinkedListItem(list, resource, text) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#result-resource-" + resource.id;
    link.textContent = resource.name;
    li.append(link, document.createTextNode("：" + text));
    list.appendChild(li);
  }

  function appendPhonePlanItem(list, resource) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    const contact = document.createElement("span");
    const question = document.createElement("span");
    link.href = "#result-resource-" + resource.id;
    link.textContent = resource.name;
    contact.className = "phone-contact";
    contact.textContent = "聯絡/申請：" + (resource.public_contact || resource.contact || "依來源公告");
    question.className = "phone-question";
    question.textContent = "電話確認：" + (asList(resource.phone_check_questions).join("；") || "確認資格、文件與是否仍受理。");
    li.append(link, contact, question);
    list.appendChild(li);
  }

  function renderResourceDetail(resource) {
    const section = document.createElement("section");
    section.className = "conclusion-resource";
    section.id = "result-resource-" + resource.id;
    const title = document.createElement("h4");
    title.textContent = resource.name;
    section.appendChild(title);
    const dl = document.createElement("dl");
    [
      ["身份/情境", resourceIdentityTags(resource).join("、") || "未標示"],
      ["申請方式", resource.public_next_step || resource.next_step || "請先確認申請條件與受理狀態。"],
      ["聯絡資訊", resource.public_contact || resource.contact || "依來源公告"],
      ["文件", asList(resource.public_required_documents).join("、") || "待確認"],
      ["最後確認", resource.last_checked_at || "待確認"],
      ["內部註記", resource.internal_notes || "尚無內部註記。"],
      ["電話確認", asList(resource.phone_check_questions).join("；") || "資格、文件、服務區域、是否仍受理。"],
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      dl.appendChild(row);
    });
    const sourceRow = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    const link = document.createElement("a");
    dt.textContent = "來源";
    link.href = resource.source_url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看來源";
    dd.appendChild(link);
    sourceRow.append(dt, dd);
    dl.appendChild(sourceRow);
    section.appendChild(dl);
    return section;
  }

  function showMissing() {
    $("missingPackage").hidden = false;
    $("resultContent").hidden = true;
    $("localPreviewBanner").hidden = true;
  }

  function renderResult() {
    if (!activePackage || !selectedResources.length) {
      showMissing();
      return;
    }
    $("missingPackage").hidden = true;
    $("localPreviewBanner").hidden = !isLocalPreviewMode();
    $("resultContent").hidden = false;
    $("resultTitle").textContent = activePackage.name || "資源包結果";
    $("resultMeta").textContent = packagePurposeText();

    const topic = topicByKey(activePackage.category);
    const backParams = new URLSearchParams();
    if (activePackage.category) backParams.set("category", activePackage.category);
    if (asList(activePackage.selectedTopicKeys).length) backParams.set("topics", asList(activePackage.selectedTopicKeys).join(","));
    if (activePackage.guildId) backParams.set("guild", activePackage.guildId);
    if (activePackage.resultChannelId) backParams.set("result_channel", activePackage.resultChannelId);
    $("backLink").href = "./resource-nav.html" + (backParams.toString() ? "?" + backParams.toString() : "");
    const discordLink = $("discordResultLink");
    if (activePackage.guildId && activePackage.resultChannelId) {
      discordLink.hidden = false;
      discordLink.href = "discord:///channels/" + encodeURIComponent(activePackage.guildId) + "/" + encodeURIComponent(activePackage.resultChannelId);
    } else {
      discordLink.hidden = true;
      discordLink.removeAttribute("href");
    }

    const priority = $("priorityList");
    priority.innerHTML = "";
    selectedResources.forEach((resource) => {
      appendLinkedListItem(priority, resource, resource.public_next_step || resource.next_step || "先確認資格與受理狀態。");
    });

    const phonePlan = $("phonePlanList");
    phonePlan.innerHTML = "";
    selectedResources.forEach((resource) => {
      appendPhonePlanItem(phonePlan, resource);
    });

    $("familyMessage").textContent = buildFamilyPackageText();
    $("handoffMessage").textContent = buildHandoffPackageText();
    renderList(
      $("documentList"),
      uniqueList(selectedResources.flatMap((resource) => asList(resource.public_required_documents))),
      "尚無文件欄位，請依來源公告確認。"
    );
    renderList(
      $("riskList"),
      uniqueList(selectedResources.flatMap((resource) => asList(resource.risk_flags)).concat(selectedResources.map((resource) => resource.internal_notes || ""))),
      "尚無特殊風險提醒。"
    );

    const details = $("resultDetails");
    details.innerHTML = "";
    selectedResources.forEach((resource) => details.appendChild(renderResourceDetail(resource)));

    $("copyFamily").addEventListener("click", async () => copyText(buildFamilyPackageText()));
    $("copyPhone").addEventListener("click", async () => copyText(buildPhonePackageText()));
    $("copyAdmin").addEventListener("click", async () => copyText(buildAdminPackageText()));
    $("copyHandoff").addEventListener("click", async () => copyText(buildHandoffPackageText()));
  }

  async function init() {
    try {
      const [topicsData, resourceData] = await Promise.all([
        loadJson(versionedAsset("./resource-nav-topics.json"), versionedAsset("../../../data/resource_nav/topics.json")),
        loadJson(versionedAsset("./resource-nav-resources.json"), versionedAsset("../../../data/resource_nav/resources.json")),
      ]);
      topics = topicsData.topics || [];
      resources = resourceData.resources || [];
      const id = packageIdFromUrl();
      activePackage = readPackages().find((item) => item && item.id === id);
      if (!activePackage) {
        showMissing();
        return;
      }
      const byId = new Map(resources.map((resource) => [resource.id, resource]));
      selectedResources = asList(activePackage.resourceIds).map((resourceId) => byId.get(resourceId)).filter(Boolean);
      renderResult();
    } catch (error) {
      console.error(error);
      showMissing();
    }
  }

  init();
})();
