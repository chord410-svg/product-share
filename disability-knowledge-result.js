(function () {
  const STORAGE_KEY = 'disability_knowledge_packages_v1';
  const CACHE_VERSION = '20260614-knowledge-nav-v22';
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
    const rows = unique(items);
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

  function comparisonDigest(card) {
    const digest = card.comparison_digest || {};
    if (digest.boundary || digest.action) {
      return {
        group: digest.comparison_group || card.comparison_group || '',
        label: digest.group_label || card.comparison_group_label || card.title || cardId(card),
        boundary: {
          ltc: digest.boundary?.ltc || '長照側需依官方服務項目與地方承辦流程查證。',
          disability: digest.boundary?.disability || '身障側需依地方身障福利、輔具中心或社會局窗口查證。',
          shared: digest.boundary?.shared || '未經官方確認前，不判定資格、不承諾補助金額。',
        },
        action: {
          ltc: digest.action?.ltc || '詢問 1966、長照中心或地方承辦單位。',
          disability: digest.action?.disability || '詢問社會局、輔具資源中心或身障福利窗口。',
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
      boundary: {
        ltc: comparison.ltc_side || '長照側需依官方服務項目與地方承辦流程查證。',
        disability: comparison.disability_side || '身障側需依地方身障福利、輔具中心或社會局窗口查證。',
        shared: comparison.shared_boundary || '未經官方確認前，不判定資格、不承諾補助金額。',
      },
      action: {
        ltc: comparison.ltc_action || '詢問 1966、長照中心或地方承辦單位。',
        disability: comparison.disability_action || '詢問社會局、輔具資源中心或身障福利窗口。',
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
        groups.set(digest.group, { label: digest.label, rows: [], cards: [] });
      }
      groups.get(digest.group).rows.push(digest);
      groups.get(digest.group).cards.push(card);
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

  function renderComparison() {
    const container = $('comparisonOutput');
    const { groups, skipped } = groupedComparisons();
    if (!groups.length) {
      container.innerHTML = '<div class="empty-state">目前選取的知識卡沒有可比較的同屬性資料。</div>';
      return;
    }
    container.innerHTML = groups.map((group) => {
      const primary = group.rows[0];
      const reminders = unique(group.rows.flatMap((row) => row.action.reminders));
      return `
        <article class="compare-table">
          <h4>${escapeHtml(group.label)} <span>${group.cards.length} 張知識卡</span></h4>
          <div class="compare-row compare-head" role="row">
            <span role="columnheader">面向</span>
            <span role="columnheader">長照側</span>
            <span role="columnheader">身障側</span>
            <span role="columnheader">共同提醒</span>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">判斷邊界</span>
            <p role="cell">${escapeHtml(primary.boundary.ltc)}</p>
            <p role="cell">${escapeHtml(primary.boundary.disability)}</p>
            <p role="cell">${escapeHtml(primary.boundary.shared)}</p>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">查證與提醒</span>
            <p role="cell">${escapeHtml(primary.action.ltc)}</p>
            <p role="cell">${escapeHtml(primary.action.disability)}</p>
            <p role="cell">${escapeHtml(reminders.length ? reminders.join('、') : '需官方確認。')}</p>
          </div>
          <div class="compare-row" role="row">
            <span role="cell">家屬保守說法</span>
            <p role="cell" class="compare-family">${escapeHtml(primary.family)}</p>
          </div>
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
    document.querySelectorAll('a[href="./disability-resource.html?v=20260614-knowledge-nav-v22"]').forEach((link) => {
      link.href = `./disability-resource.html?v=${encodeURIComponent(CACHE_VERSION)}`;
    });
    render();
  }

  init();
}());
