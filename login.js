(function () {
  "use strict";
  const root = document.getElementById("googleSignIn");
  const status = document.getElementById("loginStatus");
  if (!root) return;

  function cookie(name) {
    return document.cookie.split(";").map(function (part) { return part.trim(); }).filter(function (part) {
      return part.startsWith(name + "=");
    }).map(function (part) { return decodeURIComponent(part.slice(name.length + 1)); })[0] || "";
  }

  async function handleCredential(response) {
    status.textContent = "正在確認 Google 帳號";
    try {
      const result = await fetch("/api/v1/auth/google", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-OB-Login-CSRF": cookie("ob_login_csrf") },
        body: JSON.stringify({ credential: response.credential }),
      });
      const body = await result.json().catch(function () { return {}; });
      if (!result.ok || body.ok === false) throw new Error(body.message || "目前無法登入");
      status.textContent = "登入完成，正在進入工作站";
      window.location.replace(body.next || "/");
    } catch (error) {
      status.textContent = error.message || "目前無法登入";
    }
  }

  function initialize() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      window.setTimeout(initialize, 100);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: root.dataset.clientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(root, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      width: Math.min(360, Math.max(240, root.clientWidth || 320)),
      locale: "zh_TW",
    });
  }

  initialize();
})();
