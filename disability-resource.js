const CACHE_VERSION = '20260614-knowledge-nav-v13';

const state = {
  scenarios: [],
  knowledgeCards: [],
  routeResult: null,
  selectedKnowledgeIds: new Set(),
  selectedCardSnapshots: new Map(),
  savedPackages: [],
  activePackageId: '',
  apiBase: '',
  sessionToken: '',
  apiReady: false,
  sessionUser: null,
  selectedRegions: new Set(['新北市', '中央共通']),
  outputMode: 'family',
  activeAttributeFilter: '',
  activeAttributeGroup: 'system_scope',
  activeAttributeSelections: {},
  currentKnowledgeCards: [],
  generationHistory: [],
  activeGenerationId: '',
  activeDetailCardId: '',
  currentDraftName: '',
  currentQuestionSummary: '',
};

const qs = (selector) => document.querySelector(selector);
const questionText = qs('#questionText');
const privacyWarning = qs('#privacyWarning');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => String(item ?? '').trim()) : [];
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.flat(Infinity).filter(Boolean)) {
    const value = String(item).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function lineList(items) {
  const rows = unique(items);
  if (!rows.length) return '尚無資料，請改用官方查證或電話確認。';
  return rows.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

const LABELS = {
  official_check_required: '需官方窗口查證',
  do_not_promise_subsidy: '不可承諾補助',
  preapproval_required: '可能需要事前核定',
  purchase_before_approval_risk: '先買再申請有風險',
  vendor_claim_requires_verification: '廠商說法需查證',
  document_required: '可能需要文件',
  home_environment_required: '需看居家環境',
  consumer_product_confusion: '商品宣稱易混淆',
  brand_claim_requires_verification: '品牌宣稱需查證',
  system_boundary_confusion: '長照／身障制度易混淆',
  do_not_replace_formal_assessment: '不能取代正式評估',
  multi_system_coordination: '需跨系統協調',
  do_not_over_simplify_disability_services: '身障服務不可簡化成單一路徑',
  safety_risk_screen_first: '先篩安全風險',
  no_diagnosis_or_medical_advice: '不做診斷或醫療建議',
  C: 'C 級研究線索',
  B: 'B 級受託／機構來源',
  A: 'A 級官方來源',
};

const COMPARISON_GROUP_LABELS = {
  assistive_stair_climber: '爬梯機／上下樓設備',
  assistive_wheelchair: '輪椅與移動輔具',
  home_accessibility_handrail: '居家扶手',
  home_accessibility_bathroom: '浴室改造',
  home_accessibility_ramp: '門檻／斜坡／動線改善',
  special_assistive_device: '智能／特殊輔具',
  process_preapproval: '事前核定與先購買風險',
  system_eligibility_difference: '身障證明／長照資格／CMS 差異',
  care_support_respite: '短期照顧與喘息支持',
  transport_access: '交通服務與復康巴士',
  family_support: '家庭照顧者支持',
  official_window: '官方窗口與電話確認',
  output_wording: '家屬版說法與輸出邊界',
};

const ATTRIBUTE_TYPE_LABELS = {
  system_scope: '系統',
  knowledge_type: '類型',
  region_scope: '地區',
  comparison_group: '同屬性',
};

function labelText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (LABELS[raw]) return LABELS[raw];
  if (/^[ABC]$/.test(raw)) return `${raw} 級來源`;
  if (/^[a-z0-9_:-]+$/.test(raw)) return raw.replaceAll('_', '／');
  return raw;
}

function cardId(card) {
  return String(card?.knowledge_id || card?.id || '').trim();
}

function cardById(id) {
  return state.knowledgeCards.find((card) => cardId(card) === id);
}

function comparisonGroup(card) {
  return String(card?.comparison_group || '').trim();
}

function comparisonGroupLabel(group, card = null) {
  const raw = String(group || comparisonGroup(card) || '').trim();
  return card?.comparison_group_label || COMPARISON_GROUP_LABELS[raw] || labelText(raw) || '未指定比較屬性';
}

function attributeKey(type, value) {
  return `${type}:${String(value || '').trim()}`;
}

function cardAttributes(card) {
  const attrs = [];
  for (const value of asArray(card.system_scope)) attrs.push({ type: 'system_scope', value, label: labelText(value), key: attributeKey('system_scope', value) });
  for (const value of asArray(card.knowledge_type)) attrs.push({ type: 'knowledge_type', value, label: labelText(value), key: attributeKey('knowledge_type', value) });
  for (const value of asArray(card.region_scope)) attrs.push({ type: 'region_scope', value, label: labelText(value), key: attributeKey('region_scope', value) });
  const group = comparisonGroup(card);
  if (group) attrs.push({ type: 'comparison_group', value: group, label: comparisonGroupLabel(group, card), key: attributeKey('comparison_group', group) });
  const seen = new Set();
  return attrs.filter((attr) => {
    if (!attr.value || seen.has(attr.key)) return false;
    seen.add(attr.key);
    return true;
  });
}

function extractAttributeFilters(cards = []) {
  const map = new Map();
  for (const card of cards) {
    for (const attr of cardAttributes(card)) {
      if (!map.has(attr.key)) map.set(attr.key, { ...attr, totalCount: 0, hitCount: 0 });
      map.get(attr.key).totalCount += 1;
    }
  }
  return [...map.values()].sort((a, b) => b.totalCount - a.totalCount || a.label.localeCompare(b.label, 'zh-Hant'));
}

function attributeCatalog() {
  return extractAttributeFilters(state.knowledgeCards || []);
}

function groupAttributeFilters(filters = []) {
  const groups = new Map();
  for (const attr of filters) {
    if (!groups.has(attr.type)) groups.set(attr.type, []);
    groups.get(attr.type).push(attr);
  }
  return groups;
}

function attributeHitMap(cards = []) {
  const hits = new Map();
  for (const card of cards) {
    for (const attr of cardAttributes(card)) {
      hits.set(attr.key, (hits.get(attr.key) || 0) + 1);
    }
  }
  return hits;
}

function selectedAttributeSet(type) {
  if (!state.activeAttributeSelections[type]) state.activeAttributeSelections[type] = new Set();
  return state.activeAttributeSelections[type];
}

function resetAttributeSelections(cards = []) {
  const hits = attributeHitMap(cards);
  const catalog = groupAttributeFilters(attributeCatalog());
  state.activeAttributeSelections = {};
  for (const [type, attrs] of catalog.entries()) {
    const selected = new Set(attrs.filter((attr) => hits.has(attr.key)).map((attr) => attr.key));
    if (selected.size) state.activeAttributeSelections[type] = selected;
  }
}

function cardsForAttributeSelection(fallbackCards = []) {
  const selected = selectedAttributeSet(state.activeAttributeGroup);
  if (!selected.size) return [];
  const selectedKeys = new Set(selected);
  const seedIds = new Set(fallbackCards.map(cardId));
  return (state.knowledgeCards || [])
    .filter((card) => cardAttributes(card).some((attr) => selectedKeys.has(attr.key)))
    .sort((a, b) => {
      const seedDelta = Number(seedIds.has(cardId(b))) - Number(seedIds.has(cardId(a)));
      if (seedDelta) return seedDelta;
      return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
    });
}

function sourceLevelSummary(card) {
  const refs = Array.isArray(card?.source_refs) ? card.source_refs : [];
  const levels = unique(refs.map((ref) => ref && ref.source_level).filter(Boolean));
  if (!levels.length) return '來源待補';
  return levels.map(labelText).join('、');
}

function firstLine(items, fallback = '待補查證內容') {
  const rows = unique(items);
  return rows[0] || fallback;
}

function renderAttributeFilters(cards = []) {
  const container = qs('#attributeFilters');
  if (!container) return;
  const catalog = attributeCatalog();
  if (!catalog.length) {
    container.innerHTML = '';
    return;
  }
  const hits = attributeHitMap(cards);
  const grouped = groupAttributeFilters(catalog.map((attr) => ({ ...attr, hitCount: hits.get(attr.key) || 0 })));
  if (!grouped.has(state.activeAttributeGroup)) {
    state.activeAttributeGroup = grouped.has('system_scope') ? 'system_scope' : catalog[0].type;
  }
  const typeOrder = ['system_scope', 'knowledge_type', 'region_scope', 'comparison_group'].filter((type) => grouped.has(type));
  const activeSubs = grouped.get(state.activeAttributeGroup) || [];
  const activeLabel = ATTRIBUTE_TYPE_LABELS[state.activeAttributeGroup] || '屬性';
  const selected = selectedAttributeSet(state.activeAttributeGroup);
  const selectedCount = activeSubs.filter((attr) => selected.has(attr.key)).length;
  const sortedActiveSubs = [...activeSubs].sort((a, b) => {
    const selectedDelta = Number(selected.has(b.key)) - Number(selected.has(a.key));
    if (selectedDelta) return selectedDelta;
    const hitDelta = Number(Boolean(b.hitCount)) - Number(Boolean(a.hitCount));
    if (hitDelta) return hitDelta;
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hant');
  });
  container.innerHTML = `
    <div class="attribute-filter-head">
      <span class="attribute-filter-label">屬性分類</span>
      <span class="small-note">${escapeHtml(activeLabel)}：${selectedCount}/${activeSubs.length} 已選子屬性</span>
    </div>
    <div class="attribute-main-tabs" data-count="${typeOrder.length}" aria-label="主屬性分類">
      ${typeOrder.map((type) => {
        const attrs = grouped.get(type) || [];
        const typeSelected = selectedAttributeSet(type);
        const typeSelectedCount = attrs.filter((attr) => typeSelected.has(attr.key)).length;
        return `
          <button type="button" class="attribute-main-button${state.activeAttributeGroup === type ? ' is-active' : ''}" data-attribute-type="${escapeHtml(type)}">
            <strong>${escapeHtml(ATTRIBUTE_TYPE_LABELS[type] || type)}</strong>
            <span>${typeSelectedCount}/${attrs.length} 已選</span>
          </button>
        `;
      }).join('')}
    </div>
    <div class="attribute-subchips" aria-label="${escapeHtml(activeLabel)}子屬性">
      ${sortedActiveSubs.map((attr) => {
        const isSelected = selected.has(attr.key);
        const countText = attr.hitCount ? `${attr.hitCount} 張` : `可擴 ${attr.totalCount} 張`;
        return `
          <button type="button" class="attribute-chip${isSelected ? ' is-active' : ''}${attr.hitCount ? ' is-hit' : ''}" data-attribute-key="${escapeHtml(attr.key)}" aria-pressed="${isSelected ? 'true' : 'false'}">
            <strong>${escapeHtml(attr.label)}</strong>
            <span>${escapeHtml(countText)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
  container.querySelectorAll('[data-attribute-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeAttributeGroup = button.dataset.attributeType || state.activeAttributeGroup;
      renderKnowledgeCards(state.currentKnowledgeCards || cards);
    });
  });
  container.querySelectorAll('[data-attribute-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.attributeKey || '';
      if (!key) return;
      const set = selectedAttributeSet(state.activeAttributeGroup);
      if (set.has(key)) set.delete(key); else set.add(key);
      renderKnowledgeCards(state.currentKnowledgeCards || cards);
    });
  });
}

