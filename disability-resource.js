const state = {
  data: null,
  selectedScenarioIds: new Set(),
};

const qs = (selector) => document.querySelector(selector);
const caseText = qs('#caseText');
const privacyWarning = qs('#privacyWarning');

function lineList(items) {
  if (!items || !items.length) return '尚無資料。';
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function uniqueList(groups) {
  const seen = new Set();
  const out = [];
  for (const item of groups.flat().filter(Boolean)) {
    const value = String(item).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (error) {
    return '';
  }
  return '';
}

function allScenarios() {
  return state.data?.scenarios || [];
}

function selectedScenarios() {
  const ids = state.selectedScenarioIds;
  return allScenarios().filter((scenario) => ids.has(scenario.scenario_id));
}

function sourceById(id) {
  return (state.data?.sources || []).find((source) => source.source_id === id);
}

function detectPrivacy(text) {
  const hits = [];
  if (/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/.test(text) || /0\d{1,2}[-\s]?\d{6,8}/.test(text)) hits.push('電話');
  if (/[A-Z][12]\d{8}/i.test(text)) hits.push('身分證字號');
  if (/(路|街|巷|弄|號|樓)/.test(text) && /(市|縣|區|鄉|鎮)/.test(text)) hits.push('完整地址');
  if (/(病歷|病歷號|就醫號|個案姓名|姓名)/.test(text)) hits.push('病歷或姓名');
  return [...new Set(hits)];
}

function privacyMessage() {
  const hits = detectPrivacy(caseText.value || '');
  if (!hits.length) {
    privacyWarning.hidden = true;
    privacyWarning.textContent = '';
    return '';
  }
  const text = `偵測到可能的個資：${hits.join('、')}。請先移除後再整理，工具不會保存文字，但仍建議不要輸入。`;
  privacyWarning.hidden = false;
  privacyWarning.textContent = text;
  return text;
}

function updateSelectedCount() {
  const selected = selectedScenarios().length;
  const total = allScenarios().length;
  qs('#selectedCount').textContent = `已選 ${selected}/${total} 個情境`;
}

function toggleScenario(id) {
  if (state.selectedScenarioIds.has(id)) {
    state.selectedScenarioIds.delete(id);
  } else {
    state.selectedScenarioIds.add(id);
  }
  renderScenarioCards();
  renderOutputs();
}

function renderScenarioCards() {
  const container = qs('#scenarioCards');
  container.innerHTML = '';
  for (const scenario of allScenarios()) {
    const selected = state.selectedScenarioIds.has(scenario.scenario_id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `scenario-card${selected ? ' selected' : ''}`;
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    const examples = (scenario.trigger_examples || []).slice(0, 2).join('、');
    const tags = (scenario.risk_labels || []).slice(0, 3);
    card.innerHTML = `
      <div class="card-title">${escapeHtml(scenario.short_label || scenario.title)}</div>
      <div class="card-desc">${escapeHtml(examples || scenario.care_manager_goal || '')}</div>
      <div class="card-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => toggleScenario(scenario.scenario_id));
    container.appendChild(card);
  }
  updateSelectedCount();
}

function renderSourceLinks(scenarios) {
  const ids = uniqueList(scenarios.map((scenario) => scenario.source_ids || []));
  const sources = ids.map(sourceById).filter(Boolean);
  if (!sources.length) return '<div class="source-item">尚無可公開來源資料；請改用官方延伸搜尋或電話確認。</div>';
  return sources.map((source, index) => {
    const url = safeUrl(source.url);
    const link = url
      ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '<span>未提供可開啟網址</span>';
    return `<div class="source-item"><strong>${index + 1}. ${escapeHtml(source.title || source.source_id)}</strong><br><span>來源等級：${escapeHtml(source.source_level || '未分級')}｜狀態：${escapeHtml(source.review_status || '待確認')}</span>${link}</div>`;
  }).join('');
}

function renderOutputs() {
  const scenarios = selectedScenarios();
  privacyMessage();
  if (!scenarios.length) {
    qs('#resultTitle').textContent = '請先選擇一個或多個情境';
    qs('#summaryOutput').textContent = '請先選擇情境，這裡會產生查證摘要。';
    qs('#routeOutput').textContent = '';
    qs('#phoneOutput').textContent = '';
    qs('#familyOutput').textContent = '';
    qs('#internalOutput').textContent = '';
    qs('#sourceOutput').innerHTML = '';
    updateSelectedCount();
    return;
  }

  const titles = scenarios.map((scenario) => scenario.short_label || scenario.title);
  const caseNote = (caseText.value || '').trim();
  qs('#resultTitle').textContent = `已選 ${scenarios.length} 個查證情境`;
  qs('#summaryOutput').textContent = [
    `本案需要先查證：${titles.join('、')}。`,
    caseNote ? `本頁暫存補充：${caseNote}` : '',
    '建議先整理制度路徑、官方窗口、電話確認問題，再用保守語氣回覆家屬。',
    '本工具不做資格判定、不承諾補助金額。',
  ].filter(Boolean).join('\n');
  qs('#routeOutput').textContent = lineList(uniqueList(scenarios.map((scenario) => scenario.verification_routes || [])));
  qs('#phoneOutput').textContent = lineList(uniqueList(scenarios.map((scenario) => scenario.phone_check_questions || [])));
  qs('#familyOutput').textContent = scenarios.map((scenario, index) => `${index + 1}. ${scenario.family_summary}`).join('\n\n');
  qs('#internalOutput').textContent = lineList(uniqueList(scenarios.map((scenario) => scenario.internal_notes || [])));
  qs('#sourceOutput').innerHTML = renderSourceLinks(scenarios);
  updateSelectedCount();
}

async function copyTarget(id) {
  const node = qs(`#${id}`);
  const text = node?.innerText || node?.textContent || '';
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

function officialSearchUrl() {
  const scenarios = selectedScenarios();
  const query = scenarios.length
    ? `身障 福利 輔具 居家無障礙 ${scenarios.map((scenario) => scenario.short_label || scenario.title).join(' ')}`
    : '身障 福利 輔具 居家無障礙 官方';
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function init() {
  const response = await fetch('disability-resource-scenarios.json?v=20260612-disability-resource-cnfix1', { cache: 'no-store' });
  state.data = await response.json();
  renderScenarioCards();
  renderOutputs();
  caseText.addEventListener('input', renderOutputs);
  qs('#clearSelectionButton').addEventListener('click', () => {
    state.selectedScenarioIds.clear();
    renderScenarioCards();
    renderOutputs();
  });
  qs('#officialSearchButton').addEventListener('click', () => {
    window.open(officialSearchUrl(), '_blank', 'noopener,noreferrer');
  });
  document.querySelectorAll('.copy-button').forEach((button) => {
    button.addEventListener('click', async () => {
      await copyTarget(button.dataset.copyTarget);
      const original = button.textContent;
      button.textContent = '已複製';
      setTimeout(() => { button.textContent = original; }, 1200);
    });
  });
}

init().catch((error) => {
  qs('#scenarioCards').innerHTML = `<div class="privacy-warning">資料載入失敗：${escapeHtml(error.message || error)}</div>`;
});
