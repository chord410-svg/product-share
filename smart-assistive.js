const state = {
  data: null,
  selectedScenario: null,
};

const qs = (selector) => document.querySelector(selector);
const scenarioSelect = qs('#scenarioSelect');
const purposeSelect = qs('#purposeSelect');
const caseText = qs('#caseText');
const privacyWarning = qs('#privacyWarning');

function lineList(items) {
  if (!items || !items.length) return '尚無資料。';
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function detectPrivacy(text) {
  const hits = [];
  if (/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/.test(text) || /0\d{1,2}[-\s]?\d{6,8}/.test(text)) hits.push('電話');
  if (/[A-Z][12]\d{8}/i.test(text)) hits.push('身分證字號');
  if (/(路|街|巷|弄|號|樓)/.test(text) && /(市|縣|區|鄉|鎮)/.test(text)) hits.push('完整地址');
  if (/(病歷|病歷號|就醫號|個案姓名|姓名)/.test(text)) hits.push('病歷或姓名');
  return [...new Set(hits)];
}

function sourceById(id) {
  return (state.data?.sources || []).find((source) => source.source_id === id);
}

function scenarioSummary(scenario) {
  const tags = (scenario.need_tags || []).slice(0, 3).join('、');
  const eis = (scenario.ei_categories || []).join(' / ') || '制度分流';
  return `${eis}${tags ? `｜${tags}` : ''}`;
}

function renderScenarioCards() {
  const container = qs('#scenarioCards');
  container.innerHTML = '';
  for (const scenario of state.data.scenarios) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'scenario-card';
    card.innerHTML = `
      <h3>${scenario.title}</h3>
      <p>${scenarioSummary(scenario)}</p>
      <div class="chips">${(scenario.need_tags || []).map((tag) => `<span class="chip">${tag}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => {
      scenarioSelect.value = scenario.scenario_id;
      selectScenario(scenario.scenario_id);
      renderOutputs();
      window.scrollTo({ top: qs('#resultPanel').offsetTop - 16, behavior: 'smooth' });
    });
    container.appendChild(card);
  }
}

function populateSelect() {
  scenarioSelect.innerHTML = '';
  for (const scenario of state.data.scenarios) {
    const option = document.createElement('option');
    option.value = scenario.scenario_id;
    option.textContent = scenario.title;
    scenarioSelect.appendChild(option);
  }
  selectScenario(state.data.scenarios[0]?.scenario_id);
}

function selectScenario(id) {
  state.selectedScenario = state.data.scenarios.find((scenario) => scenario.scenario_id === id) || state.data.scenarios[0];
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

function renderOutputs() {
  const scenario = state.selectedScenario;
  if (!scenario) return;
  const warning = privacyMessage();
  const note = caseText.value.trim() && !warning ? `\n\n本次補充描述：${caseText.value.trim()}` : '';
  const sources = (scenario.source_ids || []).map(sourceById).filter(Boolean);
  qs('#resultTitle').textContent = scenario.title;
  qs('#familyOutput').textContent = `${scenario.family_summary}\n\n提醒：這份整理是協助先了解方向，正式補助與核定仍以長照中心、輔具中心或主管機關確認為準。${note}`;
  qs('#cmOutput').textContent = [
    `情境：${scenario.title}`,
    `分類：${(scenario.ei_categories || []).join(' / ') || '制度分流'}`,
    '',
    lineList(scenario.case_manager_notes),
    '',
    `風險旗標：${(scenario.risk_flags || []).join('、') || '無'}`
  ].join('\n');
  qs('#phoneOutput').textContent = lineList(scenario.phone_check_questions);
  qs('#handoffOutput').textContent = [
    `交接摘要：${scenario.handoff_summary}`,
    '',
    '行政提醒：',
    lineList(scenario.administrative_notes)
  ].join('\n');
  qs('#sourceOutput').innerHTML = [
    `可信度：${scenario.confidence}`,
    `最後確認日：${scenario.last_checked_at}`,
    '',
    ...sources.map((source, index) => `${index + 1}. ${source.label}\n${source.url}`),
    '',
    '未確認的品牌、型號、價格平台與核銷流程只作待查線索，不進家屬版。'
  ].join('\n');
}

async function copyTarget(id) {
  const target = qs(`#${id}`);
  const text = target?.innerText || target?.textContent || '';
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

function officialSearch() {
  const scenario = state.selectedScenario;
  if (!scenario) return;
  const query = [
    '智慧科技輔具',
    '長照 3.0',
    scenario.title,
    ...(scenario.ei_categories || []),
    '衛福部',
    '1966'
  ].join(' ');
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
}

async function init() {
  try {
    const response = await fetch('smart-assistive-scenarios.json?v=20260611-smart-assistive-v1', { cache: 'no-store' });
    state.data = await response.json();
    populateSelect();
    renderScenarioCards();
    renderOutputs();
  } catch (error) {
    qs('#resultTitle').textContent = '資料載入失敗';
    qs('#familyOutput').textContent = '無法載入智能輔具情境資料，請稍後再試或回 Discord 回報。';
  }
}

scenarioSelect.addEventListener('change', () => { selectScenario(scenarioSelect.value); renderOutputs(); });
purposeSelect.addEventListener('change', renderOutputs);
caseText.addEventListener('input', privacyMessage);
qs('#generateButton').addEventListener('click', renderOutputs);
qs('#officialSearchButton').addEventListener('click', officialSearch);
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