function hasComparison(card) {
  const comparison = card?.comparison;
  return Boolean(comparison && typeof comparison === 'object' && Object.keys(comparison).length);
}

function detectPrivacy(text) {
  const hits = [];
  if (/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/.test(text) || /0\d{1,2}[-\s]?\d{6,8}/.test(text)) hits.push('電話');
  if (/[A-Z][12]\d{8}/i.test(text)) hits.push('身分證字號');
  if (/(路|街|巷|弄|號|樓)/.test(text) && /(市|縣|區|鄉|鎮)/.test(text)) hits.push('完整地址');
  if (/(病歷|病歷號|就醫號|個案姓名|姓名)/.test(text)) hits.push('病歷或姓名');
  return unique(hits);
}

function maskSensitiveText(text) {
  return String(text || '')
    .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '[電話已遮蔽]')
    .replace(/0\d{1,2}[-\s]?\d{6,8}/g, '[電話已遮蔽]')
    .replace(/[A-Z][12]\d{8}/gi, '[身分證字號已遮蔽]')
    .replace(/[\u4e00-\u9fa5]{2,4}(路|街|巷|弄)\d*[\u4e00-\u9fa5\d-]*號?/g, '[地址已遮蔽]')
    .trim()
    .slice(0, 160);
}

function statusLabel(status) {
  const labels = {
    draft: '草稿',
    result_pending: '結果產生中',
    result_ready: '已產生結果',
    result_failed: '結果失敗',
  };
  return labels[String(status || '').trim()] || '狀態待確認';
}

function formatDateTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '時間待確認';
  return new Date(value * 1000).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function historyStorageKey() {
  const userId = state.sessionUser?.id || '';
  if (userId) return `disability_knowledge_generations_user_${userId}`;
  if (state.sessionToken) return `disability_knowledge_generations_session_${state.sessionToken.slice(0, 12)}`;
  return 'disability_knowledge_generations_local';
}

function readGenerationHistory() {
  try {
    const raw = localStorage.getItem(historyStorageKey());
    const rows = JSON.parse(raw || '[]');
    state.generationHistory = Array.isArray(rows) ? rows.filter((row) => row && row.id).slice(0, 12) : [];
  } catch (error) {
    state.generationHistory = [];
  }
}

function writeGenerationHistory() {
  try {
    localStorage.setItem(historyStorageKey(), JSON.stringify(state.generationHistory.slice(0, 12)));
  } catch (error) {
    console.info('generation history storage failed', error);
  }
}

function cardIds(cards = []) {
  return unique(cards.map((card) => cardId(card)).filter(Boolean));
}

function todayLabel() {
  return new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-');
}

function defaultDraftName(question = '') {
  const summary = maskSensitiveText(question || '').replace(/\s+/g, ' ').slice(0, 22) || '未命名問題';
  const regions = selectedRegions();
  const region = regions[0] || '未指定地區';
  return `${region} / ${summary} / ${todayLabel()}`;
}

