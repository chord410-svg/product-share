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

function uniqueList(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.flat().filter(Boolean)) {
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

function scenarioType(scenario) {
  const id = scenario.scenario_id;
  if (id === 'app_network_literacy') return '使用條件';
  if (id === 'system_boundary') return '制度分流';
  if (id === 'policy_overview') return '政策/額度';
  if (id === 'fall_watch') return '安全看視';
  if (id === 'transfer_mobility') return '移動/移位';
  if (id === 'bathing_toileting_bedcare') return '照顧操作';
  return '智慧輔具';
}

function eiLabel(scenario) {
  return (scenario.ei_categories || []).join(' / ') || '制度分流';
}

function renderSourceLinks(sources) {
  if (!sources.length) return '<div class="source-item">尚無來源資料。</div>';
  return sources.map((source, index) => {
    const url = safeUrl(source.url);
    const label = escapeHtml(source.label || `來源 ${index + 1}`);
    const link = url
      ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '<span class="source-meta">未提供可開啟網址</span>';
    return `<div class="source-item"><strong>${index + 1}. ${label}</strong>${link}</div>`;
  }).join('');
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

function selectedTagText(scenarios) {
  return uniqueList(scenarios.map((scenario) => scenario.need_tags || [])).slice(0, 10).join('、');
}

function updateSelectedCount() {
  const selected = selectedScenarios().length;
  const total = allScenarios().length;
  const count = qs('#selectedCount');
  if (count) count.textContent = `已選 ${selected}/${total} 個情境`;
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
    const tags = (scenario.need_tags || []).slice(0, 3);
    card.innerHTML = `
      <div class="card-top">
        <span class="card-type">${escapeHtml(scenarioType(scenario))}</span>
        <span class="select-mark">${selected ? '已選' : '點選'}</span>
      </div>
      <h3>${escapeHtml(scenario.title)}</h3>
      <p>${escapeHtml(eiLabel(scenario))}</p>
      <div class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => toggleScenario(scenario.scenario_id));
    container.appendChild(card);
  }
  updateSelectedCount();
}

function emptyOutputs() {
  qs('#resultTitle').textContent = '請先選擇一個或多個情境';
  qs('#summaryOutput').textContent = '請先選擇一個或多個智慧輔具情境，這裡會產生本案重點摘要。';
  qs('#familyOutput').textContent = '選擇情境後，這裡會整合成保守、可整理給家屬的說明。';
  qs('#cmOutput').textContent = '尚未選擇情境。';
  qs('#phoneOutput').textContent = '尚未選擇情境。';
  qs('#handoffOutput').textContent = '尚未選擇情境。';
  qs('#sourceOutput').innerHTML = '<span class="source-meta">尚未選擇情境。</span>';
}

function renderOutputs() {
  const warning = privacyMessage();
  const scenarios = selectedScenarios();
  if (!scenarios.length) {
    emptyOutputs();
    updateSelectedCount();
    return;
  }

  const titles = scenarios.map((scenario) => scenario.title);
  const categories = uniqueList(scenarios.map((scenario) => scenario.ei_categories || []));
  const tags = selectedTagText(scenarios);
  const risks = uniqueList(scenarios.map((scenario) => scenario.risk_flags || []));
  const note = caseText.value.trim() && !warning ? caseText.value.trim() : '';
  const sourceIds = uniqueList(scenarios.map((scenario) => scenario.source_ids || []));
  const sources = sourceIds.map(sourceById).filter(Boolean);

  qs('#resultTitle').textContent = `已整合 ${scenarios.length} 個智慧輔具情境`;
  qs('#summaryOutput').textContent = [
    `已選情境：${titles.join('、')}`,
    categories.length ? `可能涉及分類：${categories.join(' / ')}` : '可能涉及分類：制度分流或使用條件確認',
    tags ? `主要問題線索：${tags}` : '',
    note ? `本案補充：${note}` : '',
    '下一步：先釐清實際照顧問題、使用條件與官方評估流程，不直接承諾補助或特定品牌。'
  ].filter(Boolean).join('\n');

  qs('#familyOutput').textContent = [
    ...scenarios.map((scenario) => `【${scenario.title}】\n${scenario.family_summary}`),
    '提醒：這份整理是協助先了解智慧輔具方向，正式補助與核定仍以長照中心、輔具中心或主管機關確認為準。'
  ].join('\n\n');

  qs('#cmOutput').textContent = [
    `本案選到：${titles.join('、')}`,
    '',
    lineList(uniqueList(scenarios.map((scenario) => scenario.case_manager_notes || []))),
    '',
    `風險旗標：${risks.join('、') || '無'}`
  ].join('\n');

  qs('#phoneOutput').textContent = lineList(uniqueList(scenarios.map((scenario) => scenario.phone_check_questions || [])));
  qs('#handoffOutput').textContent = [
    '交接摘要：',
    lineList(uniqueList(scenarios.map((scenario) => scenario.handoff_summary || []))),
    '',
    '行政提醒：',
    lineList(uniqueList(scenarios.map((scenario) => scenario.administrative_notes || [])))
  ].join('\n');

  qs('#sourceOutput').innerHTML = `
    <div>可信度：${escapeHtml(uniqueList(scenarios.map((scenario) => scenario.confidence)).join('、') || '待確認')}</div>
    <div>最後確認日：${escapeHtml(uniqueList(scenarios.map((scenario) => scenario.last_checked_at)).join('、') || '未標示')}</div>
    <div class="source-list">${renderSourceLinks(sources)}</div>
    <p class="source-meta">長照 3.0、給付日期、額度與分類只作政策背景；未確認的品牌、型號、價格平台與核銷流程只作待查線索，不進家屬版。</p>
  `;
  updateSelectedCount();
}

async function copyTarget(id) {
  const target = qs(`#${id}`);
  const text = target?.innerText || target?.textContent || '';
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

function officialSearch() {
  const scenarios = selectedScenarios();
  const query = [
    '智慧科技輔具',
    '給付',
    '租賃',
    ...scenarios.map((scenario) => scenario.title),
    ...uniqueList(scenarios.map((scenario) => scenario.ei_categories || [])),
    '衛福部',
    '1966'
  ].join(' ');
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
}

function clearSelection() {
  state.selectedScenarioIds.clear();
  renderScenarioCards();
  renderOutputs();
}

async function init() {
  try {
    const response = await fetch('smart-assistive-scenarios.json?v=20260612-smart-assistive-v3', { cache: 'no-store' });
    state.data = await response.json();
    renderScenarioCards();
    renderOutputs();
  } catch (error) {
    qs('#resultTitle').textContent = '資料載入失敗';
    qs('#summaryOutput').textContent = '無法載入智慧輔具情境資料，請稍後再試或回 Discord 回報。';
  }
}

caseText.addEventListener('input', renderOutputs);
qs('#officialSearchButton').addEventListener('click', officialSearch);
qs('#clearSelectionButton').addEventListener('click', clearSelection);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy-target]');
  if (!button) return;
  copyTarget(button.dataset.copyTarget).then(() => {
    const old = button.textContent;
    button.textContent = '已複製';
    setTimeout(() => { button.textContent = old; }, 900);
  });
});

init();
