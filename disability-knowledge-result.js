(function () {
  const STORAGE_KEY = 'disability_knowledge_packages_v1';
  const CACHE_VERSION = '20260622-attribute-collapse-v2';
  let activeMode = new URLSearchParams(window.location.search).get('output') || localStorage.getItem('disability_knowledge_result_mode_v1') || 'family';
  if (activeMode === 'boundary' || activeMode === 'comparison') activeMode = 'analysis';
  let activePackage = null;
  let cards = [];

  function $(id) {
    return document.getElementById(id);
  }

  function asList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function unique(items) {
    return Array.from(new Set(items.flat(Infinity).filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

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
    family_caregiver_support: '家庭照顧者支持服務',
    foreign_caregiver_care_gap: '外籍看護短期空窗照顧',
    transport_access: '交通服務與復康巴士',
    transport_access_scope: '交通接送服務範圍',
    transport_service_type_difference: '交通服務類型差異',
    transport_resource_boundary: '交通服務資源卡邊界',
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
    disability_assistive_system_entry: '身障輔具制度與輔具中心入口',
    smart_assistive_product_leads: '智慧輔具產品線索',
    smart_assistive_legacy_alias: '智慧輔具舊方向參考',
  };

  function labelText(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^[a-z0-9_:-]+$/.test(raw)) return raw.replaceAll('_', '／');
    return raw;
  }

  function comparisonGroupLabel(group, fallback = '') {
    const raw = String(group || '').trim();
    const fallbackText = String(fallback || '').trim();
    if (COMPARISON_GROUP_LABELS[raw]) return COMPARISON_GROUP_LABELS[raw];
    if (fallbackText && !/^[a-z0-9_:-]+$/.test(fallbackText)) return fallbackText;
    return labelText(raw || fallbackText) || '未指定比較屬性';
  }

  function packageIdFromUrl() {
    return new URLSearchParams(window.location.search).get('package_id') || '';
  }

  function shouldAutoPrint() {
    return new URLSearchParams(window.location.search).get('print') === '1';
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

  function readPackages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.info('knowledge package cache unreadable', error);
      return [];
    }
  }

  function cardId(card) {
    return String(card?.knowledge_id || card?.id || '').trim();
  }

  function packageCards(record) {
    return asList(record?.items)
      .map((item) => item.knowledge_snapshot || item.snapshot || item)
      .filter((snapshot) => snapshot && cardId(snapshot));
  }

  function lineList(items, fallback = '尚待補齊，請先回官方窗口查證。') {
    const rows = unique(asList(items));
    if (!rows.length) return fallback;
    return rows.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }

  function compactText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function sourceRefs(card) {
    return asList(card.source_refs || card.sources || []).map((ref) => typeof ref === 'string' ? { title: ref } : ref);
  }

  function sourceLinkStatus(url, sourceId = '', title = '') {
    const normalizedUrl = String(url || '').trim();
    if (/^https?:\/\//i.test(normalizedUrl)) {
      if (/\/disability-sources\/[^?#]+\.html(?:[?#].*)?$/i.test(normalizedUrl)) return 'public_readable';
      if (/\/disability-sources\/[^?#]+\.json(?:[?#].*)?$/i.test(normalizedUrl)) return 'machine_snapshot';
      return /\/disability-sources\//i.test(normalizedUrl) ? 'public_download' : 'public_url';
    }
    if (/^file:\/\//i.test(normalizedUrl) || normalizedUrl.startsWith('/')) return 'local_file';
    if (/gap|缺口/i.test(String(sourceId || '')) || /缺口/.test(String(title || ''))) return 'source_gap';
    return 'missing_public_url';
  }

  function sourceLinkStatusLabel(status) {
    if (status === 'public_readable') return '來源整理頁';
    if (status === 'public_download') return '公開附件下載／閱覽';
    if (status === 'machine_snapshot') return '機器資料快照（內部備查）';
    if (status === 'local_file') return '本機已讀附件，公開連結待補';
    if (status === 'source_gap') return '無公開來源連結：制度缺口說明';
    if (status === 'missing_public_url') return '公開連結待補';
    return '';
  }

  function sourceRefMap(card) {
    const map = new Map();
    sourceRefs(card).forEach((ref) => {
      if (!ref || typeof ref !== 'object') return;
      const id = String(ref.source_id || '').trim();
      if (id) map.set(id, ref);
    });
    return map;
  }

  function sourceLineText(ref, index) {
    const title = ref.title || ref.source_id || '來源';
    const level = ref.source_level || ref.level || '待確認';
    const checked = ref.last_checked_at || '待確認';
    const status = ref.source_link_status || sourceLinkStatus(ref.url, ref.source_id, title);
    const statusLabel = sourceLinkStatusLabel(status);
    const linkText = /^https?:\/\//i.test(String(ref.url || ''))
      ? ref.url
      : (statusLabel || '無公開連結');
    return `${index + 1}. ${title}｜${level}｜最後確認：${checked}｜${linkText}${statusLabel ? `｜${statusLabel}` : ''}`;
  }

  function sourceText(card) {
    const refs = sourceRefs(card);
    if (!refs.length) return '來源待補官方資料。';
    return refs.map((ref, index) => sourceLineText(normalizeSourceRef(ref), index)).join('\n');
  }

  function sourceExtractRefs(card) {
    const extracts = Array.isArray(card?.source_extracts) ? card.source_extracts : [];
    const refsById = sourceRefMap(card);
    return extracts.map((extract) => ({
      source_id: extract.source_id || '',
      title: extract.source_title || extract.title || refsById.get(extract.source_id)?.title || extract.source_id || '來源',
      source_level: extract.source_level || '待確認',
      url: extract.source_url || extract.url || refsById.get(extract.source_id)?.url || '',
      last_checked_at: extract.updated_at || extract.last_checked_at || '待確認',
      source_link_status: extract.source_link_status,
    }));
  }

  function cardSources(card) {
    const refs = [
      ...sourceRefs(card),
      ...sourceExtractRefs(card),
    ].map(normalizeSourceRef).filter(Boolean);
    const seen = new Set();
    return refs.filter((ref) => {
      const key = sourceKey(ref);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function cardContacts(card) {
    const raw = asList(card.suggested_contacts || card.contact_windows || card.check_contacts);
    return raw.map((contact) => {
      if (contact && typeof contact === 'object') {
        return {
          label: contact.label || contact.name || contact.title || contact.window || '查證窗口',
          role: contact.role || contact.purpose || contact.reason || '',
          phone: contact.phone || '',
          url: contact.url || '',
        };
      }
      return { label: String(contact || '').trim(), role: '', phone: '', url: '' };
    }).filter((contact) => contact.label);
  }

  function contactHtml(contact) {
    const phone = String(contact.phone || '').trim();
    const url = String(contact.url || '').trim();
    const phoneHtml = phone && !phone.includes('依地方公告')
      ? `<a href="tel:${escapeHtml(phone.replace(/\s+/g, ''))}">${escapeHtml(phone)}</a>`
      : (phone ? `<span>${escapeHtml(phone)}</span>` : '');
    const urlHtml = /^https?:\/\//.test(url)
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '';
    return `
      <div class="result-info-row">
        <strong>${escapeHtml(contact.label)}</strong>
        ${contact.role ? `<span>${escapeHtml(contact.role)}</span>` : ''}
        ${phoneHtml || urlHtml ? `<small>${[phoneHtml, urlHtml].filter(Boolean).join('｜')}</small>` : ''}
      </div>
    `;
  }

  function sourceLinkListHtml(sources) {
    if (!sources.length) return '<p class="muted-text">來源連結待補。</p>';
    return `<div class="result-info-stack">${sources.map((ref) => {
      const title = ref.title || ref.source_id || '來源';
      const level = ref.source_level || ref.level || '待確認';
      const checked = ref.last_checked_at || '待確認';
      const status = ref.source_link_status || sourceLinkStatus(ref.url, ref.source_id, title);
      const statusLabel = sourceLinkStatusLabel(status);
      const titleHtml = /^https?:\/\//i.test(String(ref.url || ''))
        ? `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      const statusText = statusLabel ? `｜${statusLabel}` : '';
      return `<div class="result-info-row result-source-row">${titleHtml}<span>${escapeHtml(level)}｜最後確認：${escapeHtml(checked)}${escapeHtml(statusText)}</span></div>`;
    }).join('')}</div>`;
  }

  function normalizeSystemSide(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (['ltc', 'long_term_care', 'longtermcare', '長照'].includes(raw)) return 'ltc';
    if (['disability', '身障', 'disabled'].includes(raw)) return 'disability';
    if (['shared', '共同'].includes(raw)) return 'shared';
    return '';
  }

  const COMPARISON_FACT_LABELS = [
    '制度狀態',
    '適用對象',
    '給付／額度',
    '取得方式',
    '品項／範圍',
    '評估／文件',
    '申請／查證窗口',
    '限制／注意',
  ];

  function sourceKey(ref) {
    return String(ref?.source_id || ref?.url || ref?.title || '').trim();
  }

  function normalizeSourceRef(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') {
      const value = ref.trim();
      return value ? { source_id: value, title: value, source_level: '待確認' } : null;
    }
    if (typeof ref !== 'object') return null;
    const sourceId = String(ref.source_id || ref.id || '').trim();
    const title = String(ref.title || ref.source_title || sourceId || '來源').trim();
    const url = ref.url || ref.source_url || '';
    return {
      source_id: sourceId,
      title,
      source_level: ref.source_level || ref.level || '待確認',
      url,
      last_checked_at: ref.last_checked_at || ref.updated_at || '待確認',
      public_allowed: ref.public_allowed,
      source_link_status: ref.source_link_status || sourceLinkStatus(url, sourceId, title),
    };
  }

  function resolveProfileSources(card, profile) {
    const cardRefs = (Array.isArray(card?.source_refs) ? card.source_refs : [])
      .map(normalizeSourceRef)
      .filter(Boolean);
    const byId = new Map(cardRefs.map((ref) => [ref.source_id, ref]));
    const rawRefs = Array.isArray(profile?.source_refs) && profile.source_refs.length
      ? profile.source_refs
      : cardRefs;
    const resolved = rawRefs.map((ref) => {
      if (typeof ref === 'string') {
        return byId.get(ref) || normalizeSourceRef(ref);
      }
      const normalized = normalizeSourceRef(ref);
      if (normalized?.source_id && byId.has(normalized.source_id)) return byId.get(normalized.source_id);
      return normalized;
    }).filter(Boolean);
    const seen = new Set();
    return resolved.filter((ref) => {
      const key = sourceKey(ref);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function comparisonSummaryItems(card, profile = null) {
    const raw = card?.comparison_summary || profile?.comparison_summary || profile?.summary || [];
    return asList(raw).map(compactText).filter(Boolean);
  }

  function comparisonProfile(card) {
    const profile = card?.comparison_profile && typeof card.comparison_profile === 'object' ? card.comparison_profile : {};
    const group = String(profile.comparison_group || card?.comparison_group || '').trim();
    const side = normalizeSystemSide(profile.system_side || card?.system_side || card?.side);
    if (!group || !['ltc', 'disability'].includes(side)) return null;
    const summary = comparisonSummaryItems(card, profile);
    if (!summary.length) return null;
    return {
      card_id: cardId(card),
      group,
      label: comparisonGroupLabel(group, profile.group_label || card?.comparison_group_label || profile.title || card?.title || cardId(card)),
      side,
      card_title: card?.title || profile.title || cardId(card),
      profile_title: profile.title || card?.title || cardId(card),
      summary,
      source_refs: resolveProfileSources(card, profile),
    };
  }

  function groupedComparisons() {
    const groups = new Map();
    const skipped = [];
    cards.forEach((card) => {
      const profile = comparisonProfile(card);
      if (!profile) {
        skipped.push(card);
        return;
      }
      if (!groups.has(profile.group)) {
        groups.set(profile.group, {
          label: profile.label,
          profiles: [],
          ltcProfiles: [],
          disabilityProfiles: [],
        });
      }
      const group = groups.get(profile.group);
      group.profiles.push(profile);
      if (profile.side === 'ltc') group.ltcProfiles.push(profile);
      if (profile.side === 'disability') group.disabilityProfiles.push(profile);
    });
    return { groups: [...groups.values()], skipped };
  }

  function familySummaryForCard(card) {
    return compactText(card.integrated_content || card.knowledge_brief || card.family_safe_summary || '');
  }

  function buildFamilyText() {
    return cards.map((card, index) => {
      const body = familySummaryForCard(card) || '此卡尚待補齊摘要。';
      return `${index + 1}. ${card.title || cardId(card)}\n${body}`;
    }).join('\n\n') || '尚未加入知識卡。';
  }

  function buildFamilyHtml() {
    if (!cards.length) return '<div class="empty-state">尚未加入知識卡。</div>';
    return `<div class="result-family-list">${cards.map((card, index) => {
      const body = familySummaryForCard(card) || '此卡尚待補齊摘要。';
      return `
        <article class="result-family-card">
          <h4>${index + 1}. ${escapeHtml(card.title || cardId(card))}</h4>
          <p>${escapeHtml(body)}</p>
        </article>
      `;
    }).join('')}</div>`;
  }

  function buildActionHtml() {
    if (!cards.length) return '<div class="empty-state">尚未加入知識卡。</div>';
    return `<div class="result-action-grid">${cards.map((card, index) => {
      const contacts = cardContacts(card);
      const sources = cardSources(card);
      return `
        <article class="result-action-card">
          <h4>${index + 1}. ${escapeHtml(card.title || cardId(card))}</h4>
          <div class="result-action-card-body">
            <section>
              <h5>查證窗口／資源卡</h5>
              ${contacts.length
                ? `<div class="result-info-stack">${contacts.map(contactHtml).join('')}</div>`
                : '<p class="muted-text">待補明確查證窗口或資源卡連結。</p>'}
            </section>
            <section>
              <h5>來源連結</h5>
              ${sourceLinkListHtml(sources)}
            </section>
          </div>
        </article>
      `;
    }).join('')}</div>`;
  }

  function integratedTextForCard(card) {
    const sections = Array.isArray(card.integrated_sections) ? card.integrated_sections : [];
    if (sections.length) {
      return sections.map((section) => {
        const title = compactText(section.title || '內容段落');
        const body = compactText(section.body || '');
        const points = asList(section.points).map(compactText).filter(Boolean).map((point) => `- ${point}`).join('\n');
        return [title, body, points].filter(Boolean).join('\n');
      }).join('\n\n');
    }
    return compactText(card.integrated_content || '');
  }

  function cardPromptBlock(card, index) {
    const sources = cardSources(card);
    const comparisonLabel = comparisonGroupLabel(
      card.comparison_group,
      card.comparison_group_label || card?.comparison_profile?.group_label || card?.comparison_profile?.title || card?.title || cardId(card),
    );
    const sourceLines = sources.length
      ? sources.map((ref, idx) => sourceLineText(ref, idx)).join('\n')
      : '來源待補。';
    return [
      `## ${index + 1}. ${card.title || cardId(card)}`,
      `側別：${card.system_side || '未標示'}｜同屬性：${comparisonLabel}`,
      `摘要：${compactText(card.knowledge_brief || card.family_safe_summary || '')}`,
      '內容整合：',
      integratedTextForCard(card) || '內容整合待補。',
      '來源連結：',
      sourceLines,
    ].join('\n');
  }

  const ANALYSIS_COMMON_LIMITS = [
    '只能使用「已選知識卡資料」中的摘要、內容整合、來源標題與 URL/PDF 連結。',
    '不可判定資格、不可承諾補助金額、不可寫成核定結果。',
    '不可把廠商頁、新聞、展覽或案例寫成官方制度結論。',
    '沒有資料的一側或欄位必須寫「資料從缺」，不能推論補滿。',
    '每個具體結論後方都要標註來源標題或來源 URL；無來源支撐就放到資料缺口。',
  ];

  const ANALYSIS_ACTIONS = [
    {
      id: 'ltc_disability_compare',
      label: '長照 VS 身障對照',
      task: '把已選知識卡中可支撐的內容整理成長照側與身障側對照。重點是呈現資料差異，不是替個案判斷走哪一邊。',
      output: [
        '一、對照總覽：用 3 到 5 句說明目前資料能比較到什麼、哪一側資料不足。',
        '二、雙欄對照表：列出「制度位置、適用對象、給付／租賃／購置、品項／範圍、評估／文件、申請／查證窗口、資料缺口」。每格後方標註來源。',
        '三、不能比較的項目：列出因缺來源或只有單側資料而不能比較的地方。',
      ],
    },
    {
      id: 'rental_responsibility',
      label: '智慧輔具租賃責任整理',
      task: '整理智慧輔具或長照輔具租賃服務中，來源有提到的維修、退租、清潔消毒、回收整備與供應端責任。',
      output: [
        '一、租賃責任摘要：用短段落整理目前資料確定說了什麼。',
        '二、責任項目表：列出「維修、換機、退租、清潔消毒、回收整備、運送／安裝／教學、資料缺口」。每列標註來源。',
        '三、沒有來源支撐的問題：列出已選資料沒有回答、不能替供應商承諾的項目。',
      ],
    },
    {
      id: 'app_network_operation',
      label: 'APP／網路操作條件整理',
      task: '整理智慧輔具可能涉及的 APP、帳號、網路、通知資料、資料回傳與家屬操作條件。只整理來源有寫到的內容。',
      output: [
        '一、操作條件摘要：說明目前資料確定提到哪些 APP／網路／通知相關條件。',
        '二、條件表：列出「設備或系統、APP／帳號、網路需求、通知或資料回傳、照顧者操作、故障或中斷處理、資料缺口」。每列標註來源。',
        '三、不可推論事項：列出資料沒有明寫、不能由產品名稱推論的地方。',
      ],
    },
    {
      id: 'family_draft',
      label: '家屬版說明草稿',
      task: '把已選知識卡改寫成家屬可讀的保守說明。語氣要清楚、直接，但不能超出來源資料。',
      output: [
        '一、家屬版說明：用 2 到 4 段白話說明目前資料可確認的內容。',
        '二、需要保留的限制語：列出不能承諾資格、補助金額或核定的句子。',
        '三、來源清單：列出支撐說明的來源標題與連結。',
      ],
    },
    {
      id: 'phone_questions',
      label: '電話確認前問題整理',
      task: '把已選知識卡中的資料缺口與來源重點，整理成電話或聯絡窗口前可用的問題清單。',
      output: [
        '一、依窗口分組問題：依「地方照管或長照承辦、地方輔具中心、社會局身障福利窗口、供應單位或特約單位」分組；沒有資料支撐的窗口不要硬列。',
        '二、每題對應來源：每個問題後方標註是根據哪一筆來源或哪個資料缺口而來。',
        '三、暫不適合詢問或不可外推事項：列出資料不足、不能拿去當結論的地方。',
      ],
    },
  ];
  let activeAnalysisId = ANALYSIS_ACTIONS[0].id;

  function buildAnalysisPrompt(actionId = activeAnalysisId) {
    const action = ANALYSIS_ACTIONS.find((item) => item.id === actionId) || ANALYSIS_ACTIONS[0];
    const cardBlocks = cards.map(cardPromptBlock).join('\n\n---\n\n') || '尚未加入知識卡。';
    return [
      '你是長照與身障資料整理助手。請用繁體中文回覆。',
      '',
      '# 任務定位',
      action.task,
      '',
      '# 可使用資料',
      '你只能使用下方「已選知識卡資料」中的內容：卡片標題、側別、同屬性、摘要、內容整合、來源標題、URL 或 PDF 連結。',
      '可以重新組織、濃縮、對照，但不能新增來源外的制度內容。',
      '',
      '# 禁止事項',
      ANALYSIS_COMMON_LIMITS.map((item, index) => `${index + 1}. ${item}`).join('\n'),
      '',
      '# 資料不足處理',
      '如果資料沒有提到，請明確寫「資料從缺」。',
      '如果只有長照側或只有身障側資料，另一側不要推論。',
      '如果只有廠商、新聞、展覽或案例來源，請標示為「只能作線索，不能作正式制度結論」。',
      '',
      '# 請輸出',
      action.output.join('\n'),
      '',
      '# 已選知識卡資料',
      cardBlocks,
    ].join('\n');
  }

  function renderAnalysis() {
    const buttons = $('analysisActionButtons');
    const output = $('analysisPromptOutput');
    if (!buttons || !output) return;
    buttons.innerHTML = ANALYSIS_ACTIONS.map((action) => `<button type="button" class="analysis-action-button${action.id === activeAnalysisId ? ' is-active' : ''}" data-analysis-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join('');
    output.value = buildAnalysisPrompt(activeAnalysisId);
    buttons.querySelectorAll('[data-analysis-action]').forEach((button) => {
      button.addEventListener('click', () => {
        activeAnalysisId = button.dataset.analysisAction || ANALYSIS_ACTIONS[0].id;
        renderAnalysis();
      });
    });
  }

  function saveAnalysisReturn() {
    const input = $('analysisReturnText');
    if (!activePackage || !input) return;
    activePackage.ai_analysis_note = input.value || '';
    activePackage.ai_analysis_updated_at = Math.floor(Date.now() / 1000);
    const records = readPackages();
    const targetId = String(activePackage.package_id || activePackage.id || '');
    const next = records.map((record) => String(record.package_id || record.id || '') === targetId ? activePackage : record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function copyAnalysisPrompt() {
    const output = $('analysisPromptOutput');
    const text = output?.value || '';
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const scratch = $('resultCopyScratch');
    scratch.value = text;
    scratch.select();
    document.execCommand('copy');
    scratch.value = '';
  }

  function openGoogleSearchWithPrompt() {
    const output = $('analysisPromptOutput');
    const prompt = output?.value || '';
    const query = encodeURIComponent(prompt.slice(0, 1800));
    window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer');
  }


  function renderSourceList(profiles, emptyText) {
    const refs = [];
    const seen = new Set();
    profiles.forEach((profile) => {
      profile.source_refs.forEach((ref) => {
        const key = sourceKey(ref);
        if (!key || seen.has(key)) return;
        seen.add(key);
        refs.push(ref);
      });
    });
    if (!refs.length) return `<div class="compare-missing">${escapeHtml(emptyText)}</div>`;
    return `<ul class="compare-source-list">${refs.map((ref) => {
      const title = ref.title || ref.source_id || '來源';
      const level = ref.source_level || ref.level || '待確認';
      const checked = ref.last_checked_at || '待確認';
      const titleHtml = ref.url
        ? `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      return `<li>${titleHtml}<span>${escapeHtml(level)}｜最後確認：${escapeHtml(checked)}</span></li>`;
    }).join('')}</ul>`;
  }

  function knowledgeCardHref(cardIdValue) {
    const params = new URLSearchParams({ v: CACHE_VERSION });
    if (cardIdValue) params.set('focus_card', cardIdValue);
    return `./disability-resource.html?${params.toString()}`;
  }

  function renderProfileCards(profiles, emptyText) {
    if (!profiles.length) return `<div class="compare-missing">${escapeHtml(emptyText)}</div>`;
    return profiles.map((profile) => `
      <article class="compare-summary-card">
        <h5>${escapeHtml(profile.profile_title || profile.card_title)}</h5>
        <ul>${profile.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <a class="compare-card-link" href="${escapeHtml(knowledgeCardHref(profile.card_id))}">查看此知識卡</a>
      </article>
    `).join('');
  }

  function renderComparison() {
    const container = $('comparisonOutput');
    const { groups, skipped } = groupedComparisons();
    if (!groups.length) {
      container.innerHTML = '<div class="empty-state">目前選取的知識卡沒有可比較的同屬性資料。</div>';
      return;
    }
    container.innerHTML = groups.map((group) => `
      <article class="compare-profile-table compare-summary-table">
        <div class="comparison-group-title">
          <h4>${escapeHtml(group.label)}</h4>
          <span class="tag compare-tag">${group.profiles.length} 張知識卡｜長照 ${group.ltcProfiles.length}｜身障 ${group.disabilityProfiles.length}</span>
        </div>
        <div class="compare-two-column">
          <section>
            <h5>長照側</h5>
            ${renderProfileCards(group.ltcProfiles, '從缺：尚未加入同屬性的長照側知識卡。')}
          </section>
          <section>
            <h5>身障側</h5>
            ${renderProfileCards(group.disabilityProfiles, '從缺：尚未加入同屬性的身障側知識卡。')}
          </section>
        </div>
        <div class="compare-profile-sources">
          <section>
            <h5>長照側來源</h5>
            ${renderSourceList(group.ltcProfiles, '從缺：尚未加入長照側來源。')}
          </section>
          <section>
            <h5>身障側來源</h5>
            ${renderSourceList(group.disabilityProfiles, '從缺：尚未加入身障側來源。')}
          </section>
        </div>
      </article>
    `).join('') + (skipped.length ? `<div class="empty-state">以下知識卡沒有精簡比較資料，不列入同屬性比較：${skipped.map((card) => escapeHtml(card.title || cardId(card))).join('、')}</div>` : '');
  }

  function renderFullData() {
    const container = $('fullOutput');
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state">尚未加入知識卡。</div>';
      return;
    }
    container.innerHTML = `
      <article class="result-full-section">
        <h3>家屬版</h3>
        ${buildFamilyHtml()}
      </article>
      <article class="result-full-section">
        <h3>查證行動</h3>
        ${buildActionHtml()}
      </article>
    `;
  }

  function setMode(mode) {
    activeMode = mode || 'family';
    localStorage.setItem('disability_knowledge_result_mode_v1', activeMode);
    document.querySelectorAll('[data-output-mode]').forEach((button) => {
      const active = button.dataset.outputMode === activeMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-output-section]').forEach((section) => {
      const modes = String(section.dataset.outputSection || '').split(/\s+/).filter(Boolean);
      section.hidden = !modes.includes(activeMode);
    });
  }

  function render() {
    const id = packageIdFromUrl();
    const records = readPackages();
    activePackage = records.find((record) => String(record.package_id || record.id) === id) || records[0] || null;
    cards = packageCards(activePackage);
    if (!activePackage || !cards.length) {
      $('resultMissing').hidden = false;
      $('resultPackageTitle').textContent = '找不到知識組合';
      $('resultPackageMeta').textContent = '請回知識導航重新儲存副本，或確認瀏覽器沒有清除本機資料。';
      return;
    }
    $('resultMissing').hidden = true;
    $('resultPackageTitle').textContent = activePackage.name || '未命名知識組合';
    $('resultPackageMeta').textContent = [
      `狀態：${activePackage.status || 'draft'}`,
      `知識卡：${cards.length} 張`,
      `更新：${formatDateTime(activePackage.updated_at)}`,
      activePackage.question_summary ? `問題摘要：${activePackage.question_summary}` : '',
    ].filter(Boolean).join('｜');
    $('familyOutput').textContent = buildFamilyText();
    $('actionOutput').innerHTML = buildActionHtml();
    renderAnalysis();
    renderFullData();
    setMode(activeMode);
    if (shouldAutoPrint() && typeof window.print === 'function') {
      setTimeout(() => window.print(), 150);
    }
  }

  async function copyTextFromNode(id, button) {
    const node = $(id);
    const text = node?.innerText || node?.textContent || '';
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const scratch = $('resultCopyScratch');
      scratch.value = text;
      scratch.select();
      document.execCommand('copy');
      scratch.value = '';
    }
    const original = button.textContent;
    button.textContent = '已複製';
    setTimeout(() => { button.textContent = original; }, 1200);
  }

  function init() {
    document.querySelectorAll('[data-output-mode]').forEach((button) => {
      button.addEventListener('click', () => setMode(button.dataset.outputMode));
    });
    document.querySelectorAll('.copy-button[data-copy-target]').forEach((button) => {
      button.addEventListener('click', () => copyTextFromNode(button.dataset.copyTarget, button));
    });
    const printButton = $('printResultButton');
    if (printButton) printButton.addEventListener('click', () => window.print());
    const copyAnalysisButton = $('copyAnalysisPromptButton');
    if (copyAnalysisButton) copyAnalysisButton.addEventListener('click', copyAnalysisPrompt);
    const openGoogleButton = $('openGoogleSearchButton');
    if (openGoogleButton) openGoogleButton.addEventListener('click', openGoogleSearchWithPrompt);
    const saveAnalysisButton = $('saveAnalysisReturnButton');
    if (saveAnalysisButton) saveAnalysisButton.addEventListener('click', saveAnalysisReturn);
    document.querySelectorAll('a[href^="./disability-resource.html?v="]').forEach((link) => {
      link.href = `./disability-resource.html?v=${encodeURIComponent(CACHE_VERSION)}`;
    });
    render();
  }

  init();
}());
