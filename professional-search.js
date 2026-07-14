(function () {
  "use strict";
  const form = document.getElementById("searchForm");
  const need = document.getElementById("needInput");
  const submit = document.getElementById("generateBtn");
  const status = document.getElementById("jobStatus");
  const resultMeta = document.getElementById("resultMeta");
  const resultBody = document.getElementById("resultBody");
  const actions = document.getElementById("searchActions");
  const copyButton = document.getElementById("copyBtn");
  let currentPrompt = "";
  const savedJobs = new Set();

  function delay(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }
  function stateLabel(value) { return { queued: "等待處理", running: "正在整理", completed: "已完成", failed: "處理失敗", blocked_pdpa: "含敏感資料，已停止" }[value] || value; }
  function updateCounter() { document.getElementById("counterNum").textContent = need.value.length + " / 300"; submit.disabled = need.value.trim().length < 4; }

  function renderJob(job) {
    resultMeta.textContent = stateLabel(job.status);
    actions.hidden = true; copyButton.hidden = true; resultBody.innerHTML = "";
    if (job.status === "completed") {
      const text = document.createElement("pre"); text.className = "ps-prompt"; text.textContent = job.full_prompt || job.short_prompt; resultBody.appendChild(text);
      currentPrompt = job.full_prompt || job.short_prompt; copyButton.hidden = false; actions.hidden = false;
      document.getElementById("aiSearchLink").href = job.google_ai_url;
      document.getElementById("googleSearchLink").href = job.google_search_url;
    } else {
      const message = document.createElement("p"); message.className = "empty-state";
      message.textContent = job.status === "blocked_pdpa" ? "需求中偵測到「" + (job.pdpa_hit || "敏感資料") + "」，請移除個人資料後重新建立。" : (job.error || stateLabel(job.status));
      resultBody.appendChild(message);
    }
  }

  async function saveCompleted(job) {
    if (savedJobs.has(job.id)) return; savedJobs.add(job.id);
    await window.OBPortal.getJson("/api/v1/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "professional-search", title: "專業報告搜尋：" + (job.profession_label || "專業提問"), summary: job.question, payload: { full_prompt: job.full_prompt, short_prompt: job.short_prompt, google_ai_url: job.google_ai_url, google_search_url: job.google_search_url } }) });
  }

  async function poll(jobId) {
    for (let count = 0; count < 90; count += 1) {
      const data = await window.OBPortal.getJson("/api/v1/professional-search/jobs/" + encodeURIComponent(jobId));
      renderJob(data.job); status.textContent = stateLabel(data.job.status);
      if (["completed", "failed", "blocked_pdpa"].includes(data.job.status)) { if (data.job.status === "completed") await saveCompleted(data.job); await loadHistory(); return; }
      await delay(2000);
    }
    status.textContent = "任務仍在處理，可稍後從最近任務查看。";
  }

  async function loadHistory() {
    const data = await window.OBPortal.getJson("/api/v1/professional-search/jobs");
    const root = document.getElementById("jobHistory"); root.innerHTML = "";
    if (!data.jobs.length) { root.innerHTML = '<p class="empty-state">目前沒有專業搜尋任務。</p>'; return; }
    data.jobs.forEach(function (job) {
      const button = document.createElement("button"); button.type = "button"; button.className = "result-row ps-history-row";
      const main = document.createElement("span"); const title = document.createElement("strong"); title.textContent = job.question; const meta = document.createElement("small"); meta.textContent = (job.profession_label || "專業搜尋") + " / " + job.created_at; main.append(title, meta);
      const label = document.createElement("span"); label.className = "status-label"; label.textContent = stateLabel(job.status); button.append(main, label); button.addEventListener("click", function () { renderJob(job); if (["queued", "running"].includes(job.status)) poll(job.id).catch(showError); }); root.appendChild(button);
    });
  }

  function showError(error) { status.textContent = error.message || "處理失敗"; }
  need.addEventListener("input", updateCounter);
  copyButton.addEventListener("click", async function () { await navigator.clipboard.writeText(currentPrompt); status.textContent = "提問已複製。"; });
  form.addEventListener("submit", async function (event) {
    event.preventDefault(); submit.disabled = true; status.textContent = "正在建立任務";
    try {
      const selected = document.getElementById("professionInput").value.split("|");
      const data = await window.OBPortal.getJson("/api/v1/professional-search/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: need.value.trim(), profession_key: selected[0], profession_label: selected[1] }) });
      renderJob(data.job); await loadHistory(); await poll(data.job.id);
    } catch (error) { showError(error); }
    finally { updateCounter(); }
  });
  updateCounter(); loadHistory().catch(showError);
})();