function setSelectedCards(cards = []) {
  state.selectedKnowledgeIds.clear();
  state.selectedCardSnapshots.clear();
  for (const card of cards) {
    const id = cardId(card);
    if (!id) continue;
    state.selectedKnowledgeIds.add(id);
    state.selectedCardSnapshots.set(id, card);
  }
}

function renderDraftContext(message = '') {
  const input = qs('#draftNameInput');
  const status = qs('#draftStatus');
  if (input) {
    const name = state.currentDraftName || '尚未產生知識副本';
    if (document.activeElement !== input) input.value = name;
  }
  if (status) {
    const cards = selectedCards();
    const base = cards.length
      ? `目前副本含 ${cards.length} 張已選知識卡。`
      : '輸入問題並尋找知識卡後，系統會先建立目前正在編輯的知識副本。';
    status.textContent = message || base;
  }
}

function currentDraftName() {
  const input = qs('#draftNameInput');
  const value = String(input?.value || '').trim();
  return value && value !== '尚未產生知識副本' ? value : (state.currentDraftName || defaultDraftName(questionText.value || ''));
}

function startCurrentDraft({ question, directions = [], cards = [], source = 'local' }) {
  state.activePackageId = '';
  state.currentQuestionSummary = maskSensitiveText(question || '');
  state.currentDraftName = defaultDraftName(question);
  setSelectedCards(cards);
  addGenerationRecord({ question, directions, cards, source });
  renderDraftContext(`已產生目前副本：${state.currentDraftName}，並自動加入 ${cards.length} 張知識卡。`);
  renderOutputs();
}

function clearCurrentDraft() {
  state.selectedKnowledgeIds.clear();
  state.selectedCardSnapshots.clear();
  state.activePackageId = '';
  state.currentDraftName = '';
  state.currentQuestionSummary = '';
  renderKnowledgeCards(state.currentKnowledgeCards || []);
  renderOutputs();
  renderDraftContext('已清除目前副本；最近查詢紀錄仍保留在我的知識組合。');
}

function addGenerationRecord({ question, directions = [], cards = [], source = 'local' }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const directionIds = unique(directions.map((row) => row.direction_id || row.scenario_id || row.id).filter(Boolean));
  const record = {
    id,
    createdAt: Math.floor(Date.now() / 1000),
    questionSummary: maskSensitiveText(question || '未保存問題摘要'),
    regionScope: selectedRegions(),
    directionIds,
    cardIds: cardIds(cards),
    cardTitles: cards.slice(0, 3).map((card) => String(card.title || cardId(card))).filter(Boolean),
    source,
  };
  state.activeGenerationId = id;
  state.generationHistory = [record, ...state.generationHistory.filter((row) => row.id !== id)].slice(0, 12);
  writeGenerationHistory();
  renderGenerationHistory();
}

function generationCards(record) {
  const ids = Array.isArray(record?.cardIds) ? record.cardIds : [];
  return ids.map((id) => cardById(id)).filter(Boolean);
}

function generationDirections(record) {
  const ids = Array.isArray(record?.directionIds) ? record.directionIds : [];
  return ids.map((id) => ({
    direction_id: id,
    short_label: scenarioById(id)?.short_label || id,
    reason: '此方向來自先前生成紀錄。',
  }));
}

function renderGenerationHistory() {
  const container = qs('#generationHistory');
  if (!container) return;
  if (!state.generationHistory.length) {
    container.innerHTML = '<div class="empty-state">尚無生成紀錄。每次尋找知識卡後，這裡會保留最近紀錄，方便回到前一次結果。</div>';
    return;
  }
  container.innerHTML = state.generationHistory.map((record) => {
    const titles = Array.isArray(record.cardTitles) && record.cardTitles.length ? record.cardTitles.join('、') : '尚未命中知識卡';
    const regions = Array.isArray(record.regionScope) && record.regionScope.length ? record.regionScope.join('、') : '地區不限';
    return `
      <button type="button" class="history-card${record.id === state.activeGenerationId ? ' is-active' : ''}" data-generation-id="${escapeHtml(record.id)}">
        <strong>${escapeHtml(record.questionSummary || '未保存問題摘要')}</strong>
        <span>${escapeHtml(formatDateTime(record.createdAt))}｜${escapeHtml(regions)}｜${escapeHtml(titles)}</span>
      </button>
    `;
  }).join('');
  container.querySelectorAll('[data-generation-id]').forEach((button) => {
    button.addEventListener('click', () => applyGenerationRecord(button.dataset.generationId || ''));
  });
}

function applyGenerationRecord(id) {
  const record = state.generationHistory.find((row) => row.id === id);
  if (!record) return;
  const cards = generationCards(record);
  const directions = generationDirections(record);
  state.activeGenerationId = record.id;
  state.activePackageId = '';
  state.currentQuestionSummary = record.questionSummary || '';
  state.currentDraftName = defaultDraftName(record.questionSummary || '');
  state.routeResult = { directions, direction_ids: record.directionIds || [], knowledge_cards: cards };
  setSelectedCards(cards);
  renderDirections(directions);
  renderKnowledgeCards(cards.length ? cards : state.knowledgeCards.slice(0, 8), { resetAttributes: true });
  renderOutputs();
  renderDraftContext(`已載入最近查詢：${record.questionSummary || '未保存問題摘要'}。`);
  renderGenerationHistory();
}

function privacyMessage() {
  const hits = detectPrivacy(questionText.value || '');
  if (!hits.length) {
    privacyWarning.hidden = true;
    privacyWarning.textContent = '';
    return '';
  }
  const text = `偵測到可能的個資：${hits.join('、')}。請先移除後再分流；本工具不處理姓名、電話、完整地址、身分證或病歷號。`;
  privacyWarning.hidden = false;
  privacyWarning.textContent = text;
  return text;
}

function params() {
  return new URLSearchParams(window.location.search);
}

function selectedRegions() {
  return [...state.selectedRegions].filter(Boolean);
}

function renderRegionSelectLabel() {
  const button = qs('#regionSelectButton');
  if (!button) return;
  const regions = selectedRegions();
  button.textContent = regions.length ? `地區：${regions.join('、')}` : '地區：不限';
}

function setupRegionSelector() {
  const button = qs('#regionSelectButton');
  const menu = qs('#regionSelectMenu');
  if (!button || !menu) return;
  const sync = () => {
    const checked = [...menu.querySelectorAll('input[name="regionScope"]:checked')].map((input) => input.value);
    state.selectedRegions = new Set(checked);
    renderRegionSelectLabel();
  };
  menu.querySelectorAll('input[name="regionScope"]').forEach((input) => input.addEventListener('change', sync));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const hidden = menu.hidden;
    menu.hidden = !hidden;
    button.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  });
  document.addEventListener('click', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || button.contains(event.target)) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
  sync();
}

