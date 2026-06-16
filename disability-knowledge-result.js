(function () {
  const STORAGE_KEY = 'disability_knowledge_packages_v1';
  const CACHE_VERSION = '20260617-comparison-v1';
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

  function cardSystemSide(card) {
    const explicit = normalizeSystemSide(card?.comparison_digest?.system_side || card?.system_side || card?.side);
    if (explicit) return explicit;
    const scopes = asList(card?.system_scope).map((item) => String(item));
    const hasLtc = scopes.some((item) => item.includes('長照'));
    const hasDisability = scopes.some((item) => item.includes('身障'));
    if (hasLtc && !hasDisability) return 'ltc';
    if (hasDisability && !hasLtc) return 'disability';
    return 'unknown';
  }

  function comparisonDigest(card) {
    const side = cardSystemSide(card);
    const digest = card.comparison_digest || {};
    if (digest.boundary || digest.action) {
      return {
        group: digest.comparison_group || card.comparison_group || '',
        label: digest.group_label || card.comparison_group_label || card.title || cardId(card),
        side,
        card_title: card.title || cardId(card),
        boundary: {
          ltc: digest.boundary?.ltc || '',
          disability: digest.boundary?.disability || '',
          shared: digest.boundary?.shared || '未經官方確認前，不判定資格、不承諾補助金額。',
        },
        action: {
          ltc: digest.action?.ltc || '',
          disability: digest.action?.disability || '',
          reminders: asList(digest.action?.reminders),
        },
        family: digest.family_wording || card.family_safe_summary || '請先查證官方路徑，再提供家屬保守說明。',
      };
    }
    const comparison = card.comparison || {};
    const group = card.comparison_group || comparison.comparison_group || '';
    if (!group && !comparison.ltc_side && !comparison.disability_side) return null;
    return {
      group,
      label: comparison.group_label || card.comparison_group_label || card.title || cardId(card),
      side,
      card_title: card.title || cardId(card),
      boundary: {
        ltc: comparison.ltc_side || '',
        disability: comparison.disability_side || '',
        shared: comparison.shared_boundary || '未經官方確認前，不判定資格、不承諾補助金額。',
      },
      action: {
        ltc: comparison.ltc_action || '',
        disability: comparison.disability_action || '',
        reminders: asList(comparison.shared_risks || card.care_manager_notes),
      },
      family: comparison.family_wording || card.family_safe_summary || '請先查證官方路徑，再提供家屬保守說明。',
    };
  }

  function groupedComparisons() {
    const groups = new Map();
    const skipped = [];
    cards.forEach((card) => {
      const digest = comparisonDigest(card);
      if (!digest || !digest.group) {
        skipped.push(card);
        return;
      }
      if (!groups.has(digest.group)) {
        groups.set(digest.group, {
          label: digest.label,
          rows: [],
          cards: [],
          ltcRows: [],
          disabilityRows: [],
          sharedRows: [],
          unknownRows: [],
        });
      }
      const group = groups.get(digest.group);
      group.rows.push(digest);
      group.cards.push(card);
      if (digest.side === 'ltc') group.ltcRows.push(digest);
      else if (digest.side === 'disability') group.disabilityRows.push(digest);
      else if (digest.side === 'shared') group.sharedRows.push(digest);
      else group.unknownRows.push(digest);
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

  function joinedCell(items, fallback) {
    const rows = unique(items);
    return rows.length ? rows.join('；') : fallback;
  }

  function sideBoundary(rows, side, fallback) {
    return joinedCell(rows.map((row) => row.boundary?.[side]), fallback);
  }

  function sideAction(rows, side, fallback) {
    return joinedCell(rows.map((row) => row.action?.[side]), fallback);
  }

  function renderComparison() {
    const container = $('comparisonOutput');
    const { groups, skipped } = groupedComparisons();
    if (!groups.length) {
      container.innerHTML = '<div class="empty-state">目前選取的知識卡沒有可比較的同屬性資料。</div>';
      return;
    }
    container.innerHTML = groups.map((group) => {
      const boundaryLtc = sideBoundary(group.ltcRows, 'ltc', '尚未加入同屬性的長照側知識卡；請回知識導航加入長照側資料，或標示目前未收錄。');
      const boundaryDisability = sideBoundary(group.disabilityRows, 'disability', '尚未加入同屬性的身障側知識卡；請回知識導航加入身障側資料，或標示目前未收錄。');
      const boundaryShared = joinedCell(group.rows.map((row) => row.boundary.shared), '未經官方確認前，不判定資格、不承諾補助金額。');
      const actionLtc = sideAction(group.ltcRows, 'ltc', '尚未加入長照側查證行動；不得代替長照側推論。');
      const actionDisability = sideAction(group.disabilityRows, 'disability', '尚未加入身障側查證行動；不得代替身障側推論。');
      const reminders = unique(group.rows.flatMap((row) => row.action.reminders));
      const family = unique(group.rows.map((row) => row.family));
      const unknownNote = group.unknownRows.length
        ? `<div class="empty-state">${escapeHtml(group.unknownRows.map((row) => row.card_title).join('、'))} 缺 system_side，已列入此比較群組但未放入長照/身障任一側。</div>`
        : '';
      return `
        <article class="compare-table">
          <h4>${escapeHtml(group.label)} <span>${group.cards.length} 張知識卡｜長照 ${group.ltcRows.length}｜身障 ${group.disabilityRows.length}</span></h4>
          <div class="compare-row compare-head" role="row">
            <span role="columnheader">面向</span>
            <span role="columnheader">長照側</span>
            <span role="columnheader">身障側</span>
            <span role="columnheader">共同提醒</span>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">判斷邊界</span>
            <p role="cell">${escapeHtml(boundaryLtc)}</p>
            <p role="cell">${escapeHtml(boundaryDisability)}</p>
            <p role="cell">${escapeHtml(boundaryShared)}</p>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">查證與提醒</span>
            <p role="cell">${escapeHtml(actionLtc)}</p>
            <p role="cell">${escapeHtml(actionDisability)}</p>
            <p role="cell">${escapeHtml(reminders.length ? reminders.join('、') : '需官方確認。')}</p>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">家屬保守說法</span>
            <p role="cell" class="compare-family">${escapeHtml(family.join('；') || '請先查證官方路徑，再提供家屬保守說明。')}</p>
          </div>
          ${unknownNote}
        </article>
      `;
    }).join('') + (skipped.length ? `<div class="empty-state">以下知識卡不適用比較：${skipped.map((card) => escapeHtml(card.title || cardId(card))).join('、')}</div>` : '');
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
