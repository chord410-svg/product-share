const CACHE_VERSION = '20260617-detail-fix-v2';
const PACKAGE_STORAGE_KEY = 'disability_knowledge_packages_v1';
const KNOWLEDGE_PACK_SCHEMA_VERSION = 'knowledgepack.v1';
const KNOWLEDGE_PACK_MANIFEST_MARKER = 'KNOWLEDGE_PACK_MANIFEST';

const state = {
  scenarios: [],
  knowledgeCards: [],
  routeResult: null,
  selectedKnowledgeIds: new Set(),
  selectedCardSnapshots: new Map(),
  savedPackages: [],
  activePackageId: '',
  currentLocalPackageId: '',
  apiBase: '',
  sessionToken: '',
  apiReady: false,
  sessionUser: null,
  selectedRegions: new Set(['新北市', '中央共通']),
  outputMode: 'family',
  activeAttributeFilter: '',
  activeAttributeGroup: 'domain',
  activeAttributeSelections: {},
  currentKnowledgeCards: [],
  generationHistory: [],
  activeGenerationId: '',
  activeDetailCardId: '',
  currentDraftName: '',
  currentQuestionSummary: '',
  expandedPackageIds: new Set(),
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function stableHash(payload) {
  const copy = { ...payload };
  delete copy.content_hash;
  const material = stableStringify(copy);
  if (!window.crypto?.subtle) return `local-${material.length}`;
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function downloadTextFile(filename, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value, suffix) {
  const base = String(value || 'knowledge-pack')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'knowledge-pack';
  return `${base}.${suffix}`;
}

function lineList(items) {
  const rows = unique(items);
  if (!rows.length) return '尚無資料，請改用官方查證或電話確認。';
  return rows.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function sideDisplayLabel(side) {
  const value = String(side || '').trim();
  if (value === 'ltc') return '長照側';
  if (value === 'disability') return '身障側';
  if (value === 'shared') return '共同資料';
  return '未指定側別';
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
  mobility_stair_device: '爬梯機／上下樓設備',
  mobility_wheelchair_device: '輪椅與移動輔具',
  mobility_transfer_lifting: '移位與移乘安全',
  mobility_transport_access: '交通服務與外出支持',
  mobility_home_route: '室內通行與門檻改善',
  home_accessibility_service_scope: '居家無障礙服務範圍',
  home_accessibility_site_assessment: '現場評估與動線改善',
  home_accessibility_documents: '居家無障礙文件需求',
  home_accessibility_preapproval: '事前核定與先購買風險',
  home_accessibility_completion_followup: '完工確認與後續責任',
  smart_assistive_policy_timeline: '智慧科技輔具政策時程',
  smart_assistive_item_scope: '智慧輔具品項範圍',
  smart_assistive_dual_track: '智慧輔具租賃與一般輔具購置',
  smart_assistive_assessment_document: '智慧輔具評估文件',
  smart_assistive_operation_readiness: '智慧輔具操作準備',
  smart_assistive_rental_maintenance: '智慧輔具租賃維護',
  smart_assistive_product_leads: '智慧輔具產品線索',
  smart_assistive_legacy_alias: '智慧輔具舊方向參考',
};

const DOMAIN_LABELS = {
  smart_assistive: '智慧輔具',
  disability_knowledge: '身障／長照知識',
};

const SYSTEM_SCOPE_LABELS = {
  長照: '長照',
  身障: '身障',
  長照身障交界: '長照身障交界',
};

const CHECK_TYPE_LABELS = {
  application_path: '申請路徑',
  system_boundary: '制度差異',
  document_assessment: '文件／評估',
  preapproval: '事前核定',
  contact_check: '窗口／電話',
  operation_maintenance: '操作維護',
  item_scope: '品項範圍',
};

const DIRECTION_LABELS = {
  smart_assistive: '智慧輔具',
  smart_assistive_policy: '智慧輔具政策',
  smart_assistive_item_scope: '智慧輔具品項範圍',
  smart_assistive_dual_track: '租賃／購置分流',
  smart_assistive_assessment: '智慧輔具評估',
  smart_assistive_operation: '操作準備',
  smart_assistive_rental: '租賃維護',
  smart_assistive_product_leads: '產品線索',
  smart_assistive_product_lead: '產品線索',
  assistive_device_rental_service: '輔具租賃服務',
  ltc_assistive_service_question: '長照輔具服務',
  home_accessibility: '居家無障礙',
  transport_access: '交通接送',
  family_support: '家庭支持',
  disability_services: '身障服務',
  assistive_device: '輔具查證',
};

const KNOWLEDGE_TYPE_TO_CHECK_TYPE = {
  '申請路徑': 'application_path',
  '地方流程': 'application_path',
  '官方項目': 'application_path',
  '上路時程': 'application_path',
  '政策說明': 'application_path',
  '制度差異': 'system_boundary',
  '家屬版說明': 'system_boundary',
  '文件需求': 'document_assessment',
  '專業評估': 'document_assessment',
  '事前核定': 'preapproval',
  '風險提醒': 'preapproval',
  '查證流程': 'contact_check',
  '電話確認': 'contact_check',
  '地方窗口': 'contact_check',
  '操作準備': 'operation_maintenance',
  '照顧者承接': 'operation_maintenance',
  'APP／網路': 'operation_maintenance',
  '租賃服務': 'operation_maintenance',
  '租賃維護': 'operation_maintenance',
  '清潔消毒': 'operation_maintenance',
  '退租責任': 'operation_maintenance',
  '購置／租賃判斷': 'item_scope',
  '品項查證': 'item_scope',
  '功能分類': 'item_scope',
};

const ATTRIBUTE_TYPE_LABELS = {
  domain: '主題',
  system_scope: '制度側',
  check_type: '查證類型',
};

const ACTIVE_CARD_STATUSES = new Set(['active', 'ready', 'formal']);
const RETIRED_CARD_STATUSES = new Set(['deprecated', 'archived', 'retired', 'alias_only']);

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

function flagDisabled(value) {
  if (value === false) return true;
  if (typeof value === 'string') return ['false', '0', 'no', 'n', '否'].includes(value.trim().toLowerCase());
  return false;
}

function isFrontVisibleCard(card) {
  const status = String(card?.status || 'active').trim().toLowerCase();
  if (!ACTIVE_CARD_STATUSES.has(status) || RETIRED_CARD_STATUSES.has(status)) return false;
  if (flagDisabled(card?.front_visible) || flagDisabled(card?.searchable)) return false;
  return true;
}

function comparisonGroup(card) {
  return String(card?.comparison_group || '').trim();
}

function comparisonGroupLabel(group, card = null) {
  const raw = String(group || comparisonGroup(card) || '').trim();
  return card?.comparison_group_label || COMPARISON_GROUP_LABELS[raw] || labelText(raw) || '未指定比較屬性';
}

function domainLabel(value) {
  const raw = String(value || '').trim();
  return DOMAIN_LABELS[raw] || labelText(raw);
}

function directionLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return DIRECTION_LABELS[raw] || scenarioById(raw)?.short_label || scenarioById(raw)?.title || labelText(raw);
}

function systemScopeLabel(value) {
  const raw = String(value || '').trim();
  return SYSTEM_SCOPE_LABELS[raw] || '';
}

function checkTypeKey(value) {
  return KNOWLEDGE_TYPE_TO_CHECK_TYPE[String(value || '').trim()] || '';
}

function checkTypeLabel(key) {
  return CHECK_TYPE_LABELS[String(key || '').trim()] || '';
}

function attributeKey(type, value) {
  return `${type}:${String(value || '').trim()}`;
}

function cardAttributes(card) {
  const attrs = [];
  const domain = String(card.domain || '').trim();
  if (domain) attrs.push({ type: 'domain', value: domain, label: domainLabel(domain), key: attributeKey('domain', domain) });
  for (const value of asArray(card.system_scope)) {
    const label = systemScopeLabel(value);
    if (label) attrs.push({ type: 'system_scope', value, label, key: attributeKey('system_scope', value) });
  }
  for (const value of asArray(card.knowledge_type)) {
    const mappedKey = checkTypeKey(value);
    const label = checkTypeLabel(mappedKey);
    if (mappedKey && label) attrs.push({ type: 'check_type', value: mappedKey, label, key: attributeKey('check_type', mappedKey) });
  }
  const seen = new Set();
  return attrs.filter((attr) => {
    if (!attr.value || !attr.label || seen.has(attr.key)) return false;
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

function selectedAttributeCountMap() {
  const counts = new Map();
  for (const id of state.selectedKnowledgeIds) {
    const card = state.selectedCardSnapshots.get(id) || cardById(id);
    if (!card) continue;
    for (const attr of cardAttributes(card)) {
      counts.set(attr.key, (counts.get(attr.key) || 0) + 1);
    }
  }
  return counts;
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
  const preferredOrder = ['domain', 'system_scope', 'check_type'];
  state.activeAttributeGroup = preferredOrder.find((type) => state.activeAttributeSelections[type]?.size) || 'system_scope';
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
  const selectedCounts = selectedAttributeCountMap();
  const grouped = groupAttributeFilters(catalog.map((attr) => ({ ...attr, selectedCount: selectedCounts.get(attr.key) || 0 })));
  if (!grouped.has(state.activeAttributeGroup)) {
    state.activeAttributeGroup = grouped.has('domain') ? 'domain' : (grouped.has('system_scope') ? 'system_scope' : catalog[0].type);
  }
  const typeOrder = ['domain', 'system_scope', 'check_type'].filter((type) => grouped.has(type));
  const activeSubs = grouped.get(state.activeAttributeGroup) || [];
  const activeLabel = ATTRIBUTE_TYPE_LABELS[state.activeAttributeGroup] || '屬性';
  const selected = selectedAttributeSet(state.activeAttributeGroup);
  const selectedSubCount = activeSubs.filter((attr) => attr.selectedCount).length;
  const sortedActiveSubs = [...activeSubs];
  container.innerHTML = `
    <div class="attribute-filter-head">
      <span class="attribute-filter-label">屬性分類</span>
      <span class="small-note">${escapeHtml(activeLabel)}：目前副本已加入 ${selectedSubCount}/${activeSubs.length} 子屬性。點屬性篩選卡片；點卡片加入或移出目前副本。</span>
    </div>
    <div class="attribute-main-tabs" data-count="${typeOrder.length}" aria-label="主屬性分類">
      ${typeOrder.map((type) => {
        const attrs = grouped.get(type) || [];
        const typeSelectedCount = attrs.filter((attr) => attr.selectedCount).length;
        const isActive = state.activeAttributeGroup === type;
        return `
          <button type="button" class="attribute-main-button${isActive ? ' is-active' : ''}${typeSelectedCount ? ' has-selected-cards' : ''}" data-attribute-type="${escapeHtml(type)}">
            <strong>${escapeHtml(ATTRIBUTE_TYPE_LABELS[type] || type)}</strong>
            <span>${typeSelectedCount}/${attrs.length} 已選</span>
          </button>
        `;
      }).join('')}
    </div>
    <div class="attribute-subchips" aria-label="${escapeHtml(activeLabel)}子屬性">
      ${sortedActiveSubs.map((attr) => {
        const isFilterActive = selected.has(attr.key);
        const selectedCount = Number(attr.selectedCount || 0);
        const totalCount = Math.max(Number(attr.totalCount || 0), selectedCount);
        const countText = `${selectedCount}/${totalCount}`;
        return `
          <button type="button" class="attribute-chip${isFilterActive ? ' is-filter-active' : ''}${selectedCount ? ' has-selected-cards' : ''}" data-attribute-key="${escapeHtml(attr.key)}" aria-pressed="${isFilterActive ? 'true' : 'false'}">
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
  const digest = card?.comparison_digest;
  return Boolean(
    (digest && typeof digest === 'object' && Object.keys(digest).length)
    || (comparison && typeof comparison === 'object' && Object.keys(comparison).length)
  );
}

function looseArray(value) {
  if (Array.isArray(value)) return value.filter((item) => String(item ?? '').trim());
  const text = compactSentence(value);
  return text ? [text] : [];
}

function firstCompareText(values, fallback = '') {
  for (const value of values) {
    const text = compactSentence(Array.isArray(value) ? value.join('、') : value);
    if (text) return text;
  }
  return fallback;
}

function comparisonDigest(card) {
  const explicit = card?.comparison_digest && typeof card.comparison_digest === 'object' ? card.comparison_digest : null;
  const comparison = card?.comparison && typeof card.comparison === 'object' ? card.comparison : null;
  if (!explicit && !comparison) return null;

  const group = String(explicit?.comparison_group || comparisonGroup(card) || '').trim();
  if (!group) return null;

  const ltc = comparison?.ltc_side || {};
  const disability = comparison?.disability_side || {};
  const boundary = explicit?.boundary || {};
  const action = explicit?.action || {};
  const reminders = unique([
    ...looseArray(action.reminders),
    ...looseArray(comparison?.shared_risks).map(labelText),
    ...looseArray(card?.risk_flags).map(labelText),
    ...looseArray(card?.care_manager_notes || card?.internal_notes).slice(0, 1),
  ]);

  return {
    card_id: cardId(card),
    group,
    label: explicit?.group_label || comparisonGroupLabel(group, card),
    title: explicit?.compare_title || card?.title || cardId(card),
    summary: card?.knowledge_brief || card?.summary || card?.family_safe_summary || card?.integrated_content || '',
    side: cardSystemSide(card),
    boundary: {
      ltc: firstCompareText([boundary.ltc, ltc.boundary, ltc.risk, ltc.path], '長照側需先確認是否有對應服務、品項、評估或地方承辦流程。'),
      disability: firstCompareText([boundary.disability, disability.boundary, disability.risk, disability.path], '身障側需查地方身障福利、輔具資源中心或社會局窗口，不能以商品名稱直接判定。'),
      shared: firstCompareText([boundary.shared, comparison?.summary], '未經官方窗口確認前，不判定資格、不承諾金額，也不請家屬先購買或施工。'),
    },
    action: {
      ltc: firstCompareText([action.ltc, ltc.action, ltc.window, ltc.documents, ltc.path], '詢問地方照管中心、長照承辦窗口或特約輔具服務單位是否有可用服務路徑與文件要求。'),
      disability: firstCompareText([action.disability, disability.action, disability.window, disability.documents, disability.path], '詢問社會局、輔具資源中心或身障福利窗口是否有品項、評估與事前核定要求。'),
      reminders,
    },
    family_wording: compactSentence(explicit?.family_wording || comparison?.family_wording || card?.family_safe_summary || '這類需求需先確認長照與身障兩側官方路徑，再提供家屬保守說明。'),
  };
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
    local_cache: '本機暫存',
    sync_failed: '同步失敗',
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

function readCachedKnowledgePackages() {
  try {
    const rows = JSON.parse(localStorage.getItem(PACKAGE_STORAGE_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row && (row.package_id || row.id)) : [];
  } catch (error) {
    console.info('knowledge package cache unreadable', error);
    return [];
  }
}

function writeCachedKnowledgePackages(packages) {
  try {
    localStorage.setItem(PACKAGE_STORAGE_KEY, JSON.stringify(packages.slice(0, 80)));
  } catch (error) {
    console.info('knowledge package cache write failed', error);
  }
}

function isLocalPackageRecord(record = {}) {
  const id = String(record.package_id || record.id || '');
  return id.startsWith('local_') || String(record.status || '').replaceAll('_', '-') === 'local-cache';
}

function removeCachedKnowledgePackage(packageId) {
  const id = String(packageId || '');
  writeCachedKnowledgePackages(readCachedKnowledgePackages().filter((row) => String(row.package_id || row.id) !== id));
}

function normalizePackageRecord(record = {}) {
  const id = String(record.package_id || record.id || `local_${Date.now()}`).trim();
  const items = asArray(record.items).map((item, index) => {
    const snapshot = item.knowledge_snapshot || item.snapshot || item;
    const knowledgeId = item.knowledge_id || cardId(snapshot);
    return {
      knowledge_id: knowledgeId,
      knowledge_snapshot: snapshot,
      sort_order: Number(item.sort_order ?? index),
      added_at: item.added_at || Math.floor(Date.now() / 1000),
    };
  }).filter((item) => item.knowledge_id && item.knowledge_snapshot);
  const knowledgeIds = asArray(record.knowledge_ids).length
    ? asArray(record.knowledge_ids)
    : items.map((item) => item.knowledge_id);
  return {
    ...record,
    package_id: id,
    id,
    name: String(record.name || state.currentDraftName || '未命名知識組合'),
    question_summary: String(record.question_summary || state.currentQuestionSummary || ''),
    direction_ids: asArray(record.direction_ids),
    knowledge_ids: knowledgeIds,
    items,
    outputs: asArray(record.outputs),
    status: record.status || 'draft',
    output_mode: record.output_mode || 'family',
    created_at: Number(record.created_at || Math.floor(Date.now() / 1000)),
    updated_at: Number(record.updated_at || Math.floor(Date.now() / 1000)),
  };
}

function cacheKnowledgePackages(records) {
  const merged = new Map(readCachedKnowledgePackages().map((row) => [String(row.package_id || row.id), row]));
  asArray(records).forEach((record) => {
    const normalized = normalizePackageRecord(record);
    merged.set(normalized.package_id, normalized);
  });
  writeCachedKnowledgePackages([...merged.values()].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0)));
}

function currentPackageRecord(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const cards = selectedCards();
  if (!state.activePackageId && !state.currentLocalPackageId) {
    state.currentLocalPackageId = `local_${now}`;
  }
  const packageId = overrides.package_id || state.activePackageId || state.currentLocalPackageId;
  return normalizePackageRecord({
    package_id: packageId,
    name: state.currentDraftName || currentDraftName(),
    question_summary: state.currentQuestionSummary || maskSensitiveText(questionText.value || ''),
    direction_ids: state.routeResult?.direction_ids || (state.routeResult?.directions || []).map((row) => row.direction_id).filter(Boolean),
    knowledge_ids: cards.map((card) => cardId(card)),
    items: cards.map((card, index) => ({
      knowledge_id: cardId(card),
      knowledge_snapshot: card,
      sort_order: index,
      added_at: now,
    })),
    status: state.activePackageId ? 'draft' : 'local_cache',
    created_at: now,
    updated_at: now,
    ...overrides,
  });
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
  const display = qs('#draftNameDisplay');
  const status = qs('#draftStatus');
  const name = state.currentDraftName || '尚未產生知識副本';
  if (input) {
    if (document.activeElement !== input) input.value = name;
  }
  if (display) display.textContent = name;
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

function glmStatusText(meta = {}, source = 'local') {
  return source === 'api' && meta.status === 'ai'
    ? 'GLM狀態：上線'
    : 'GLM狀態：斷線／採本地簡易搜索';
}

function routeStatusText(meta = {}, cardCount = 0, source = 'local') {
  return glmStatusText(meta, source);
}

function renderQuestionRouteStatus(meta = {}, cardCount = 0, source = 'local') {
  const routeStatus = qs('#questionRouteStatus');
  if (routeStatus) routeStatus.textContent = routeStatusText(meta, cardCount, source);
  const missing = asArray(meta.missing_questions || meta.missing_slots);
  if (missing.length) {
    renderDraftContext(`建議補充：${missing.slice(0, 3).join('、')}。目前仍可先用已選知識卡整理副本。`);
  }
}

function startCurrentDraft({ question, directions = [], cards = [], source = 'local', routeMeta = {} }) {
  state.activePackageId = '';
  state.currentLocalPackageId = `local_${Date.now()}`;
  state.currentQuestionSummary = maskSensitiveText(question || '');
  state.currentDraftName = defaultDraftName(question);
  setSelectedCards(cards);
  renderDraftContext(`已產生目前副本：${state.currentDraftName}，並自動加入 ${cards.length} 張知識卡。`);
  renderQuestionRouteStatus(routeMeta, cards.length, source);
  renderOutputs();
}

function clearCurrentDraft() {
  state.selectedKnowledgeIds.clear();
  state.selectedCardSnapshots.clear();
  state.activePackageId = '';
  state.currentLocalPackageId = '';
  state.currentDraftName = '';
  state.currentQuestionSummary = '';
  renderKnowledgeCards(state.currentKnowledgeCards || []);
  renderOutputs();
  renderDraftContext('已清除目前副本；可重新輸入問題建立新的知識副本。');
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
    short_label: directionLabel(id),
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

function focusCardFromUrl() {
  return params().get('focus_card') || params().get('knowledge_id') || '';
}

function cssEscape(value) {
  const text = String(value || '');
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
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
  state.knowledgeCards = (knowledgePayload.knowledge_cards || []).filter(isFrontVisibleCard);
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

function localKnowledgeSearch(query, directionIds = [], limit = 12, regionHints = selectedRegions()) {
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
    const id = row.direction_id || row.scenario_id || row.id || '';
    const scenario = scenarioById(id) || {};
    const title = id ? directionLabel(id) : (row.title || row.short_label || scenario.title || scenario.short_label || '未命名方向');
    const description = row.reason || scenario.care_manager_goal || '依問題方向分流，需再由知識卡與官方來源查證。';
    return `
      <article class="direction-card">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-desc">${escapeHtml(description)}</div>
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
  const domain = String(card.domain || '').trim();
  const labels = unique([
    domain ? domainLabel(domain) : '',
    regions[0] || '',
    subtypes[0] || comparisonGroupLabel(comparisonGroup(card), card),
    source ? sourceLevelLabel(source.source_level) : '來源待補',
  ].filter(Boolean)).slice(0, 4);
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

function paragraphsHtml(value, fallback = '尚待補齊內容。') {
  const text = String(value || '').trim();
  if (!text) return `<p>${escapeHtml(fallback)}</p>`;
  return text
    .split(/\n{2,}/)
    .map((part) => compactSentence(part))
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join('');
}

function firstText(items, fallback = '') {
  return compactSentence(asArray(items)[0] || fallback);
}

function knowledgeExplanationHtml(card) {
  const explicit = compactSentence(card.knowledge_brief || card.public_summary || '');
  const integrated = String(card.integrated_content || '').trim();
  if (integrated) {
    return `
      ${explicit ? `<p><strong>摘要：</strong>${escapeHtml(explicit)}</p>` : ''}
      <div class="integrated-content">${paragraphsHtml(integrated)}</div>
    `;
  }
  if (explicit) return `<p>${escapeHtml(explicit)}</p>`;

  const extracts = sourceExtracts(card);
  const firstExtract = extracts.length ? compactSentence(asArray(extracts[0].content).join(' ')) : '';
  if (firstExtract) return `<p>${escapeHtml(firstExtract)}</p>`;
  return '<p>此卡尚待補齊資料濃縮內容；請先打開「資料本體整理」查看來源。</p>';
}

function sourceExtracts(card) {
  return Array.isArray(card?.source_extracts)
    ? card.source_extracts.filter((row) => row && typeof row === 'object')
    : [];
}

function sourceExtractContentHtml(extract) {
  const content = Array.isArray(extract.content)
    ? extract.content
    : String(extract.content || '').split(/\n+/);
  const rows = content.map((row) => compactSentence(row)).filter(Boolean);
  if (!rows.length) return '<p class="muted">此來源尚待補齊資料本體整理。</p>';
  return rows.map((row) => `<p>${escapeHtml(row)}</p>`).join('');
}

function sourceExtractsHtml(card) {
  const extracts = sourceExtracts(card);
  if (!extracts.length) {
    return '<p class="muted">此卡尚未建立資料本體整理；請先回來源連結人工查閱。</p>';
  }
  return `
    <div class="source-extract-list">
      ${extracts.map((extract, index) => {
        const url = String(extract.url || extract.source_url || '');
        const title = extract.source_title || extract.title || extract.source_id || `來源 ${index + 1}`;
        const sourceLink = /^https?:\/\//.test(url)
          ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
          : escapeHtml(title);
        return `
          <article class="source-extract-card">
            <div class="source-extract-meta">
              <span>來源屬性：${escapeHtml(sourceLevelLabel(extract.source_level))}</span>
              <span>資料來源：${escapeHtml(extract.agency || '待補')}</span>
              <span>建檔日期：${escapeHtml(extract.created_at || '待確認')}</span>
              <span>更新時間：${escapeHtml(extract.updated_at || extract.last_checked_at || '待確認')}</span>
            </div>
            <h4>${sourceLink}</h4>
            <div class="source-extract-content">${sourceExtractContentHtml(extract)}</div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function sanitizeCaseManagerContact(text) {
  return compactSentence(text)
    .replace(/問\s*1966\s*或/g, '問')
    .replace(/詢問\s*1966\s*、/g, '詢問')
    .replace(/1966、/g, '')
    .replace(/1966/g, '地方照管中心或地方長照承辦窗口')
    .replace(/\s+/g, ' ')
    .trim();
}

function suggestedContactRows(card) {
  const explicitContacts = asArray(card.suggested_contacts || card.contact_windows || card.check_contacts);
  if (explicitContacts.length) {
    return explicitContacts.map((contact) => {
      if (contact && typeof contact === 'object') {
        const name = contact.name || contact.title || contact.window || contact.label || '查證窗口';
        const purpose = contact.purpose || contact.reason || contact.note || '';
        const phone = contact.phone ? `｜${contact.phone}` : '';
        const url = contact.url && /^https?:\/\//.test(String(contact.url))
          ? `｜${contact.url}`
          : '';
        return `${name}${phone}${url}${purpose ? `：${purpose}` : ''}`;
      }
      return escapeHtml(sanitizeCaseManagerContact(contact));
    }).filter(Boolean);
  }

  const digest = comparisonDigest(card);
  const comparison = card?.comparison || {};
  const ltcWindow = sanitizeCaseManagerContact(digest?.action?.ltc || comparison?.ltc_side?.window || '');
  const disabilityWindow = sanitizeCaseManagerContact(digest?.action?.disability || comparison?.disability_side?.window || '');
  const contacts = [];
  if (ltcWindow) contacts.push(`長照側：${escapeHtml(ltcWindow)}`);
  if (disabilityWindow) contacts.push(`身障側：${escapeHtml(disabilityWindow)}`);
  if (!contacts.length) {
    contacts.push('尚未建立明確查證窗口；可先依來源中的地方承辦單位、輔具資源中心或特約服務單位補查。');
  }
  return contacts;
}

function resourceHintHtml(card) {
  const ids = asArray(card.related_resource_ids).map(compactSentence).filter(Boolean);
  if (!ids.length) return '<p class="muted">對應資源卡：待建立。此卡先作制度與查證知識使用。</p>';
  return `<p>對應資源卡：${ids.map((id) => `<code>${escapeHtml(id)}</code>`).join('、')}</p>`;
}

function actionDetailHtml(card) {
  const contacts = suggestedContactRows(card);
  const questions = unique(card.phone_check_questions || []);
  const answerable = unique([
    ...asArray(card.answerable_questions),
    ...asArray(card.question_patterns),
  ]).filter(Boolean);
  return `
    <div class="detail-grid">
      <div class="detail-field detail-field-wide"><strong>這個知識可以解決什麼問題</strong>${listHtml(answerable, '尚未整理可回答問題；請先依標題與資料本體判斷。')}</div>
      <div class="detail-field detail-field-wide"><strong>誰可以解決什麼問題</strong>${listHtml(contacts, '尚未建立明確查證窗口。')}</div>
      <div class="detail-field detail-field-wide"><strong>電話確認問題</strong>${listHtml(questions, '尚未整理電話確認問題；請把知識內容反向整理成可問承辦窗口的問題。')}</div>
    </div>
  `;
}

function singleCardComparisonHtml(card) {
  const profile = card?.comparison_profile && typeof card.comparison_profile === 'object' ? card.comparison_profile : null;
  const digest = comparisonDigest(card);
  if (!profile && !digest) {
    return '<div class="empty-state">此卡尚未設定同屬性比較資料；可先用「知識整理與解釋」與「查證行動」。</div>';
  }
  if (profile) {
    const facts = asArray(profile.facts).filter((row) => row && typeof row === 'object');
    return `
      <div class="detail-grid">
        <div class="detail-field"><strong>同屬性</strong>${escapeHtml(comparisonGroupLabel(profile.comparison_group || comparisonGroup(card), card))}</div>
        <div class="detail-field"><strong>本卡側別</strong>${escapeHtml(sideDisplayLabel(profile.system_side || card.system_side || ''))}</div>
        <div class="detail-field detail-field-wide">
          <strong>本卡比較重點</strong>
          ${facts.length ? `<ul class="detail-list">${facts.map((fact) => `<li><strong>${escapeHtml(fact.label || '項目')}：</strong>${escapeHtml(fact.value || '待補')}</li>`).join('')}</ul>` : '<p>此卡尚未整理比較重點。</p>'}
        </div>
      </div>
    `;
  }
  const side = String(card.system_side || card.side || '').trim();
  const sideLabel = side === 'ltc'
    ? '長照側'
    : side === 'disability'
      ? '身障側'
      : side === 'shared'
        ? '共通資料'
        : '未指定側別';
  const sideBoundary = side === 'ltc'
    ? digest.boundary.ltc
    : side === 'disability'
      ? digest.boundary.disability
      : digest.boundary.shared;
  const sideAction = side === 'ltc'
    ? digest.action.ltc
    : side === 'disability'
      ? digest.action.disability
      : digest.action.reminders.join('、');
  return `
    <div class="detail-grid">
      <div class="detail-field"><strong>同屬性</strong>${escapeHtml(digest.label || digest.group)}</div>
      <div class="detail-field"><strong>本卡側別</strong>${escapeHtml(sideLabel)}</div>
      <div class="detail-field detail-field-wide"><strong>本卡比較摘要</strong>${valueHtml(sideBoundary, '此卡尚未整理本側比較摘要。')}</div>
      <div class="detail-field detail-field-wide"><strong>本卡查證摘要</strong>${valueHtml(sideAction, '此卡尚未整理本側查證摘要。')}</div>
      <div class="detail-field detail-field-wide"><strong>完整比較位置</strong><p>完整左右比較請到「我的知識組合」選好同屬性卡片後，按「查看結果」。若只加入一側，另一側會顯示待補或未收錄，不會由系統推論。</p></div>
    </div>
  `;
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

function knowledgeModeButton(id, label, active = false) {
  return `<button class="knowledge-mode-button${active ? ' is-active' : ''}" type="button" data-knowledge-detail-mode="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function knowledgeModePanel(id, content, active = false) {
  return `<div class="knowledge-mode-panel" data-knowledge-detail-panel="${escapeHtml(id)}"${active ? '' : ' hidden'}>${content}</div>`;
}

function knowledgeSummaryPanelHtml(card) {
  return `
    <div class="knowledge-mode-switch" role="tablist" aria-label="知識整理顯示模式">
      ${knowledgeModeButton('integrated', '摘要與內容整合', true)}
      ${knowledgeModeButton('sources', '資料本體整理')}
    </div>
    <div class="knowledge-mode-panels">
      ${knowledgeModePanel('integrated', `<div class="detail-brief">${knowledgeExplanationHtml(card)}</div>`, true)}
      ${knowledgeModePanel('sources', sourceExtractsHtml(card))}
    </div>
  `;
}

function detailTabsHtml(card) {
  const tabs = [
    ['summary', '知識整理與解釋', `
      <section class="detail-section detail-brief-section">
        <p class="eyebrow">知識整理與解釋</p>
        <h3>摘要與資料濃縮</h3>
        ${knowledgeSummaryPanelHtml(card)}
      </section>
    `],
    ['action', '查證行動', actionDetailHtml(card)],
  ];
  if (card?.comparison_profile || comparisonDigest(card)) {
    tabs.push(['comparison', '長照／身障比較', singleCardComparisonHtml(card)]);
  }
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
  container.querySelectorAll('.knowledge-mode-button').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.knowledgeDetailMode || '';
      container.querySelectorAll('.knowledge-mode-button').forEach((node) => {
        node.classList.toggle('is-active', node === button);
      });
      container.querySelectorAll('.knowledge-mode-panel').forEach((panel) => {
        panel.hidden = panel.dataset.knowledgeDetailPanel !== mode;
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
      <article class="knowledge-card${selected ? ' selected' : ' is-candidate-card'}" data-card-id="${escapeHtml(id)}" role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(card.title || id)}</h3>
          </div>
          <div class="card-badges" aria-label="卡片狀態">
            <span class="confidence ${selected ? 'selected-badge' : 'candidate-badge'}">${selected ? '已加入' : '候選卡'}</span>
          </div>
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
      event.preventDefault();
      const id = button.dataset.cardId || '';
      openCardDetail(visibleCards.find((row) => cardId(row) === id) || cards.find((row) => cardId(row) === id) || cardById(id));
    });
  });
}

function focusKnowledgeCardFromUrl() {
  const id = focusCardFromUrl();
  if (!id) return;
  const card = cardById(id);
  if (!card) return;
  const visible = (state.currentKnowledgeCards || []).some((row) => cardId(row) === id);
  if (!visible) {
    renderKnowledgeCards([card], { resetAttributes: true });
  }
  setupTabs('knowledgeNav');
  window.setTimeout(() => {
    const node = document.querySelector(`.knowledge-card[data-card-id="${cssEscape(id)}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    openCardDetail(card);
  }, 80);
}

function comparisonGroups(cards) {
  const groups = new Map();
  const notComparable = [];
  for (const card of cards) {
    const digest = comparisonDigest(card);
    const group = digest?.group || '';
    if (!group || !digest) {
      notComparable.push(card);
      continue;
    }
    if (!groups.has(group)) {
      groups.set(group, {
        group,
        label: digest.label,
        cards: [],
        ltcRows: [],
        disabilityRows: [],
        sharedRows: [],
        unknownRows: [],
      });
    }
    const row = {
      card_id: digest.card_id || cardId(card),
      title: digest.title,
      summary: digest.summary || '',
      side: digest.side || cardSystemSide(card),
    };
    const bucket = groups.get(group);
    bucket.cards.push(row);
    if (row.side === 'ltc') bucket.ltcRows.push(row);
    else if (row.side === 'disability') bucket.disabilityRows.push(row);
    else if (row.side === 'shared') bucket.sharedRows.push(row);
    else bucket.unknownRows.push(row);
  }
  return { groups: [...groups.values()], notComparable };
}

function comparisonSummaryText(row) {
  const value = String(row?.summary || '').replace(/\s+/g, ' ').trim() || '這張卡尚未補齊摘要，請先查看知識卡完整內容。';
  return value.length > 120 ? `${value.slice(0, 119).trim()}…` : value;
}

function comparisonCardLink(id) {
  const urlParams = new URLSearchParams({ v: CACHE_VERSION });
  if (id) urlParams.set('focus_card', id);
  return `./disability-resource.html?${urlParams.toString()}`;
}

function inlineSummaryCards(rows, emptyText) {
  if (!rows.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return rows.map((row) => `
    <article class="compare-summary-card">
      <h5>${escapeHtml(row.title || row.card_id || '未命名知識卡')}</h5>
      <p>${escapeHtml(comparisonSummaryText(row))}</p>
      <a class="compare-card-link" href="${escapeHtml(comparisonCardLink(row.card_id))}">查看此知識卡</a>
    </article>
  `).join('');
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
    <article class="compare-summary-table">
      <div class="comparison-group-title">
        <div>
          <p class="eyebrow">同屬性比較</p>
          <h3>${escapeHtml(group.label)}</h3>
        </div>
        <span class="tag compare-tag">${group.cards.length} 張知識卡｜長照 ${group.ltcRows.length}｜身障 ${group.disabilityRows.length}</span>
      </div>
      <p class="comparison-group-note">只合併同屬性的知識卡；結果頁以摘要協助快速看出長照側與身障側各有哪些資料。</p>
      <div class="compare-summary-columns">
        <section>
          <h5>長照側摘要</h5>
          ${inlineSummaryCards(group.ltcRows, '尚未加入同屬性的長照側知識卡。')}
        </section>
        <section>
          <h5>身障側摘要</h5>
          ${inlineSummaryCards(group.disabilityRows, '尚未加入同屬性的身障側知識卡。')}
        </section>
      </div>
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
  const packageCount = qs('#packageCount');
  const packageStatus = qs('#packageStatus');
  const loginStatus = qs('#loginStatus');
  const workbenchName = qs('#workbenchDraftNameInput');
  if (packageCount) packageCount.textContent = `${cards.length} 張`;
  if (workbenchName && document.activeElement !== workbenchName) {
    workbenchName.value = currentDraftName();
  }
  if (loginStatus) {
    if (state.sessionUser) {
      const user = state.sessionUser.username || state.sessionUser.name || 'Discord 使用者';
      const id = state.sessionUser.discord_id || state.sessionUser.id || '';
      loginStatus.textContent = `已連結 Discord：${user}${id ? ` / ${id}` : ''}。草稿與結果會保存到你的知識組合工作台。`;
    } else if (state.sessionToken) {
      loginStatus.textContent = '已透過 Discord 入口開啟，正在確認身份與後端同步狀態。';
    } else {
      loginStatus.textContent = '請從 Discord 身障／長照知識導航按鈕開啟，才能儲存並建立知識組合結果。';
    }
  }
  if (packageStatus) {
    const saveHint = state.sessionToken && state.apiReady
      ? '草稿會保存到我的知識組合。'
      : '目前只能使用本機暫存；請從 Discord 入口開啟並確認後端可用後再同步。';
    packageStatus.textContent = cards.length
      ? `已加入 ${cards.length} 張知識卡，可在下方知識組合卡片展開查看。 ${saveHint}`
      : `尚未加入知識卡。 ${saveHint}`;
  }
  if (container) {
    container.hidden = true;
    container.innerHTML = '';
  }
}

function packageSnapshots(record) {
  return asArray(record.items)
    .map((item) => item.knowledge_snapshot)
    .filter((snapshot) => snapshot && (snapshot.knowledge_id || snapshot.id));
}

function packageCount(record) {
  return packageSnapshots(record).length || asArray(record.knowledge_ids).length || 0;
}

function openKnowledgeResult(record, options = {}) {
  const normalized = normalizePackageRecord(record);
  cacheKnowledgePackages([normalized]);
  window.location.href = resultLinkForPackage(normalized, options);
}

function resultLinkForPackage(record, options = {}) {
  const normalized = normalizePackageRecord(record);
  const query = new URLSearchParams({
    package_id: normalized.package_id,
    source: 'knowledge-nav',
    v: CACHE_VERSION,
  });
  if (options.print) query.set('print', '1');
  const url = new URL('./disability-knowledge-result.html', window.location.href);
  url.search = query.toString();
  return url.href;
}

function resultShareUrl(record) {
  return record.share_url || asArray(record.outputs).find((output) => output.share_url)?.share_url || '';
}

function hasReadyOutput(record) {
  const status = String(record.status || '').toLowerCase();
  const output = asArray(record.outputs).find((item) => String(item.status || '').toLowerCase() === 'ready');
  return status === 'result_ready' || Boolean(output) || Boolean(resultShareUrl(record));
}

function duplicatePackage(record) {
  const normalized = normalizePackageRecord(record);
  const now = Math.floor(Date.now() / 1000);
  const duplicate = normalizePackageRecord({
    ...normalized,
    package_id: `local_${now}`,
    name: `${normalized.name || '知識組合'} 副本`,
    status: 'local_cache',
    share_url: '',
    share_page_id: '',
    outputs: [],
    created_at: now,
    updated_at: now,
  });
  cacheKnowledgePackages([duplicate]);
  state.savedPackages = [duplicate, ...state.savedPackages.filter((row) => String(row.package_id || row.id) !== duplicate.package_id)];
  applySavedPackage(duplicate.package_id);
}

function removePackageFromState(packageId) {
  const id = String(packageId || '');
  state.savedPackages = state.savedPackages.filter((row) => String(row.package_id || row.id) !== id);
  removeCachedKnowledgePackage(id);
  state.expandedPackageIds.delete(id);
  if (state.activePackageId === id || state.currentLocalPackageId === id) {
    state.selectedKnowledgeIds.clear();
    state.selectedCardSnapshots.clear();
    state.activePackageId = '';
    state.currentLocalPackageId = '';
    state.currentDraftName = '';
    state.currentQuestionSummary = '';
    renderKnowledgeCards(state.currentKnowledgeCards || []);
    renderOutputs();
    renderDraftContext('已刪除目前知識副本；可重新輸入問題建立新的知識副本。');
  }
}

async function deleteKnowledgePackage(record, button) {
  const normalized = normalizePackageRecord(record);
  const packageId = normalized.package_id;
  const confirmed = window.confirm(`確定刪除「${normalized.name || '這個知識組合'}」？\n\n這只會刪除你的工作副本，不會刪除正式知識卡。`);
  if (!confirmed) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add('is-busy');
  button.textContent = '刪除中...';

  try {
    if (isLocalPackageRecord(normalized)) {
      removePackageFromState(packageId);
      renderSavedPackages();
      qs('#packageHint').textContent = '已刪除本機暫存知識組合。';
      return;
    }

    if (!state.sessionToken) {
      throw new Error('請從 Discord 入口重新開啟後再刪除後端知識組合。');
    }

    const payload = await fetchJson(`${apiPath(`/api/v1/disability-knowledge/packages/${encodeURIComponent(packageId)}`)}?session=${encodeURIComponent(state.sessionToken)}`, {
      method: 'DELETE',
    });
    if (!payload.deleted) {
      throw new Error('找不到可刪除的知識組合，或你沒有刪除權限。');
    }

    removePackageFromState(packageId);
    renderSavedPackages();
    qs('#packageHint').textContent = '已刪除知識組合。';
  } catch (error) {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.textContent = originalText;
    qs('#packageHint').textContent = `刪除失敗：${error.message || error}`;
  }
}

function packageDirectionText(record) {
  const snapshots = packageSnapshots(record);
  const domains = unique(snapshots.map((card) => domainLabel(card.domain)).filter(Boolean));
  const checkTypes = unique(snapshots.flatMap((card) => cardAttributes(card)
    .filter((attr) => attr.type === 'check_type')
    .map((attr) => attr.label))
    .filter(Boolean));
  if (domains.length || checkTypes.length) {
    const domainText = domains.slice(0, 2).join('、') || '未指定主題';
    const typeText = checkTypes.slice(0, 3).join('、');
    return typeText ? `${domainText}｜${typeText}` : domainText;
  }
  const ids = asArray(record.direction_ids);
  const labels = unique(ids.map(directionLabel).filter(Boolean));
  return labels.length ? labels.slice(0, 3).join('、') : '未指定方向';
}

function packageRegionText(record) {
  const regions = unique([
    ...asArray(record.region_scope),
    ...packageSnapshots(record).flatMap((card) => asArray(card.region_scope)),
  ]);
  return regions.length ? regions.slice(0, 2).join('、') : (selectedRegions()[0] || '未指定地區');
}

function packageCardRows(record) {
  const snapshots = packageSnapshots(record);
  if (!snapshots.length) {
    return '<p class="workbench-expanded-empty">這個知識組合尚未加入知識卡。</p>';
  }
  return snapshots.map((card, index) => `
    <div class="workbench-resource-row">
      <div>
        <strong>${index + 1}. ${escapeHtml(card.title || cardId(card))}</strong>
        <span>${escapeHtml(sourceDisplaySummary(card))}</span>
      </div>
    </div>
  `).join('');
}

function renderSavedPackages() {
  const container = qs('#savedPackages');
  if (!container) return;
  const status = qs('#workbenchStatus');
  const empty = qs('#workbenchEmpty');
  const cached = readCachedKnowledgePackages();
  const merged = new Map(cached.map((record) => [String(record.package_id || record.id), normalizePackageRecord(record)]));
  state.savedPackages.forEach((record) => {
    const normalized = normalizePackageRecord(record);
    merged.set(normalized.package_id, normalized);
  });
  const records = [...merged.values()].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  if (status) {
    if (state.sessionUser) {
      const user = state.sessionUser.username || state.sessionUser.name || 'Discord 使用者';
      const id = state.sessionUser.discord_id || state.sessionUser.id || '';
      status.textContent = `目前查看 ${user}${id ? ` / ${id}` : ''} 的知識組合。`;
    } else if (state.sessionToken) {
      status.textContent = '已透過 Discord 入口開啟；若後端同步失敗，會先顯示本機暫存。';
    } else {
      status.textContent = records.length
        ? '目前顯示本機暫存；請從 Discord 入口重新開啟，才能讀取個人知識組合。'
        : '未連結 Discord，請回 Discord 重新開啟入口。';
    }
  }
  if (empty) {
    empty.hidden = records.length > 0;
    empty.textContent = state.sessionToken
      ? '目前還沒有知識組合。回到知識導航，尋找並點選知識卡後會先建立草稿。'
      : '目前是未登入瀏覽，只能使用本機暫存，不能讀取個人知識組合。';
  }
  if (!records.length) {
    const reason = state.sessionToken
      ? '目前尚未儲存知識組合。選卡後可按「儲存草稿」。'
      : '從 Discord 面板開啟後，這裡會顯示你的草稿與已產生結果；目前只能使用本機暫存。';
    container.innerHTML = `<div class="empty-state">${escapeHtml(reason)}</div>`;
    return;
  }
  container.innerHTML = records.map((record) => {
    const count = packageCount(record);
    const active = state.activePackageId === record.package_id;
    const readyOutput = hasReadyOutput(record);
    const shareUrl = resultShareUrl(record);
    const expanded = state.expandedPackageIds.has(record.package_id);
    const itemList = packageCardRows(record);
    const regionText = packageRegionText(record);
    const status = String(record.status || 'draft').replaceAll('_', '-');
    return `
      <article class="workbench-card${active ? ' active' : ''}${expanded ? ' is-expanded' : ''}" data-package-card-id="${escapeHtml(record.package_id)}" tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <div class="workbench-card-head">
          <div>
            <p class="eyebrow">知識組合｜${escapeHtml(regionText)}</p>
            <h3>${escapeHtml(record.name || '未命名知識組合')}</h3>
          </div>
          <span class="status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel(record.status))}</span>
        </div>
        <p class="workbench-meta">${escapeHtml(packageDirectionText(record))}｜知識 ${count} 張｜更新 ${escapeHtml(formatDateTime(record.updated_at))}</p>
        ${record.question_summary ? `<p class="saved-summary">${escapeHtml(record.question_summary)}</p>` : ''}
        <div class="workbench-actions">
          <button class="edit-action" type="button" data-action="edit" data-package-id="${escapeHtml(record.package_id)}">繼續編輯</button>
          <button class="primary-action" type="button" data-action="view" data-package-id="${escapeHtml(record.package_id)}">查看結果</button>
          <button class="copy-action" type="button" data-action="duplicate" data-package-id="${escapeHtml(record.package_id)}">複製此副本</button>
          <button class="danger-action" type="button" data-action="delete" data-package-id="${escapeHtml(record.package_id)}"${(!isLocalPackageRecord(record) && !state.sessionToken) ? ' disabled title="請從 Discord 入口重新開啟後再刪除後端知識組合。"' : ''}>刪除</button>
          <button class="link-action" type="button" data-action="copy-link" data-package-id="${escapeHtml(record.package_id)}" title="複製這份知識組合的結果頁連結">複製連結</button>
          <button class="qr-action" type="button" data-action="qr" data-package-id="${escapeHtml(record.package_id)}"${shareUrl ? '' : ' data-degraded="1" title="正式分享 URL 尚未建立；目前保留本機結果頁與列印。"' }>查看 QR CODE</button>
          <button class="print-action" type="button" data-action="print" data-package-id="${escapeHtml(record.package_id)}">列印 / 另存 PDF</button>
        </div>
        <div class="workbench-expanded" ${expanded ? '' : 'hidden'}>
          <h4>已選知識卡</h4>
          <div class="workbench-resource-list">${itemList}</div>
        </div>
      </article>
    `;
  }).join('');
  container.querySelectorAll('[data-package-card-id]').forEach((card) => {
    const packageId = card.dataset.packageCardId || '';
    const toggle = () => {
      if (state.expandedPackageIds.has(packageId)) state.expandedPackageIds.delete(packageId);
      else state.expandedPackageIds.add(packageId);
      renderSavedPackages();
    };
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      toggle();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
  container.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const packageId = button.dataset.packageId || '';
      const record = records.find((item) => String(item.package_id || item.id) === packageId);
      if (!record) return;
      if (button.dataset.action === 'edit') {
        applySavedPackage(packageId);
        setActiveView('knowledgeNav');
      } else if (button.dataset.action === 'view') {
        openKnowledgeResult(record);
      } else if (button.dataset.action === 'duplicate') {
        duplicatePackage(record);
        setActiveView('knowledgeNav');
      } else if (button.dataset.action === 'delete') {
        await deleteKnowledgePackage(record, button);
      } else if (button.dataset.action === 'copy-link') {
        const url = resultShareUrl(record) || resultLinkForPackage(record);
        if (url) await navigator.clipboard.writeText(url);
        button.textContent = '已複製';
        setTimeout(() => { button.textContent = '複製連結'; }, 1200);
      } else if (button.dataset.action === 'qr') {
        const url = resultShareUrl(record);
        if (!url) {
          qs('#packageHint').textContent = '正式分享 URL / QR 尚未建立；可先用「查看結果」或「列印 / 另存 PDF」。';
          button.textContent = 'QR 尚未建立';
          setTimeout(() => { button.textContent = '查看 QR CODE'; }, 1400);
          return;
        }
        qs('#packageHint').textContent = '這份知識組合已有結果連結；QR 服務接上後會在此顯示。';
      } else if (button.dataset.action === 'print') {
        openKnowledgeResult(record, { print: true });
      }
    });
  });
}

function applySavedPackage(packageId) {
  const record = [...state.savedPackages, ...readCachedKnowledgePackages()].find((item) => String(item.package_id || item.id) === String(packageId));
  if (!record) return;
  const normalized = normalizePackageRecord(record);
  const snapshots = packageSnapshots(normalized);
  state.selectedKnowledgeIds.clear();
  state.selectedCardSnapshots.clear();
  for (const snapshot of snapshots) {
    const id = cardId(snapshot);
    if (!id) continue;
    state.selectedKnowledgeIds.add(id);
    state.selectedCardSnapshots.set(id, snapshot);
  }
  state.activePackageId = normalized.package_id;
  state.currentLocalPackageId = normalized.package_id.startsWith('local_') ? normalized.package_id : '';
  state.currentDraftName = normalized.name || '未命名知識組合';
  state.currentQuestionSummary = normalized.question_summary || '';
  if (normalized.question_summary && !questionText.value.trim()) {
    questionText.value = normalized.question_summary;
  }
  state.routeResult = {
    direction_ids: asArray(normalized.direction_ids),
    directions: asArray(normalized.direction_ids).map((id) => ({
      direction_id: id,
      short_label: directionLabel(id),
      reason: '此方向來自已儲存的知識組合。',
    })),
    knowledge_cards: snapshots,
  };
  renderDirections(state.routeResult.directions);
  renderKnowledgeCards(snapshots.length ? snapshots : state.knowledgeCards.slice(0, 8), { resetAttributes: true });
  renderSavedPackages();
  renderOutputs();
  renderDraftContext(`已載入「${normalized.name || '知識組合'}」；目前正在編輯這份副本。`);
  qs('#packageHint').textContent = `已載入「${normalized.name || '知識組合'}」；結果頁會使用建立當時保存的知識卡副本。`;
}

async function loadSavedPackages({ quiet = false } = {}) {
  if (!state.sessionToken || !state.apiBase || !state.apiReady) {
    renderSavedPackages();
    return;
  }
  try {
    const payload = await fetchJson(`${apiPath('/api/v1/disability-knowledge/packages')}?session=${encodeURIComponent(state.sessionToken)}`);
    state.savedPackages = asArray(payload.packages);
    cacheKnowledgePackages(state.savedPackages);
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

function sourceRefsFromSnapshots(snapshots) {
  const refs = new Map();
  snapshots.forEach((snapshot) => {
    sourceRefs(snapshot).forEach((ref) => {
      const key = ref.source_id || ref.url || ref.label || JSON.stringify(ref);
      if (key && !refs.has(key)) refs.set(key, ref);
    });
  });
  return [...refs.values()];
}

async function buildLocalKnowledgePack(record) {
  const normalized = normalizePackageRecord(record);
  const snapshots = packageSnapshots(normalized);
  const payload = {
    schema_version: KNOWLEDGE_PACK_SCHEMA_VERSION,
    export_id: `local-kpex-${Date.now().toString(36)}`,
    exported_at: Date.now() / 1000,
    source_app_version: `disability-knowledge-nav-${CACHE_VERSION}`,
    package_metadata: {
      original_package_id: normalized.package_id,
      name: normalized.name || '知識組合',
      question_summary: normalized.question_summary || '',
      direction_ids: asArray(normalized.direction_ids),
      knowledge_ids: snapshots.map((card) => cardId(card)).filter(Boolean),
      output_mode: normalized.output_mode || 'family',
      status: normalized.status || 'local_cache',
      created_at: normalized.created_at || Math.floor(Date.now() / 1000),
      updated_at: normalized.updated_at || Math.floor(Date.now() / 1000),
      created_by: {
        discord_user_id: state.sessionUser?.id || state.sessionUser?.discord_id || '',
        discord_user_name: state.sessionUser?.name || state.sessionUser?.username || '',
      },
    },
    knowledge_snapshots: snapshots,
    comparison_digests: snapshots.map((card) => comparisonDigest(card)).filter((digest) => digest?.comparison_group),
    source_refs: sourceRefsFromSnapshots(snapshots),
    output_history: asArray(normalized.outputs).map((output) => ({
      output_id: output.output_id || output.id || '',
      output_mode: output.output_mode || output.mode || '',
      status: output.status || '',
      share_url: output.share_url || '',
      share_page_id: output.share_page_id || '',
      created_at: output.created_at || '',
      updated_at: output.updated_at || '',
    })),
    signature_status: 'unsigned-local',
  };
  payload.content_hash = await stableHash(payload);
  return payload;
}

function knowledgePackToMarkdown(pack) {
  const metadata = pack.package_metadata || {};
  const snapshots = asArray(pack.knowledge_snapshots);
  const lines = [
    `# ${metadata.name || '知識組合封包'}`,
    '',
    `- 匯出時間：${pack.exported_at || ''}`,
    `- 方向：${asArray(metadata.direction_ids).join('、') || '未指定'}`,
    `- 知識卡數：${snapshots.length}`,
    `- 封包版本：${pack.schema_version || KNOWLEDGE_PACK_SCHEMA_VERSION}`,
    '',
    '## 已選知識卡',
    '',
  ];
  snapshots.forEach((snapshot, index) => {
    lines.push(`${index + 1}. ${snapshot.title || cardId(snapshot)}`);
    lines.push(`   - 摘要：${snapshot.family_safe_summary || snapshot.knowledge_brief || ''}`);
    lines.push(`   - 來源：${sourceDisplaySummary(snapshot)}`);
    lines.push(`   - 最後確認：${snapshot.last_checked_at || '待確認'}`);
  });
  lines.push('');
  lines.push(`<!-- ${KNOWLEDGE_PACK_MANIFEST_MARKER}`);
  lines.push('```json');
  lines.push(JSON.stringify(pack, null, 2));
  lines.push('```');
  lines.push(`${KNOWLEDGE_PACK_MANIFEST_MARKER} -->`);
  lines.push('');
  return lines.join('\n');
}

function extractKnowledgePackPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('請先選擇檔案或貼上知識副本內容。');
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('封包 JSON 格式不正確。');
    return parsed;
  }
  const pattern = new RegExp(`${KNOWLEDGE_PACK_MANIFEST_MARKER}\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`\\s*${KNOWLEDGE_PACK_MANIFEST_MARKER}`);
  const match = raw.match(pattern);
  if (!match) throw new Error('找不到 KNOWLEDGE_PACK_MANIFEST 區塊。');
  return JSON.parse(match[1]);
}

function validateLocalKnowledgePack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('封包格式不正確。');
  if (pack.schema_version !== KNOWLEDGE_PACK_SCHEMA_VERSION) throw new Error(`不支援的封包版本：${pack.schema_version || '未指定'}`);
  const snapshots = asArray(pack.knowledge_snapshots).filter((snapshot) => cardId(snapshot));
  if (!snapshots.length) throw new Error('封包內沒有可匯入的知識卡 snapshot。');
  return snapshots;
}

function importKnowledgePackLocally(pack) {
  const snapshots = validateLocalKnowledgePack(pack);
  const metadata = pack.package_metadata || {};
  const now = Math.floor(Date.now() / 1000);
  const record = normalizePackageRecord({
    package_id: `local_import_${Date.now()}`,
    name: `${metadata.name || '知識組合'} 匯入副本`,
    question_summary: metadata.question_summary || '',
    direction_ids: asArray(metadata.direction_ids),
    knowledge_ids: snapshots.map((card) => cardId(card)),
    items: snapshots.map((snapshot, index) => ({
      knowledge_id: cardId(snapshot),
      knowledge_snapshot: snapshot,
      sort_order: index,
      added_at: now,
    })),
    output_mode: metadata.output_mode || 'family',
    status: 'local_cache',
    created_at: now,
    updated_at: now,
  });
  cacheKnowledgePackages([record]);
  state.savedPackages = [record, ...state.savedPackages.filter((row) => String(row.package_id || row.id) !== record.package_id)];
  applySavedPackage(record.package_id);
  return record;
}

async function exportKnowledgePackage(record, format, button = null) {
  const normalized = normalizePackageRecord(record);
  const originalText = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = '匯出中...';
  }
  try {
    let text = '';
    let filename = '';
    let mimeType = '';
    const fmt = format === 'markdown' ? 'markdown' : 'json';
    if (!isLocalPackageRecord(normalized) && state.sessionToken && state.apiBase && state.apiReady) {
      const url = `${apiPath(`/api/v1/disability-knowledge/packages/${encodeURIComponent(normalized.package_id)}/export`)}?session=${encodeURIComponent(state.sessionToken)}&format=${fmt}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      text = await response.text();
      filename = safeFilename(normalized.name, fmt === 'markdown' ? 'knowledgepack.md' : 'knowledgepack.json');
      mimeType = fmt === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8';
    } else {
      const pack = await buildLocalKnowledgePack(normalized);
      text = fmt === 'markdown' ? knowledgePackToMarkdown(pack) : JSON.stringify(pack, null, 2);
      filename = safeFilename(normalized.name, fmt === 'markdown' ? 'knowledgepack.md' : 'knowledgepack.json');
      mimeType = fmt === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8';
    }
    downloadTextFile(filename, mimeType, text);
    if (button) {
      button.classList.remove('is-busy');
      button.classList.add('is-done');
      button.textContent = '已匯出';
      setTimeout(() => {
        button.disabled = false;
        button.classList.remove('is-done');
        button.textContent = originalText;
      }, 1200);
    }
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.textContent = originalText;
    }
    const status = qs('#knowledgeExchangeStatus') || qs('#packageHint');
    if (status) status.textContent = `匯出失敗：${error.message || error}`;
  }
}

async function importKnowledgePackPayload(payload, button = null) {
  const originalText = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = '匯入中...';
  }
  const status = qs('#importKnowledgePackStatus');
  try {
    let importedRecord = null;
    if (state.sessionToken && state.apiBase && state.apiReady) {
      const response = await fetch(`${apiPath('/api/v1/disability-knowledge/packages/import')}?session=${encodeURIComponent(state.sessionToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledge_pack: payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.error === 'personal_data_warning') {
        const allow = window.confirm(`匯入內容可能包含敏感資訊：${asArray(body.warnings).join('、') || '未列出'}。\n\n仍要以目前 Discord 使用者建立草稿嗎？`);
        if (!allow) throw new Error('已取消匯入。');
        const retry = await fetch(`${apiPath('/api/v1/disability-knowledge/packages/import')}?session=${encodeURIComponent(state.sessionToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ knowledge_pack: payload, allowPersonalData: true }),
        });
        const retryBody = await retry.json().catch(() => ({}));
        if (!retry.ok || retryBody.ok === false) throw new Error(retryBody.error || `HTTP ${retry.status}`);
        importedRecord = normalizePackageRecord(retryBody.package);
      } else {
        if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
        importedRecord = normalizePackageRecord(body.package);
      }
      cacheKnowledgePackages([importedRecord]);
      state.savedPackages = [importedRecord, ...state.savedPackages.filter((row) => String(row.package_id || row.id) !== importedRecord.package_id)];
    } else {
      importedRecord = importKnowledgePackLocally(payload);
    }
    if (status) status.textContent = `已匯入「${importedRecord.name || '知識組合'}」，並建立新的草稿。`;
    applySavedPackage(importedRecord.package_id);
    renderSavedPackages();
    renderKnowledgeExchange();
    setActiveView('knowledgePack');
  } catch (error) {
    if (status) status.textContent = `匯入失敗：${error.message || error}`;
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.textContent = originalText;
    }
  }
}

async function importKnowledgePackFromInputs(button = null) {
  const fileInput = qs('#knowledgePackFileInput');
  const pasteInput = qs('#knowledgePackPasteInput');
  const file = fileInput?.files?.[0] || null;
  const text = file ? await file.text() : (pasteInput?.value || '');
  const payload = extractKnowledgePackPayload(text);
  await importKnowledgePackPayload(payload, button);
}

function exchangeRecordRows() {
  const cached = readCachedKnowledgePackages();
  const merged = new Map(cached.map((record) => [String(record.package_id || record.id), normalizePackageRecord(record)]));
  state.savedPackages.forEach((record) => {
    const normalized = normalizePackageRecord(record);
    merged.set(normalized.package_id, normalized);
  });
  return [...merged.values()].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
}

function renderKnowledgeExchange() {
  const list = qs('#knowledgeExchangeExportList');
  const empty = qs('#knowledgeExchangeEmpty');
  const status = qs('#knowledgeExchangeStatus');
  if (!list) return;
  const records = exchangeRecordRows();
  if (status) {
    if (state.sessionUser) {
      const user = state.sessionUser.username || state.sessionUser.name || 'Discord 使用者';
      status.textContent = `目前可匯入／匯出 ${user} 的知識組合；後端不可用時仍可匯出本機暫存封包。`;
    } else {
      status.textContent = '未連結 Discord 時可處理本機暫存副本；後端草稿需從 Discord 入口重新開啟後同步。';
    }
  }
  if (empty) empty.hidden = records.length > 0;
  if (!records.length) {
    list.innerHTML = '<div class="empty-state">目前沒有可匯出的知識組合。回到知識導航建立副本後，這裡會出現匯出選項。</div>';
    return;
  }
  list.innerHTML = records.map((record) => {
    const count = packageCount(record);
    const regionText = packageRegionText(record);
    const statusClass = String(record.status || 'draft').replaceAll('_', '-');
    return `
      <article class="workbench-card exchange-card" data-exchange-card-id="${escapeHtml(record.package_id)}">
        <div class="workbench-card-head">
          <div>
            <p class="eyebrow">知識組合｜${escapeHtml(regionText)}</p>
            <h3>${escapeHtml(record.name || '未命名知識組合')}</h3>
          </div>
          <span class="status-badge ${escapeHtml(statusClass)}">${escapeHtml(statusLabel(record.status))}</span>
        </div>
        <p class="workbench-meta">${escapeHtml(packageDirectionText(record))}｜知識 ${count} 張｜更新 ${escapeHtml(formatDateTime(record.updated_at))}</p>
        ${record.question_summary ? `<p class="saved-summary">${escapeHtml(record.question_summary)}</p>` : ''}
        <div class="workbench-actions exchange-actions">
          <button class="edit-action" type="button" data-exchange-action="export-json" data-package-id="${escapeHtml(record.package_id)}">匯出封包 JSON</button>
          <button class="link-action" type="button" data-exchange-action="export-markdown" data-package-id="${escapeHtml(record.package_id)}">匯出 Markdown</button>
          <button class="print-action" type="button" data-exchange-action="print" data-package-id="${escapeHtml(record.package_id)}">列印 / 另存 PDF</button>
        </div>
      </article>
    `;
  }).join('');
  list.querySelectorAll('[data-exchange-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const packageId = button.dataset.packageId || '';
      const record = records.find((item) => String(item.package_id || item.id) === packageId);
      if (!record) return;
      const action = button.dataset.exchangeAction;
      if (action === 'export-json') await exportKnowledgePackage(record, 'json', button);
      else if (action === 'export-markdown') await exportKnowledgePackage(record, 'markdown', button);
      else if (action === 'print') openKnowledgeResult(record, { print: true });
    });
  });
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
  if (viewName === 'knowledgePack') {
    renderOutputs();
    renderSavedPackages();
    if (state.sessionToken && state.apiBase && state.apiReady) {
      void loadSavedPackages({ quiet: true });
    }
  } else if (viewName === 'knowledgeExchange') {
    renderKnowledgeExchange();
    if (state.sessionToken && state.apiBase && state.apiReady) {
      void loadSavedPackages({ quiet: true }).then(() => renderKnowledgeExchange());
    }
  }
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
  renderPackage(cards);
  const hint = state.sessionToken
    ? '已從 Discord 入口取得身份連結，可儲存草稿；輸出內容請按「查看目前結果」。'
    : '目前沒有 Discord 身份連結，只能使用本頁暫存；請從 Discord 入口重新開啟才能同步到個人工作台。';
  qs('#packageHint').textContent = cards.length
    ? `${hint} 目前副本含 ${cards.length} 張知識卡。`
    : '尚未加入知識卡。請回到知識導航輸入問題或點選候選卡。';
  if (cards.length) cacheKnowledgePackages([currentPackageRecord({ status: state.activePackageId ? 'draft' : 'local_cache' })]);
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
      startCurrentDraft({ question, directions, cards, source: 'api', routeMeta: payload });
      renderDirections(directions);
      renderKnowledgeCards(cards, { resetAttributes: true });
      void autoSaveDraft();
      qs('#apiStatus').textContent = glmStatusText(payload, 'api');
      return;
    } catch (error) {
      qs('#apiStatus').textContent = 'GLM狀態：斷線／採本地簡易搜索';
    }
  }
  const localCards = localKnowledgeSearch(question, [], 12, selectedRegions());
  state.routeResult = { directions: [], knowledge_cards: localCards };
  startCurrentDraft({ question, directions: [], cards: localCards, source: 'local', routeMeta: {} });
  renderDirections([]);
  renderKnowledgeCards(localCards, { resetAttributes: true });
  qs('#apiStatus').textContent = 'GLM狀態：斷線／採本地簡易搜索';
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
    state.currentLocalPackageId = '';
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
  const text = selectedCards().map((card, index) => `${index + 1}. ${card.title || cardId(card)}\n${card.family_safe_summary || ''}`).join('\n\n');
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
  setupRegionSelector();
  renderDirections([]);
  renderKnowledgeCards(state.knowledgeCards.slice(0, 8), { resetAttributes: true });
  renderGenerationHistory();
  renderOutputs();
  renderDraftContext();
  await loadSavedPackages({ quiet: true });
  focusKnowledgeCardFromUrl();
  questionText.addEventListener('input', privacyMessage);
  qs('#routeButton').addEventListener('click', routeQuestion);
  qs('#closeCardDetailButton').addEventListener('click', closeCardDetail);
  qs('#cardDetailOverlay').addEventListener('click', (event) => {
    if (event.target === qs('#cardDetailOverlay')) closeCardDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCardDetail();
  });
  qs('#saveDraftButton').addEventListener('click', saveDraft);
  qs('#saveDraftInlineButton').addEventListener('click', saveDraft);
  qs('#viewCurrentResultButton').addEventListener('click', () => {
    const cards = selectedCards();
    if (!cards.length) {
      qs('#packageHint').textContent = '請先加入至少一張知識卡，再查看結果。';
      return;
    }
    openKnowledgeResult(currentPackageRecord({ status: state.activePackageId ? 'draft' : 'local_cache' }));
  });
  qs('#clearDraftButton').addEventListener('click', clearCurrentDraft);
  qs('#draftNameInput').addEventListener('input', (event) => {
    state.currentDraftName = String(event.target.value || '').trim();
    renderDraftContext();
  });
  const workbenchNameInput = qs('#workbenchDraftNameInput');
  if (workbenchNameInput) {
    workbenchNameInput.addEventListener('input', (event) => {
      state.currentDraftName = String(event.target.value || '').trim();
      const hiddenInput = qs('#draftNameInput');
      if (hiddenInput) hiddenInput.value = state.currentDraftName;
      renderDraftContext();
      renderPackage(selectedCards());
    });
  }
  qs('#refreshPackagesButton').addEventListener('click', () => loadSavedPackages());
  qs('#importKnowledgePackButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    void importKnowledgePackFromInputs(event.currentTarget);
  });
  qs('#clearImportKnowledgePackButton')?.addEventListener('click', (event) => {
    event.preventDefault();
    const fileInput = qs('#knowledgePackFileInput');
    const pasteInput = qs('#knowledgePackPasteInput');
    if (fileInput) fileInput.value = '';
    if (pasteInput) pasteInput.value = '';
    const status = qs('#importKnowledgePackStatus');
    if (status) status.textContent = '已清除匯入內容。';
  });
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