async function probeSession() {
  const badge = qs('#loginBadge');
  if (!badge) return;
  if (!state.sessionToken) {
    badge.textContent = '未透過 Discord 入口開啟';
    return;
  }
  if (!state.apiBase) {
    badge.textContent = 'Discord 連結待驗證';
    return;
  }
  try {
    const payload = await fetchJson(apiPath(`/api/v1/resource/session?token=${encodeURIComponent(state.sessionToken)}`), { cache: 'no-store' });
    const user = payload.user || {};
    const userName = user.name || user.user_name || user.username || 'Discord 使用者';
    const userId = user.id || user.user_id || '';
    state.sessionUser = { name: userName, id: String(userId || '') };
    badge.textContent = `已連結 Discord：${userName}${userId ? ` / ${userId}` : ''}`;
  } catch (error) {
    state.sessionUser = null;
    badge.textContent = 'Discord 連結待重新驗證';
  }
}

async function loadRuntime() {
  const query = params();
  state.sessionToken = query.get('session') || query.get('token') || '';
  const apiFromQuery = query.get('api_base') || '';
  if (apiFromQuery) {
    state.apiBase = apiFromQuery.replace(/\/$/, '');
    return;
  }
  try {
    const response = await fetch(`resource-nav-runtime.json?v=${CACHE_VERSION}`, { cache: 'no-store' });
    if (!response.ok) return;
    const runtime = await response.json();
    if (runtime.api_base) state.apiBase = String(runtime.api_base).replace(/\/$/, '');
  } catch (error) {
    state.apiBase = '';
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function apiPath(path) {
  return `${state.apiBase}${path}`;
}

async function loadData() {
  const [scenarioResponse, knowledgeResponse] = await Promise.all([
    fetch(`disability-resource-scenarios.json?v=${CACHE_VERSION}`, { cache: 'no-store' }),
    fetch(`disability-knowledge-cards.json?v=${CACHE_VERSION}`, { cache: 'no-store' }),
  ]);
  const scenarioPayload = await scenarioResponse.json();
  const knowledgePayload = await knowledgeResponse.json();
  state.scenarios = scenarioPayload.scenarios || [];
  state.knowledgeCards = knowledgePayload.knowledge_cards || [];
}

async function probeApi() {
  if (!state.apiBase) {
    qs('#apiStatus').textContent = '後端服務未設定，可先瀏覽知識卡。';
    return;
  }
  try {
    const response = await fetch(apiPath('/healthz'), { cache: 'no-store' });
    state.apiReady = response.ok;
    qs('#apiStatus').textContent = response.ok
      ? `後端服務已連線：${state.apiBase}`
      : `後端服務暫時不可用：${state.apiBase}`;
  } catch (error) {
    state.apiReady = false;
    qs('#apiStatus').textContent = `後端服務暫時不可用：${state.apiBase}`;
  }
}

function scenarioById(id) {
  return state.scenarios.find((row) => row.scenario_id === id);
}

function selectedCards() {
  const cards = [];
  for (const id of state.selectedKnowledgeIds) {
    cards.push(state.selectedCardSnapshots.get(id) || cardById(id) || { knowledge_id: id, id, title: id });
  }
  return cards;
}

function keywordScore(card, query, directionIds = [], regionHints = []) {
  const text = [
    card.title,
    ...(card.directions || []),
    ...(card.question_patterns || []),
    ...(card.applies_when || []),
    ...(card.verification_steps || []),
    ...(card.phone_check_questions || []),
    card.family_safe_summary,
    JSON.stringify(card.comparison || {}),
  ].join(' ');
  const terms = unique(String(query || '').split(/[，、。；;：:\s/／（）()「」『』,.!?？!]+/).filter((term) => term.length >= 2));
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 2;
    if (String(card.title || '').includes(term)) score += 4;
  }
  if ((card.directions || []).some((id) => directionIds.includes(id))) score += 6;
  const regions = asArray(card.region_scope);
  if (regionHints.length && regions.some((region) => regionHints.includes(region))) score += 3;
  return score;
}

function localKnowledgeSearch(query, directionIds = [], limit = 8, regionHints = selectedRegions()) {
  return state.knowledgeCards
    .map((card) => ({ card, score: keywordScore(card, query, directionIds, regionHints) }))
    .filter((row) => row.score > 0 || directionIds.some((id) => (row.card.directions || []).includes(id)))
    .sort((a, b) => b.score - a.score || String(a.card.title).localeCompare(String(b.card.title), 'zh-Hant'))
    .slice(0, limit)
    .map((row) => ({ ...row.card, match_reason: '本頁本地知識卡比對', similarity: Math.min(0.9, 0.35 + row.score / 30) }));
}

function renderDirections(directions = []) {
  const container = qs('#directionCards');
  const status = qs('#directionStatus');
  if (!directions.length) {
    if (status) status.textContent = '輸入問題後會顯示方向；後端服務不通時仍可使用本頁知識卡。';
    container.innerHTML = '';
    return;
  }
  if (status) status.textContent = `已找到 ${directions.length} 個方向，請從下方候選知識卡挑選。`;
  container.innerHTML = directions.map((row) => {
    const id = row.direction_id || row.scenario_id;
    const scenario = scenarioById(id) || {};
    return `
      <article class="direction-card">
        <div class="card-title">${escapeHtml(row.short_label || scenario.short_label || row.title || scenario.title || id)}</div>
        <div class="card-desc">${escapeHtml(row.reason || scenario.care_manager_goal || '依問題方向分流，需再由知識卡與官方來源查證。')}</div>
        <div class="card-tags">${asArray(scenario.risk_flags || row.risk_flags).slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(labelText(tag))}</span>`).join('')}</div>
      </article>
    `;
  }).join('');
}

function listHtml(items, fallback = '尚無資料。') {
  const rows = unique(items);
  if (!rows.length) return `<p class="muted">${escapeHtml(fallback)}</p>`;
  return `<ol class="detail-list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
}

function valueHtml(value, fallback = '尚無資料。') {
  const text = String(value || '').trim();
  return text ? escapeHtml(text) : `<span class="muted">${escapeHtml(fallback)}</span>`;
}

function sourceRefs(card) {
  return Array.isArray(card?.source_refs) ? card.source_refs.filter((ref) => ref && typeof ref === 'object') : [];
}

const SOURCE_LEVEL_LABELS = {
  A: 'A級官方來源',
  B: 'B級機構來源',
  C: 'C級研究線索',
};

function sourceLevelLabel(level) {
  const key = String(level || '').trim().toUpperCase();
  return SOURCE_LEVEL_LABELS[key] || labelText(level || '未分級來源');
}

function sourceRank(ref) {
  const key = String(ref?.source_level || '').trim().toUpperCase();
  const base = key === 'A' ? 0 : key === 'B' ? 1 : key === 'C' ? 2 : 3;
  return base + (ref?.public_allowed === false ? 10 : 0);
}

function bestSourceRef(card) {
  const refs = sourceRefs(card);
  if (!refs.length) return null;
  return [...refs].sort((a, b) => {
    const rankDelta = sourceRank(a) - sourceRank(b);
    if (rankDelta) return rankDelta;
    return String(a.title || a.source_id || '').localeCompare(String(b.title || b.source_id || ''), 'zh-Hant');
  })[0];
}

function sourceDisplaySummary(card) {
  const refs = sourceRefs(card);
  const best = bestSourceRef(card);
  if (!best) return '來源：待補官方來源｜僅供內部查證';
  const sourceName = best.title || best.source_id || '未命名來源';
  const otherCount = Math.max(0, refs.length - 1);
  const suffix = otherCount ? `｜另有 ${otherCount} 筆來源` : '';
  return `來源：${sourceName}｜${sourceLevelLabel(best.source_level)}${suffix}`;
}

function sourceLinkHtml(ref) {
  const title = ref?.title || ref?.source_id || '官方來源';
  const url = String(ref?.url || '');
  if (/^https?:\/\//.test(url)) {
    return `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
  }
  return escapeHtml(title);
}

function listCardSummary(card) {
  const raw = card.knowledge_brief
    || card.public_summary
    || card.family_safe_summary
    || card.match_reason
    || asArray(card.question_patterns).slice(0, 2).join('、');
  const text = compactSentence(raw);
  if (!text) return '此卡提供查證方向；正式說明仍需回到官方來源或承辦窗口確認。';
  return text.length > 96 ? `${text.slice(0, 94)}…` : text;
}

function detailHeaderTags(card) {
  const regions = asArray(card.region_scope).map(labelText).filter(Boolean);
  const subtypes = asArray(card.knowledge_type).map(labelText).filter(Boolean);
  const source = bestSourceRef(card);
  const labels = unique([
    regions[0] || '',
    subtypes[0] || comparisonGroupLabel(comparisonGroup(card), card),
    source ? sourceLevelLabel(source.source_level) : '來源待補',
  ].filter(Boolean)).slice(0, 3);
  return labels.map((label) => `<span class="mini-source-pill">${escapeHtml(label)}</span>`).join('');
}

function sourceDetailHtml(card) {
  const refs = sourceRefs(card);
  if (!refs.length) return '<p class="muted">此卡尚未登錄來源；請依官方窗口補查。</p>';
  return refs.map((ref, index) => {
    const url = String(ref.url || '');
    const link = /^https?:\/\//.test(url)
      ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '<span class="muted">未提供可開啟網址</span>';
    return `
      <div class="detail-field detail-source">
        <strong>${index + 1}. ${escapeHtml(ref.title || ref.source_id || '來源')}</strong>
        <span>來源等級：${escapeHtml(sourceLevelLabel(ref.source_level))}｜確認日：${escapeHtml(ref.last_checked_at || '待確認')}</span>
        ${link}
      </div>
    `;
  }).join('');
}

function compactSentence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function firstText(items, fallback = '') {
  return compactSentence(asArray(items)[0] || fallback);
}

function knowledgeExplanationHtml(card) {
  const explicit = compactSentence(card.care_manager_explanation || card.knowledge_brief || '');
  if (explicit) return `<p>${escapeHtml(explicit)}</p>`;

  const source = bestSourceRef(card);
  const sourceLead = source ? `根據 ${sourceLinkHtml(source)}，` : '依目前卡片資料，';
  const comparison = card?.comparison || {};
  const family = compactSentence(card.family_safe_summary || comparison.family_wording || '');
  const main = family || '這類問題需先回到官方品項、地方承辦流程、必要文件與窗口確認，不能直接下資格或金額結論。';
  const operation = compactSentence(firstText(
    card.care_manager_notes || card.internal_notes || card.verification_steps,
    '個管師可先整理需求情境，再依官方窗口確認是否需事前核定、評估文件或地方承辦流程。'
  ));
  return `
    <p>${sourceLead}${escapeHtml(main)}</p>
    <p>${escapeHtml(operation)}</p>
  `;
}

function applicabilityHtml(card) {
  return `
    <div class="detail-grid">
      <div class="detail-field"><strong>適用情境</strong>${listHtml(card.applies_when || [], '尚未標示適用情境。')}</div>
      <div class="detail-field"><strong>不適用情境</strong>${listHtml(card.not_applies_when || [], '尚未標示排除情境。')}</div>
    </div>
  `;
}

function verificationDetailHtml(card) {
  return `
    <div class="detail-grid">
      <div class="detail-field"><strong>查證步驟</strong>${listHtml(card.verification_steps || [], '請先回官方窗口查證。')}</div>
      <div class="detail-field"><strong>承辦／窗口提示</strong>${valueHtml(card.care_manager_notes || card.internal_notes || '', '請依官方窗口與地方承辦規定確認。')}</div>
    </div>
  `;
}

function phoneDetailHtml(card) {
  return `<div class="detail-field">${listHtml(card.phone_check_questions || [], '請確認承辦窗口、文件、是否需事前核定。')}</div>`;
}

function sourceTrackingHtml(card) {
  return `
    <div class="detail-grid">
      ${sourceDetailHtml(card)}
      <div class="detail-field"><strong>卡片 ID</strong>${escapeHtml(cardId(card) || '未標示')}</div>
      <div class="detail-field"><strong>公開輸出</strong>${card.public_allowed === false ? '僅內部查證，不進家屬版正式說明' : '可作家屬版保守說明素材'}</div>
    </div>
  `;
}

function detailTabButton(id, label, active = false) {
  return `<button class="detail-tab-button${active ? ' is-active' : ''}" type="button" data-detail-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function detailTabPanel(id, content, active = false) {
  return `<section class="detail-tab-panel" data-detail-panel="${escapeHtml(id)}"${active ? '' : ' hidden'}>${content}</section>`;
}

function detailTabsHtml(card) {
  const tabs = [
    ['summary', '知識整理', `
      <section class="detail-section detail-brief-section">
        <p class="eyebrow">知識整理</p>
        <h3>政策、做法與條件邊界</h3>
        <div class="detail-brief">${knowledgeExplanationHtml(card)}</div>
      </section>
    `],
    ['applicability', '適用／不適用', applicabilityHtml(card)],
    ['verification', '查證路徑', verificationDetailHtml(card)],
    ['phone', '電話確認', phoneDetailHtml(card)],
    ['sources', '來源', sourceTrackingHtml(card)],
  ];
  return `
    <div class="detail-tab-list" role="tablist" aria-label="詳細卡片資訊分類">
      ${tabs.map(([id, label], index) => detailTabButton(id, label, index === 0)).join('')}
    </div>
    <div class="detail-tab-panels">
      ${tabs.map(([id, , content], index) => detailTabPanel(id, content, index === 0)).join('')}
    </div>
  `;
}

function bindDetailTabs(container) {
  container.querySelectorAll('.detail-tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.detailTab || '';
      container.querySelectorAll('.detail-tab-button').forEach((node) => {
        node.classList.toggle('is-active', node === button);
      });
      container.querySelectorAll('.detail-tab-panel').forEach((panel) => {
        panel.hidden = panel.dataset.detailPanel !== tab;
      });
    });
  });
}

