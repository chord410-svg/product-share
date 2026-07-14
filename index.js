(function () {
  "use strict";

  const featureLabels = {
    subsidy: "補助計算",
    assistive: "輔具查詢",
    "vendor-map": "特約輔具地圖",
    "resource-nav": "長照資源導航",
    knowledge: "知識導航",
    "professional-search": "專業報告搜尋",
  };

  const statusLabels = { ready: "可查看", pending: "處理中", failed: "失敗" };

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function closeAccountMenu(options) {
    const menu = document.getElementById("accountMenu");
    const button = document.getElementById("accountMenuButton");
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (options && options.restoreFocus) button.focus();
  }

  function setupAccountMenu() {
    const wrap = document.querySelector(".account-menu-wrap");
    const menu = document.getElementById("accountMenu");
    const button = document.getElementById("accountMenuButton");
    if (!wrap || !menu || !button) return;

    button.addEventListener("click", function () {
      const shouldOpen = menu.hidden;
      menu.hidden = !shouldOpen;
      button.setAttribute("aria-expanded", String(shouldOpen));
    });
    document.addEventListener("click", function (event) {
      if (!wrap.contains(event.target)) closeAccountMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !menu.hidden) closeAccountMenu({ restoreFocus: true });
    });
  }

  function renderResults(results) {
    const root = document.getElementById("recentResults");
    if (!root) return;
    root.innerHTML = "";
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "還沒有工作結果。完成工具操作後會顯示在這裡。";
      root.appendChild(empty);
      return;
    }
    results.slice(0, 3).forEach(function (result) {
      const link = document.createElement("a");
      link.className = "result-row";
      link.href = "/launch/results#" + encodeURIComponent(result.id);
      const main = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = result.title;
      const meta = document.createElement("small");
      meta.textContent = (featureLabels[result.feature] || result.feature) + " / " + window.OBPortal.formatDate(result.updated_at);
      main.append(title, meta);
      const status = document.createElement("span");
      status.className = "status-label status-label--" + String(result.status || "ready");
      status.textContent = statusLabels[result.status] || result.status;
      link.append(main, status);
      root.appendChild(link);
    });
  }

  async function init() {
    setupAccountMenu();
    try {
      const me = await window.OBPortal.getMe();
      const unitName = me.user.unit.name || "尚未指派單位";
      setText("userName", me.user.display_name);
      setText("unitName", unitName);
      setText("environmentName", String(me.environment || "dev").toUpperCase());
      setText("accountMenuName", me.user.display_name);
      setText("accountMenuUnit", unitName);
      const adminLink = document.getElementById("adminMenuLink");
      if (adminLink) {
        adminLink.hidden = me.user.role !== "admin" || !me.admin_url;
        if (me.admin_url) adminLink.href = me.admin_url;
      }
      const logoutButton = document.getElementById("logoutButton");
      if (logoutButton) logoutButton.addEventListener("click", async function () {
        logoutButton.disabled = true;
        try {
          await window.OBPortal.getJson("/api/v1/auth/logout", { method: "POST" });
        } finally {
          window.location.replace("/login");
        }
      });

      const status = await window.OBPortal.getJson("/api/v1/status/summary");
      const states = Object.values(status.services || {});
      const readyCount = states.filter(Boolean).length;
      const allReady = readyCount === states.length && states.length > 0;
      const dot = document.getElementById("serviceDot");
      if (dot) dot.classList.add(allReady ? "is-ready" : "is-warning");
      setText("serviceTitle", allReady ? "主要服務正常" : "部分服務需留意");
      setText("serviceDetail", states.length ? readyCount + " / " + states.length + " 項服務可用" : "尚未取得服務資料");
      renderResults(status.recent_results || []);
    } catch (error) {
      setText("workspaceTitle", "目前無法載入 OB 工作站");
      setText("serviceTitle", "身份或服務連線失敗");
      setText("serviceDetail", error.message || "請稍後重新整理");
    }
  }

  init();
})();
