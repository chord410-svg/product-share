(function () {
  const STORAGE_KEY = 'disability_knowledge_packages_v1';
  const CACHE_VERSION = '20260620-smart-curriculum-ai-v1';
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

  function sourceText(card) {
    const refs = sourceRefs(card);
    if (!refs.length) return '來源待補官方資料。';
    return refs.map((ref, index) => {
      const title = ref.title || ref.source_id || '來源';
      const level = ref.source_level || ref.level || '未分級';
      const checked = ref.last_checked_at || '待確認';
      const url = ref.url || '';
      return `${index + 1}. ${title}｜${level}｜最後確認：${checked}${url ? `｜${url}` : ''}`;
    }).join('\n');
  }

  function sourceExtractRefs(card) {
    const extracts = Array.isArray(card?.source_extracts) ? card.source_extracts : [];
    return extracts.map((extract) => ({
      source_id: extract.source_id || '',
      title: extract.source_title || extract.title || extract.source_id || '來源',
      source_level: extract.source_level || '待確認',
      url: extract.url || extract.source_url || '',
      last_checked_at: extract.updated_at || extract.last_checked_at || '待確認',
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
      <li>
        <strong>${escapeHtml(contact.label)}</strong>
        ${contact.role ? `<span>${escapeHtml(contact.role)}</span>` : ''}
        ${phoneHtml || urlHtml ? `<small>${[phoneHtml, urlHtml].filter(Boolean).join('｜')}</small>` : ''}
      </li>
    `;
  }

  function sourceLinkListHtml(sources) {
    if (!sources.length) return '<p class="muted-text">來源連結待補。</p>';
    return `<ul class="result-link-list">${sources.map((ref) => {
      const title = ref.title || ref.source_id || '來源';
      const level = ref.source_level || ref.level || '待確認';
      const checked = ref.last_checked_at || '待確認';
      const titleHtml = ref.url
        ? `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      return `<li>${titleHtml}<span>${escapeHtml(level)}｜最後確認：${escapeHtml(checked)}</span></li>`;
    }).join('')}</ul>`;
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
    return {
      source_id: sourceId,
      title,
      source_level: ref.source_level || ref.level || '待確認',
      url: ref.url || ref.source_url || '',
      last_checked_at: ref.last_checked_at || ref.updated_at || '待確認',
      public_allowed: ref.public_allowed,
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

  function buildActionHtml() {
    if (!cards.length) return '<div class="empty-state">尚未加入知識卡。</div>';
    return cards.map((card, index) => {
      const contacts = cardContacts(card);
      const sources = cardSources(card);
      return `
        <article class="source-item result-action-item">
          <strong>${index + 1}. ${escapeHtml(card.title || cardId(card))}</strong>
          <section>
            <h4>對應單位／窗口／聯絡方式</h4>
            ${contacts.length
              ? `<ul class="result-contact-list">${contacts.map(contactHtml).join('')}</ul>`
              : '<p class="muted-text">待補明確窗口／聯絡方式。</p>'}
          </section>
          <section>
            <h4>來源連結</h4>
            ${sourceLinkListHtml(sources)}
          </section>
        </article>
      `;
    }).join('');
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
    const sourceLines = sources.length
      ? sources.map((ref, idx) => `${idx + 1}. ${ref.title || ref.source_id || '來源'}｜${ref.source_level || ref.level || '待確認'}｜${ref.url || '無連結'}`).join('\n')
      : '來源待補。';
    return [
      `## ${index + 1}. ${card.title || cardId(card)}`,
      `側別：${card.system_side || '未標示'}｜同屬性：${card.comparison_group || '未標示'}`,
      `摘要：${compactText(card.knowledge_brief || card.family_safe_summary || '')}`,
      '內容整合：',
      integratedTextForCard(card) || '內容整合待補。',
      '來源連結：',
      sourceLines,
    ].join('\n');
  }

  const ANALYSIS_ACTIONS = [
    {
      id: 'ltc_disability_compare',
      label: '長照 VS 身障對照',
      instruction: '請依據資料整理長照側與身障側的差異。只使用已提供的卡片摘要、內容整合與來源連結；沒有資料的一側請寫「資料從缺」，不要推論補滿。',
    },
    {
      id: 'rental_responsibility',
      label: '智慧輔具租賃責任整理',
      instruction: '請整理租賃、維修、退租、清潔消毒、回收整備與供應端責任相關資料。只使用已提供資料，不加入未列出的廠商承諾。',
    },
    {
      id: 'app_network_operation',
      label: 'APP／網路操作條件整理',
      instruction: '請整理 APP、網路、通知方式、照顧者操作條件、使用環境相關資料。只整理資料本身，不做資格或產品推薦。',
    },
    {
      id: 'family_draft',
      label: '家屬版說明草稿',
      instruction: '請把資料改寫成家屬可讀的保守說明。不要承諾補助、資格、金額或核定；不要加入卡片來源之外的資訊。',
    },
    {
      id: 'phone_questions',
      label: '電話確認前問題整理',
      instruction: '請把資料轉成電話確認前可用的問題清單，並依窗口或資料主題分類。不要新增來源沒有的制度結論。',
    },
  ];
  let activeAnalysisId = ANALYSIS_ACTIONS[0].id;

  function buildAnalysisPrompt(actionId = activeAnalysisId) {
    const action = ANALYSIS_ACTIONS.find((item) => item.id === actionId) || ANALYSIS_ACTIONS[0];
    const cardBlocks = cards.map(cardPromptBlock).join('\n\n---\n\n') || '尚未加入知識卡。';
    return [
      '你是長照與身障資料整理助手。',
      action.instruction,
      '限制：只能根據以下知識卡資料與來源連結整理；不可判定資格；不可承諾補助金額；不可把廠商或新聞線索寫成官方結論；資料不足時明確寫資料不足。',
      '',
      '# 已選知識卡資料',
      cardBlocks,
      '',
      '# 請輸出',
      '1. 重點整理',
      '2. 來源依據',
      '3. 資料不足或從缺處',
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
      <article class="source-item">
        <strong>家屬版</strong>
        <pre>${escapeHtml(buildFamilyText())}</pre>
      </article>
      <article class="source-item">
        <strong>查證行動</strong>
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