function openCardDetail(card) {
  if (!card) return;
  state.activeDetailCardId = cardId(card);
  const overlay = qs('#cardDetailOverlay');
  const title = qs('#cardDetailTitle');
  const body = qs('#cardDetailContent');
  title.innerHTML = `
    <span>${escapeHtml(card.title || cardId(card) || '知識卡資訊')}</span>
    <span class="detail-title-tags">${detailHeaderTags(card)}</span>
  `;
  body.innerHTML = detailTabsHtml(card);
  bindDetailTabs(body);
  overlay.hidden = false;
}

function closeCardDetail() {
  const overlay = qs('#cardDetailOverlay');
  if (overlay) overlay.hidden = true;
  state.activeDetailCardId = '';
}

function toggleKnowledgeCard(id, card) {
  if (!id) return;
  if (state.selectedKnowledgeIds.has(id)) {
    state.selectedKnowledgeIds.delete(id);
    state.selectedCardSnapshots.delete(id);
  } else {
    state.selectedKnowledgeIds.add(id);
    const snapshot = card || cardById(id);
    if (snapshot) state.selectedCardSnapshots.set(id, snapshot);
  }
  renderKnowledgeCards(state.currentKnowledgeCards || []);
  renderOutputs();
}

function renderKnowledgeCards(cards = [], options = {}) {
  const container = qs('#knowledgeCards');
  state.currentKnowledgeCards = cards;
  if (options.resetAttributes) resetAttributeSelections(cards);
  renderAttributeFilters(cards);
  if (!cards.length) {
    container.innerHTML = '<div class="empty-state">尚無知識卡候選。請換一種問法，或先從下方既有知識卡手動挑選。</div>';
    return;
  }
  const visibleCards = cardsForAttributeSelection(cards);
  if (!visibleCards.length) {
    container.innerHTML = '<div class="empty-state">目前選取的子屬性沒有知識卡；請點選其他子屬性擴大範圍。</div>';
    return;
  }
  container.innerHTML = visibleCards.map((card) => {
    const id = card.knowledge_id || card.id;
    const selected = state.selectedKnowledgeIds.has(id);
    const summaryText = listCardSummary(card);
    return `
      <article class="knowledge-card${selected ? ' selected' : ''}" data-card-id="${escapeHtml(id)}" role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(card.title || id)}</h3>
          </div>
          <span class="confidence">${selected ? '已加入' : '候選卡'}</span>
        </div>
        <p class="summary">${escapeHtml(summaryText)}</p>
        <p class="source-summary">${escapeHtml(sourceDisplaySummary(card))}</p>
        <div class="package-actions">
          <button class="detail-card-button" type="button" data-card-id="${escapeHtml(id)}">詳細卡片資訊</button>
        </div>
      </article>
    `;
  }).join('');
  container.querySelectorAll('.knowledge-card').forEach((node) => {
    const id = node.dataset.cardId || '';
    const card = visibleCards.find((row) => cardId(row) === id) || cards.find((row) => cardId(row) === id) || cardById(id);
    node.addEventListener('click', (event) => {
      if (event.target.closest('button, a, summary, details, input, select, textarea')) return;
      toggleKnowledgeCard(id, card);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleKnowledgeCard(id, card);
    });
  });
  container.querySelectorAll('.detail-card-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.cardId || '';
      openCardDetail(visibleCards.find((row) => cardId(row) === id) || cards.find((row) => cardId(row) === id) || cardById(id));
    });
  });
}

