(function () {
  const STORAGE_KEY = 'disability_knowledge_packages_v1';
  const CACHE_VERSION = '20260617-detail-click-v1';
  let activeMode = new URLSearchParams(window.location.search).get('output') || localStorage.getItem('disability_knowledge_result_mode_v1') || 'family';
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

  function normalizeComparisonFacts(facts) {
    if (!Array.isArray(facts)) return [];
    return facts.map((fact) => {
      if (!fact || typeof fact !== 'object') return null;
      const label = String(fact.label || fact.name || fact.field || '').trim();
      const value = String(fact.value || fact.text || fact.content || '').trim();
      if (!label || !value) return null;
      return { label, value };
    }).filter(Boolean);
  }

  function comparisonProfile(card) {
    const profile = card?.comparison_profile;
    if (!profile || typeof profile !== 'object') return null;
    const group = String(profile.comparison_group || card?.comparison_group || '').trim();
    const side = normalizeSystemSide(profile.system_side || card?.system_side || card?.side);
    if (!group || !['ltc', 'disability'].includes(side)) return null;
    const facts = normalizeComparisonFacts(profile.facts);
    if (!facts.length) return null;
    return {
      card_id: cardId(card),
      group,
      label: comparisonGroupLabel(group, profile.group_label || card?.comparison_group_label || profile.title || card?.title || cardId(card)),
      side,
      card_title: card?.title || profile.title || cardId(card),
      profile_title: profile.title || card?.title || cardId(card),
      facts,
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

  function buildFamilyText() {
    return cards.map((card, index) => `${index + 1}. ${card.family_safe_summary || '請先查證官方規定與地方承辦窗口，再提供家屬保守說明。'}`).join('\n\n') || '尚未加入知識卡。';
  }

  function buildBoundaryText() {
    return cards.map((card, index) => [
      `${index + 1}. ${card.title || cardId(card)}`,
      `適用：${asList(card.applies_when).join('；') || '尚待補齊'}`,
      `不適用：${asList(card.not_applies_when).join('；') || '尚待補齊'}`,
    ].join('\n')).join('\n\n') || '尚未加入知識卡。';
  }

  function buildActionText() {
    return cards.map((card, index) => [
      `${index + 1}. ${card.title || cardId(card)}`,
      `查證：${lineList(card.verification_steps, '尚待補齊')}`,
      `電話確認：${lineList(card.phone_check_questions, '尚待補齊')}`,
      `提醒：${lineList(card.care_manager_notes, '尚待補齊')}`,
    ].join('\n')).join('\n\n') || '尚未加入知識卡。';
  }

  function profileFactsByLabel(profiles) {
    const map = new Map();
    profiles.forEach((profile) => {
      profile.facts.forEach((fact) => {
        if (!map.has(fact.label)) map.set(fact.label, []);
        map.get(fact.label).push({
          value: fact.value,
          card_id: profile.card_id,
          card_title: profile.card_title,
        });
      });
    });
    return map;
  }

  function renderFactCell(entries, sideHasProfile) {
    if (!entries?.length) {
      const message = sideHasProfile ? '從缺：此側卡片尚未整理此項資料。' : '從缺：尚未加入同屬性知識卡。';
      return `<div class="compare-missing">${escapeHtml(message)}</div>`;
    }
    return entries.map((entry) => `
      <div class="compare-fact">
        <p>${escapeHtml(entry.value)}</p>
        <a class="compare-card-link" href="${escapeHtml(knowledgeCardHref(entry.card_id))}">查看此知識卡</a>
      </div>
    `).join('');
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

  function renderComparison() {
    const container = $('comparisonOutput');
    const { groups, skipped } = groupedComparisons();
    if (!groups.length) {
      container.innerHTML = '<div class="empty-state">目前選取的知識卡沒有可比較的同屬性資料。</div>';
      return;
    }
    container.innerHTML = groups.map((group) => {
      const ltcFacts = profileFactsByLabel(group.ltcProfiles);
      const disabilityFacts = profileFactsByLabel(group.disabilityProfiles);
      const labels = COMPARISON_FACT_LABELS.filter((label) => ltcFacts.has(label) || disabilityFacts.has(label));
      const rows = labels.map((label) => `
        <div class="compare-profile-row" role="row">
          <div class="compare-profile-label" role="rowheader">${escapeHtml(label)}</div>
          <div role="cell">${renderFactCell(ltcFacts.get(label), group.ltcProfiles.length > 0)}</div>
          <div role="cell">${renderFactCell(disabilityFacts.get(label), group.disabilityProfiles.length > 0)}</div>
        </div>
      `).join('') || '<div class="empty-state">此比較群組尚未整理可對照欄位。</div>';
      return `
        <article class="compare-profile-table">
          <div class="comparison-group-title">
            <h4>${escapeHtml(group.label)}</h4>
            <span class="tag compare-tag">${group.profiles.length} 張知識卡｜長照 ${group.ltcProfiles.length}｜身障 ${group.disabilityProfiles.length}</span>
          </div>
          <div class="compare-profile-grid" role="table" aria-label="${escapeHtml(group.label)}同屬性比較">
            <div class="compare-profile-row compare-profile-head" role="row">
              <div role="columnheader">項目</div>
              <div role="columnheader">長照側</div>
              <div role="columnheader">身障側</div>
            </div>
            ${rows}
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
      `;
    }).join('') + (skipped.length ? `<div class="empty-state">以下知識卡沒有 comparison_profile，不列入同屬性比較：${skipped.map((card) => escapeHtml(card.title || cardId(card))).join('、')}</div>` : '');
  }

  function renderFullData() {
    const container = $('fullOutput');
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state">尚未加入知識卡。</div>';
      return;
    }
    container.innerHTML = cards.map((card, index) => `
      <article class="source-item">
        <strong>${index + 1}. ${escapeHtml(card.title || cardId(card))}</strong>
        <p>${escapeHtml(card.family_safe_summary || '')}</p>
        <pre>${escapeHtml(sourceText(card))}</pre>
      </article>
    `).join('');
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
    $('boundaryOutput').textContent = buildBoundaryText();
    $('actionOutput').textContent = buildActionText();
    renderComparison();
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
    document.querySelectorAll('a[href^="./disability-resource.html?v="]').forEach((link) => {
      link.href = `./disability-resource.html?v=${encodeURIComponent(CACHE_VERSION)}`;
    });
    render();
  }

  init();
}());