function comparisonGroups(cards) {
  const groups = new Map();
  const notComparable = [];
  for (const card of cards) {
    const group = comparisonGroup(card);
    if (!group || !hasComparison(card)) {
      notComparable.push(card);
      continue;
    }
    const comparison = card.comparison || {};
    if (!groups.has(group)) {
      groups.set(group, {
        group,
        label: comparisonGroupLabel(group, card),
        cards: [],
      });
    }
    groups.get(group).cards.push({
      title: card.title || cardId(card),
      ltc: comparison.ltc_side || {},
      disability: comparison.disability_side || {},
      risks: comparison.shared_risks || card.risk_flags || [],
      family: comparison.family_wording || card.family_safe_summary || '',
    });
  }
  return { groups: [...groups.values()], notComparable };
}

function renderComparison(cards) {
  const container = qs('#comparisonOutput');
  const { groups, notComparable } = comparisonGroups(cards);
  if (!cards.length) {
    container.innerHTML = '<div class="empty-state">加入知識卡後，這裡會依同屬性分組整理長照側、身障側與共同風險。</div>';
    return;
  }
  if (!groups.length) {
    container.innerHTML = `
      <div class="empty-state">目前選取的知識卡沒有可比較欄位；仍可使用家屬版、電話確認與內部提醒。</div>
      ${notComparable.length ? `<div class="not-comparable-list">${notComparable.map((card) => `<span>${escapeHtml(card.title || cardId(card))}</span>`).join('')}</div>` : ''}
    `;
    return;
  }
  const groupHtml = groups.map((group) => `
    <article class="comparison-card">
      <div class="comparison-group-title">
        <div>
          <p class="eyebrow">同屬性比較</p>
          <h3>${escapeHtml(group.label)}</h3>
        </div>
        <span class="tag compare-tag">${escapeHtml(group.group)}</span>
      </div>
      <p class="comparison-group-note">只合併 comparison_group 相同的知識卡；不同屬性的知識卡會分開顯示，避免把制度流程硬湊成一張表。</p>
      ${group.cards.map((row) => `
        <section class="comparison-item">
          <h4>${escapeHtml(row.title)}</h4>
          <div class="compare-columns">
            <div><strong>長照側</strong><p>${escapeHtml(row.ltc.path || '先查長照服務項目與地方承辦流程。')}</p><p class="muted">${escapeHtml(row.ltc.window || '')}</p></div>
            <div><strong>身障側</strong><p>${escapeHtml(row.disability.path || '再查身障福利、輔具中心或地方社會局窗口。')}</p><p class="muted">${escapeHtml(row.disability.window || '')}</p></div>
          </div>
          <p><strong>共同風險：</strong>${escapeHtml(asArray(row.risks).map(labelText).join('、') || '需官方確認。')}</p>
          <p><strong>家屬說法：</strong>${escapeHtml(row.family || '請以官方窗口確認後，再提供保守說明。')}</p>
        </section>
      `).join('')}
    </article>
  `).join('');
  const skippedHtml = notComparable.length
    ? `<div class="empty-state">以下知識卡不適用長照 VS 身障比較：${notComparable.map((card) => escapeHtml(card.title || cardId(card))).join('、')}</div>`
    : '';
  container.innerHTML = groupHtml + skippedHtml;
}

function renderPackage(cards) {
  const container = qs('#packageCards');
  qs('#selectedCount').textContent = `已選 ${cards.length} 張知識卡`;
  if (!cards.length) {
    container.innerHTML = '<div class="empty-state">尚未加入知識卡。可從上方候選卡加入。</div>';
    return;
  }
  container.innerHTML = cards.map((card, index) => `
    <div class="package-item">
      <span>${index + 1}. ${escapeHtml(card.title || card.knowledge_id)}</span>
      <button class="remove-package-button" type="button" data-card-id="${escapeHtml(card.knowledge_id || card.id)}">移除</button>
    </div>
  `).join('');
  container.querySelectorAll('.remove-package-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedKnowledgeIds.delete(button.dataset.cardId);
      state.selectedCardSnapshots.delete(button.dataset.cardId);
      renderKnowledgeCards(state.routeResult?.knowledge_cards || localKnowledgeSearch(questionText.value));
      renderOutputs();
      renderDraftContext();
    });
  });
}

function packageSnapshots(record) {
  return asArray(record.items)
    .map((item) => item.knowledge_snapshot)
    .filter((snapshot) => snapshot && (snapshot.knowledge_id || snapshot.id));
}

function renderSavedPackages() {
  const container = qs('#savedPackages');
  if (!container) return;
  if (!state.sessionToken) {
    container.innerHTML = '<div class="empty-state">從 Discord 面板開啟後，這裡會顯示你的草稿與已產生結果。</div>';
    return;
  }
  if (!state.apiReady) {
    container.innerHTML = '<div class="empty-state">後端服務暫時不可用；可先閱讀與組合知識卡，但無法載入已儲存知識組合。</div>';
    return;
  }
  if (!state.savedPackages.length) {
    container.innerHTML = '<div class="empty-state">目前尚未儲存知識組合。選卡後可按「儲存草稿」。</div>';
    return;
  }
  container.innerHTML = state.savedPackages.map((record) => {
    const count = asArray(record.items).length || asArray(record.knowledge_ids).length;
    const active = state.activePackageId === record.package_id;
    return `
      <article class="saved-package-card${active ? ' active' : ''}">
        <div>
          <strong>${escapeHtml(record.name || '未命名知識組合')}</strong>
          <p class="small-note">${escapeHtml(statusLabel(record.status))}｜${count} 張知識卡｜更新 ${escapeHtml(formatDateTime(record.updated_at))}</p>
          <p class="saved-summary">${escapeHtml(record.question_summary || '未保存問題摘要')}</p>
        </div>
        <button class="load-package-button" type="button" data-package-id="${escapeHtml(record.package_id)}">載入</button>
      </article>
    `;
  }).join('');
  container.querySelectorAll('.load-package-button').forEach((button) => {
    button.addEventListener('click', () => applySavedPackage(button.dataset.packageId));
  });
}

function applySavedPackage(packageId) {
  const record = state.savedPackages.find((item) => item.package_id === packageId);
  if (!record) return;
  const snapshots = packageSnapshots(record);
  state.selectedKnowledgeIds.clear();
  state.selectedCardSnapshots.clear();
  for (const snapshot of snapshots) {
    const id = cardId(snapshot);
    if (!id) continue;
    state.selectedKnowledgeIds.add(id);
    state.selectedCardSnapshots.set(id, snapshot);
  }
  state.activePackageId = record.package_id;
  state.currentDraftName = record.name || '未命名知識組合';
  state.currentQuestionSummary = record.question_summary || '';
  if (record.question_summary && !questionText.value.trim()) {
    questionText.value = record.question_summary;
  }
  state.routeResult = {
    direction_ids: asArray(record.direction_ids),
    directions: asArray(record.direction_ids).map((id) => ({
      direction_id: id,
      short_label: scenarioById(id)?.short_label || id,
      reason: '此方向來自已儲存的知識組合。',
    })),
    knowledge_cards: snapshots,
  };
  renderDirections(state.routeResult.directions);
  renderKnowledgeCards(snapshots.length ? snapshots : state.knowledgeCards.slice(0, 8), { resetAttributes: true });
  renderSavedPackages();
  renderOutputs();
  renderDraftContext(`已載入「${record.name || '知識組合'}」；目前正在編輯這份副本。`);
  qs('#packageHint').textContent = `已載入「${record.name || '知識組合'}」；輸出內容使用建立當時保存的知識卡副本。`;
}

async function loadSavedPackages({ quiet = false } = {}) {
  if (!state.sessionToken || !state.apiBase || !state.apiReady) {
    renderSavedPackages();
    return;
  }
  try {
    const payload = await fetchJson(`${apiPath('/api/v1/disability-knowledge/packages')}?session=${encodeURIComponent(state.sessionToken)}`);
    state.savedPackages = asArray(payload.packages);
    renderSavedPackages();
    if (!quiet && state.savedPackages.length) {
      qs('#packageHint').textContent = `已載入 ${state.savedPackages.length} 筆你先前建立的知識組合。`;
    }
  } catch (error) {
    state.savedPackages = [];
    renderSavedPackages();
    if (!quiet) qs('#packageHint').textContent = `載入既有知識組合失敗：${error.message || error}`;
  }
}

function setActiveView(viewName) {
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const active = panel.id === `${viewName}View`;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
}

function setupTabs() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  });
}

function setOutputMode(mode) {
  state.outputMode = mode || 'family';
  document.querySelectorAll('[data-output-mode]').forEach((button) => {
    const active = button.dataset.outputMode === state.outputMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-output-section]').forEach((section) => {
    const modes = String(section.dataset.outputSection || '').split(/\s+/).filter(Boolean);
    section.hidden = !modes.includes(state.outputMode);
  });
}

function setupOutputModeTabs() {
  document.querySelectorAll('[data-output-mode]').forEach((button) => {
    button.addEventListener('click', () => setOutputMode(button.dataset.outputMode));
  });
}

function renderSources(cards) {
  const refs = unique(cards.flatMap((card) => sourceRefs(card).map((ref) => JSON.stringify(ref))));
  if (!refs.length) return '<div class="source-item">尚無來源；請依卡片內容回到官方窗口查證。</div>';
  return refs.map((raw, index) => {
    let ref = {};
    try { ref = JSON.parse(raw); } catch (error) { ref = {}; }
    const url = String(ref.url || '');
    const link = /^https?:\/\//.test(url)
      ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '<span>未提供可開啟網址</span>';
    return `<div class="source-item"><strong>${index + 1}. ${escapeHtml(ref.title || ref.source_id || '來源')}</strong><br><span>來源等級：${escapeHtml(labelText(ref.source_level || '未分級'))}｜確認日：${escapeHtml(ref.last_checked_at || '待確認')}</span>${link}</div>`;
  }).join('');
}

function renderOutputs() {
  const cards = selectedCards();
  renderComparison(cards);
  renderPackage(cards);
  qs('#packageHint').textContent = state.sessionToken
    ? '已從 Discord 入口取得身份連結，可儲存草稿。'
    : '目前沒有 Discord 身份連結，只能在本頁暫時組合；請從 Discord 入口重新開啟才能儲存。';
  if (!cards.length) {
    qs('#resultTitle').textContent = '請先輸入問題或選擇知識卡';
    qs('#familyOutput').textContent = '這裡會依已選知識卡整理可給家屬看的保守說明。';
    qs('#routeOutput').textContent = '';
    qs('#phoneOutput').textContent = '';
    qs('#internalOutput').textContent = '';
    qs('#sourceOutput').innerHTML = '';
    setOutputMode(state.outputMode || 'family');
    return;
  }
  qs('#resultTitle').textContent = `已組合 ${cards.length} 張知識卡`;
  qs('#familyOutput').textContent = cards.map((card, index) => `${index + 1}. ${card.family_safe_summary || '請先查證官方規定與地方承辦窗口，再提供家屬保守說明。'}`).join('\n\n');
  qs('#routeOutput').textContent = lineList(cards.flatMap((card) => card.verification_steps || []));
  qs('#phoneOutput').textContent = lineList(cards.flatMap((card) => card.phone_check_questions || []));
  qs('#internalOutput').textContent = lineList(cards.flatMap((card) => card.care_manager_notes || []));
  qs('#sourceOutput').innerHTML = renderSources(cards);
  setOutputMode(state.outputMode || 'family');
}

async function routeQuestion() {
  const question = (questionText.value || '').trim();
  if (!question) {
    qs('#apiStatus').textContent = '請先輸入問題。';
    return;
  }
  if (privacyMessage()) return;
  qs('#apiStatus').textContent = '正在尋找知識卡。';
  if (state.apiBase && state.apiReady) {
    try {
      const payload = await fetchJson(apiPath('/api/v1/disability-knowledge/route'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, region_scope: selectedRegions(), region_hints: selectedRegions() }),
      });
      const cards = payload.knowledge_cards || [];
      const directions = payload.directions || [];
      state.routeResult = payload;
      startCurrentDraft({ question, directions, cards, source: 'api' });
      renderDirections(directions);
      renderKnowledgeCards(cards, { resetAttributes: true });
      void autoSaveDraft();
      qs('#apiStatus').textContent = `已找到知識卡：${payload.status || 'ok'}。`;
      return;
    } catch (error) {
      qs('#apiStatus').textContent = `後端分流失敗，改用本頁本地知識卡：${error.message || error}`;
    }
  }
  const localCards = localKnowledgeSearch(question, [], 8, selectedRegions());
  state.routeResult = { directions: [], knowledge_cards: localCards };
  startCurrentDraft({ question, directions: [], cards: localCards, source: 'local' });
  renderDirections([]);
  renderKnowledgeCards(localCards, { resetAttributes: true });
  qs('#apiStatus').textContent = '已使用本頁知識卡保守排序。';
}

async function autoSaveDraft() {
  if (!state.sessionToken || !state.apiBase || !state.apiReady || !selectedCards().length) return;
  await saveDraft({ quiet: true, auto: true });
}

async function saveDraft(options = {}) {
  const quiet = Boolean(options.quiet);
  const auto = Boolean(options.auto);
  const cards = selectedCards();
  const setDraftMessage = (message) => {
    renderDraftContext(message);
    if (!quiet) qs('#packageHint').textContent = message;
  };
  if (!state.sessionToken) {
    setDraftMessage('沒有 Discord 身份連結，無法儲存；請從 Discord 入口重新開啟。');
    return;
  }
  if (!state.apiBase || !state.apiReady) {
    setDraftMessage('後端服務未連線，暫時不能儲存知識組合。');
    return;
  }
  if (!cards.length) {
    setDraftMessage('請先加入至少一張知識卡。');
    return;
  }
  state.currentDraftName = currentDraftName();
  const payload = {
    name: state.currentDraftName,
    question_summary: state.currentQuestionSummary || maskSensitiveText(questionText.value || ''),
    direction_ids: state.routeResult?.direction_ids || (state.routeResult?.directions || []).map((row) => row.direction_id).filter(Boolean),
    knowledge_ids: cards.map((card) => card.knowledge_id || card.id),
    output_mode: 'family',
  };
  if (state.activePackageId) payload.package_id = state.activePackageId;
  try {
    const saved = await fetchJson(`${apiPath('/api/v1/disability-knowledge/packages/draft')}?session=${encodeURIComponent(state.sessionToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.activePackageId = saved.package?.package_id || state.activePackageId;
    state.currentDraftName = saved.package?.name || state.currentDraftName;
    setDraftMessage(`${auto ? '已自動儲存' : '已儲存'}草稿：${saved.package?.name || saved.package?.package_id || '知識組合'}。下次從 Discord 入口進來會看得到。`);
    await loadSavedPackages({ quiet: true });
  } catch (error) {
    setDraftMessage(`儲存失敗：${error.message || error}`);
  }
}

async function copyTextFromNode(id) {
  const node = qs(`#${id}`);
  const text = node?.innerText || node?.textContent || '';
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

async function copyPackage() {
  const text = [
    '【身障／長照知識組合】',
    qs('#familyOutput').innerText,
    '',
    '【查證路徑】',
    qs('#routeOutput').innerText,
    '',
    '【電話確認】',
    qs('#phoneOutput').innerText,
    '',
    '【長照 VS 身障】',
    qs('#comparisonOutput').innerText,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  qs('#packageHint').textContent = '已複製知識組合內容。';
}

function officialSearchUrl() {
  const cards = selectedCards();
  const question = (questionText.value || '').trim();
  const query = cards.length
    ? `site:gov.tw OR site:ntpc.gov.tw 身障 長照 ${cards.map((card) => card.title).join(' ')}`
    : `site:gov.tw OR site:ntpc.gov.tw 身障 長照 ${question || '輔具 居家無障礙 補助 官方'}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function init() {
  await loadRuntime();
  await loadData();
  await probeApi();
  await probeSession();
  readGenerationHistory();
  setupTabs();
  setupOutputModeTabs();
  setupRegionSelector();
  renderDirections([]);
  renderKnowledgeCards(state.knowledgeCards.slice(0, 8), { resetAttributes: true });
  renderGenerationHistory();
  renderOutputs();
  renderDraftContext();
  await loadSavedPackages({ quiet: true });
  questionText.addEventListener('input', privacyMessage);
  qs('#routeButton').addEventListener('click', routeQuestion);
  qs('#clearHistoryButton').addEventListener('click', () => {
    state.generationHistory = [];
    state.activeGenerationId = '';
    writeGenerationHistory();
    renderGenerationHistory();
  });
  qs('#closeCardDetailButton').addEventListener('click', closeCardDetail);
  qs('#cardDetailOverlay').addEventListener('click', (event) => {
    if (event.target === qs('#cardDetailOverlay')) closeCardDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCardDetail();
  });
  qs('#saveDraftButton').addEventListener('click', saveDraft);
  qs('#saveDraftInlineButton').addEventListener('click', saveDraft);
  qs('#clearDraftButton').addEventListener('click', clearCurrentDraft);
  qs('#draftNameInput').addEventListener('input', (event) => {
    state.currentDraftName = String(event.target.value || '').trim();
  });
  qs('#refreshPackagesButton').addEventListener('click', () => loadSavedPackages());
  qs('#copyPackageButton').addEventListener('click', copyPackage);
  document.querySelectorAll('.copy-button[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      await copyTextFromNode(button.dataset.copyTarget);
      const original = button.textContent;
      button.textContent = '已複製';
      setTimeout(() => { button.textContent = original; }, 1200);
    });
  });
}

init().catch((error) => {
  qs('#apiStatus').textContent = `資料載入失敗：${error.message || error}`;
  qs('#knowledgeCards').innerHTML = `<div class="privacy-warning">資料載入失敗：${escapeHtml(error.message || error)}</div>`;
});
