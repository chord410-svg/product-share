(function () {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get("share_id") || "";
  const dataParam = params.get("data") || "";
  const urlApiBase = (params.get("api_base") || inferApiBase()).replace(/\/$/, "");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("vendorList");
  const resultCountEl = document.getElementById("resultCount");
  const mapEl = document.getElementById("map");
  const rawRuntimeUrl = "https://raw.githubusercontent.com/chord410-svg/product-share/main/resource-nav-runtime.json";
  const STATIC_SHARE_RETRY_DELAYS_MS = [800, 1600, 3200, 5000, 8000];

  function inferApiBase() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return location.origin;
    }
    return "";
  }

  function unique(values) {
    const seen = new Set();
    return values
      .map((value) => String(value || "").replace(/\/$/, ""))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function renderStaticShareRetry(path, attempt, totalAttempts) {
    const message = `正在等待分享資料發布（${attempt}/${totalAttempts}）`;
    statusEl.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
    summaryEl.textContent = "GitHub Pages 資料包可能還在同步，系統會自動重試。";
    mapEl.innerHTML = `<div class="status">${escapeHtml(message)}<br>${escapeHtml(path)}</div>`;
  }

  async function readRuntimeApiBase(url) {
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return "";
      const runtime = await response.json();
      return String(runtime.api_base || "").replace(/\/$/, "");
    } catch (_err) {
      return "";
    }
  }

  async function runtimeApiBases() {
    const localRuntime = await readRuntimeApiBase("./resource-nav-runtime.json");
    const rawRuntime = await readRuntimeApiBase(rawRuntimeUrl);
    return unique([localRuntime, rawRuntime]);
  }

  function validateSharePayload(data) {
    if (!data || data.ok !== true || !data.home || !Array.isArray(data.vendors)) {
      throw new Error("invalid_share_payload");
    }
    if (data.expires_at && Number(data.expires_at) <= Date.now() / 1000) {
      throw new Error("share_not_found_or_expired");
    }
    return data;
  }

  function normalizeStaticDataPath(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("//")) {
      return "";
    }
    const cleaned = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (!cleaned || cleaned.includes("..")) return "";
    return cleaned;
  }

  function staticShareCandidates() {
    const defaultPath = shareId ? `vendor-shares/${encodeURIComponent(shareId)}.json` : "";
    return unique([normalizeStaticDataPath(dataParam), defaultPath]);
  }

  async function fetchStaticShare(path) {
    const cleanPath = normalizeStaticDataPath(path);
    if (!cleanPath) throw new Error("missing_static_share_path");
    let lastError = null;
    const totalAttempts = STATIC_SHARE_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      if (attempt > 1) {
        renderStaticShareRetry(cleanPath, attempt, totalAttempts);
        await sleep(STATIC_SHARE_RETRY_DELAYS_MS[attempt - 2]);
      }
      let response;
      try {
        response = await fetch(`${cleanPath}?v=${Date.now()}`, { cache: "no-store" });
      } catch (err) {
        const error = new Error("static_share_connection_failed");
        error.cause = err;
        lastError = error;
        continue;
      }
      if (!response.ok) {
        const error = new Error("static_share_unavailable");
        error.status = response.status;
        lastError = error;
        continue;
      }
      return validateSharePayload(await response.json());
    }
    throw lastError || new Error("static_share_unavailable");
  }

  async function fetchShare(base) {
    const cleanBase = String(base || "").replace(/\/$/, "");
    if (!cleanBase) throw new Error("missing_api_base");
    let response;
    try {
      response = await fetch(`${cleanBase}/api/v1/assistive-vendors/share/${encodeURIComponent(shareId)}`, {
        cache: "no-store"
      });
    } catch (err) {
      const error = new Error("api_connection_failed");
      error.apiBase = cleanBase;
      error.cause = err;
      throw error;
    }
    let data = {};
    try {
      data = await response.json();
    } catch (_err) {
      data = {};
    }
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || "share_unavailable");
      error.status = response.status;
      error.apiBase = cleanBase;
      throw error;
    }
    return validateSharePayload(data);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function directionsUrl(data, vendor) {
    const originPlace = data.home.geocode_provider === "district_centroid" && data.address
      ? data.address
      : `${data.home.lat},${data.home.lng}`;
    const destinationPlace = vendor.name && vendor.address
      ? `${vendor.name} ${vendor.address}`
      : vendor.geocode_provider === "district_centroid" && vendor.address
        ? vendor.address
        : vendor.directions_url || `${vendor.lat},${vendor.lng}`;
    const query = new URLSearchParams({
      api: "1",
      origin: originPlace,
      destination: destinationPlace,
      travelmode: "driving"
    });
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  }

  function placeSearchUrl(vendor) {
    const query = [vendor.name, vendor.address].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query }).toString()}`;
  }

  function allDirectionsUrl(data) {
    if (!data.vendors || !data.vendors.length) return "";
    const originPlace = data.home.geocode_provider === "district_centroid" && data.address
      ? data.address
      : `${data.home.lat},${data.home.lng}`;
    const stops = data.vendors.map((vendor) => (
      vendor.geocode_provider === "district_centroid" && vendor.address
        ? vendor.address
        : `${vendor.lat},${vendor.lng}`
    ));
    const query = new URLSearchParams({
      api: "1",
      origin: originPlace,
      destination: stops[stops.length - 1],
      travelmode: "driving"
    });
    if (stops.length > 1) query.set("waypoints", stops.slice(0, -1).join("|"));
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  }

  function hasDistrictCentroid(data) {
    return data.home.geocode_provider === "district_centroid"
      || (data.vendors || []).some((vendor) => vendor.geocode_provider === "district_centroid");
  }

  function vendorDistrictSummary(vendors) {
    const counts = new Map();
    (vendors || []).forEach((vendor) => {
      const district = String(vendor.district || "未標示");
      counts.set(district, (counts.get(district) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([district, count]) => `${district}${count}家`)
      .join("、");
  }

  function hasPreciseCoordinate(record) {
    return ["google", "literal", "manual", "official"].includes(String(record && record.geocode_provider || ""));
  }

  function experimentalMultiRouteUrl(data) {
    const allUrl = data.map_url || allDirectionsUrl(data);
    if (!allUrl || allUrl.length > 1800 || hasDistrictCentroid(data)) return "";
    return allUrl;
  }

  function distanceLabel(vendor) {
    if (vendor.route_distance_meters !== null && vendor.route_distance_meters !== undefined) {
      const km = Number(vendor.route_distance_meters) / 1000;
      const mins = Math.max(1, Math.round(Number(vendor.route_duration_seconds || 0) / 60));
      return `行車 ${km.toFixed(1)} km / 約 ${mins} 分`;
    }
    if (vendor.geocode_provider === "district_centroid") return "同區估算";
    const km = Number(vendor.distance_km);
    return Number.isFinite(km) ? `直線 ${km.toFixed(2)} km` : "距離未知";
  }

  function categoryLabel(vendor) {
    return String(vendor.vendor_category || "未分類");
  }

  function renderList(data) {
    const districtSummary = vendorDistrictSummary(data.vendors || []);
    const fallbackNote = data.home.geocode_provider === "district_centroid"
      ? '<p class="meta warning">目前使用行政區中心點定位；正式最近距離需完成 Google 地址定位後才會更準。</p>'
      : "";
    const experimentalRoute = experimentalMultiRouteUrl(data);
    statusEl.innerHTML = `
      <strong>住家定位</strong><br>
      ${escapeHtml(data.address)}<br>
      <span class="meta">${escapeHtml(data.home.geocode_provider)} / ${escapeHtml(data.home.geocode_precision)}</span>
      ${fallbackNote}
      <p class="meta">名單來源：新北市輔具資源中心特約廠商清冊。</p>
      <p class="meta"><strong>本頁共 ${data.vendors.length} 家：</strong>${escapeHtml(districtSummary || "無分布資料")}</p>
      ${experimentalRoute ? `<div class="actions"><a class="button secondary" href="${experimentalRoute}" target="_blank" rel="noopener">開啟多點路線（實驗）</a></div>` : ""}
    `;
    if (resultCountEl) {
      resultCountEl.hidden = false;
      resultCountEl.textContent = `本頁顯示 ${data.vendors.length} 家：${districtSummary || "無分布資料"}。左側可往下捲動查看完整 1-${data.vendors.length} 清單。`;
    }
    listEl.innerHTML = data.vendors.map((vendor, index) => {
      const services = (vendor.service_types || []).join("、") || "未標示";
      const category = categoryLabel(vendor);
      const route = directionsUrl(data, vendor);
      const place = placeSearchUrl(vendor);
      return `
        <article class="vendor">
          <h2>${index + 1}/${data.vendors.length}. ${escapeHtml(vendor.name)}</h2>
          <p class="meta"><span class="tag">${escapeHtml(category)}</span></p>
          <p class="meta">${escapeHtml(vendor.district)}｜${distanceLabel(vendor)}｜${escapeHtml(services)}</p>
          <p class="meta">${escapeHtml(vendor.address)}<br>${escapeHtml(vendor.phone || "無電話")}</p>
          <div class="actions">
            <a class="button" href="${place}" target="_blank" rel="noopener">查看 Google 地圖</a>
            <a class="button secondary" href="${route}" target="_blank" rel="noopener">導航到這裡</a>
          </div>
        </article>
      `;
    }).join("");
    summaryEl.textContent = `住家與 ${data.vendors.length} 家特約地點清單。距離為估算值，實際路程請以 Google Maps 為準。`;
  }

  function renderMapFallback(data, message) {
    const vendors = data && Array.isArray(data.vendors) ? data.vendors.slice(0, 5) : [];
    mapEl.innerHTML = `
      <div class="status map-fallback">
        <strong>${escapeHtml(message)}</strong><br>
        仍可從左側清單開啟單店 Google Maps；下方也提供前 5 家快速查看。
        <div class="quick-links">
          ${vendors.map((vendor, index) => (
            `<a class="button secondary" href="${placeSearchUrl(vendor)}" target="_blank" rel="noopener">${index + 1}. ${escapeHtml(vendor.name)}</a>`
          )).join("")}
        </div>
      </div>
    `;
  }

  function renderDistrictEstimateMap(data, message) {
    mapEl.innerHTML = "";
    const map = L.map(mapEl, { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    const note = L.control({ position: "topright" });
    note.onAdd = function () {
      const div = L.DomUtil.create("div", "status map-note");
      const districtSummary = vendorDistrictSummary(data.vendors || []);
      div.innerHTML = `<strong>${escapeHtml(message)}</strong><br>目前尚未完成店家門牌定位，因此只顯示行政區估算點，不顯示精準店址 marker。請以左側清單的單店 Google 地圖與導航按鈕確認位置。<div class="group-summary">本頁 ${data.vendors.length} 家：${escapeHtml(districtSummary || "無分布資料")}</div>`;
      return div;
    };
    note.addTo(map);

    const homeValid = validLatLng(data.home.lat, data.home.lng);
    if (homeValid) {
      const homePoint = [Number(data.home.lat), Number(data.home.lng)];
      L.marker(homePoint, { icon: estimateIcon("住家區"), title: "住家行政區估算" })
        .bindPopup(`<strong>住家行政區估算</strong><br>${escapeHtml(data.address)}<br>非精準門牌位置`)
        .addTo(map);
      bounds.extend(homePoint);
    }

    const groups = new Map();
    (data.vendors || []).forEach((vendor, index) => {
      if (vendor.geocode_provider !== "district_centroid" || !validLatLng(vendor.lat, vendor.lng)) return;
      const key = `${vendor.district || "未標示"}|${vendor.lat}|${vendor.lng}`;
      const group = groups.get(key) || {
        district: vendor.district || "未標示",
        lat: Number(vendor.lat),
        lng: Number(vendor.lng),
        vendors: [],
      };
      group.vendors.push({ ...vendor, originalIndex: index + 1 });
      groups.set(key, group);
    });

    groups.forEach((group) => {
      const point = [group.lat, group.lng];
      const districtLabel = String(group.district).replace(/[區鄉鎮市]$/, "");
      L.marker(point, { icon: estimateIcon(`${districtLabel}${group.vendors.length}`), title: `${group.district}估算` })
        .bindPopup(estimatePopup(data, group))
        .addTo(map);
      bounds.extend(point);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 13 });
    } else {
      renderMapFallback(data, "缺少可顯示的行政區估算座標");
    }
  }

  function validLatLng(lat, lng) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    return Number.isFinite(latNum) && Number.isFinite(lngNum) && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180;
  }

  function markerPopup(data, vendor, index) {
    const services = (vendor.service_types || []).join("、") || "未標示";
    const category = categoryLabel(vendor);
    return `
      <strong>${index + 1}. ${escapeHtml(vendor.name)}</strong><br>
      ${escapeHtml(category)}<br>
      ${escapeHtml(distanceLabel(vendor))}<br>
      ${escapeHtml(vendor.address)}<br>
      ${escapeHtml(vendor.phone || "無電話")}<br>
      ${escapeHtml(services)}<br>
      <a href="${placeSearchUrl(vendor)}" target="_blank" rel="noopener">查看 Google 地圖</a> ·
      <a href="${directionsUrl(data, vendor)}" target="_blank" rel="noopener">導航</a>
    `;
  }

  function divIcon(label, className) {
    return L.divIcon({
      className: `map-marker ${className}`,
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  }

  function estimateIcon(label) {
    return L.divIcon({
      className: "map-marker estimate-marker",
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: [64, 32],
      iconAnchor: [32, 16],
      popupAnchor: [0, -16]
    });
  }

  function estimatePopup(data, group) {
    const preview = group.vendors.slice(0, 5).map((vendor) => (
      `${vendor.originalIndex}. ${escapeHtml(vendor.name)}`
    )).join("<br>");
    return `
      <strong>${escapeHtml(group.district)}行政區估算</strong><br>
      共 ${group.vendors.length} 家，不代表店家精準地址。<br>
      ${preview}<br>
      <a href="${placeSearchUrl(group.vendors[0])}" target="_blank" rel="noopener">查看第一家 Google 地圖</a>
    `;
  }

  function renderMap(data) {
    if (!window.L) {
      renderMapFallback(data, "互動地圖暫時無法載入");
      return;
    }
    const preciseVendors = (data.vendors || []).filter((vendor) => hasPreciseCoordinate(vendor) && validLatLng(vendor.lat, vendor.lng));
    if (hasDistrictCentroid(data) && !preciseVendors.length) {
      renderDistrictEstimateMap(data, "目前為區級估算，未顯示精準店址 marker");
      return;
    }
    if (!hasPreciseCoordinate(data.home) || !validLatLng(data.home.lat, data.home.lng)) {
      renderMapFallback(data, "缺少住家座標，無法顯示互動地圖");
      return;
    }
    mapEl.innerHTML = "";
    const home = [Number(data.home.lat), Number(data.home.lng)];
    const map = L.map(mapEl, { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    L.marker(home, { icon: divIcon("家", "home-marker"), title: "住家" })
      .bindPopup(`<strong>住家</strong><br>${escapeHtml(data.address)}`)
      .addTo(map);
    bounds.extend(home);

    (data.vendors || []).forEach((vendor, index) => {
      if (!hasPreciseCoordinate(vendor) || !validLatLng(vendor.lat, vendor.lng)) return;
      const point = [Number(vendor.lat), Number(vendor.lng)];
      L.marker(point, { icon: divIcon(String(index + 1), "vendor-marker"), title: vendor.name })
        .bindPopup(markerPopup(data, vendor, index))
        .addTo(map);
      bounds.extend(point);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 15 });
    } else {
      map.setView(home, 13);
    }
  }

  function renderLoadError(err) {
    let message = "載入地圖資料失敗，請回 Discord 重新查詢一次。";
    if (err.message === "share_not_found_or_expired" || err.status === 404) {
      message = "連結已失效或找不到資料，請重新查詢一次。";
    } else if (err.message === "missing_api_base") {
      message = "目前沒有可用的 API 連線資訊，請重新查詢產生新的地圖連結。";
    } else if (err.message === "static_share_unavailable" || err.message === "static_share_connection_failed") {
      message = "靜態分享資料讀取失敗，請回 Discord 重新查詢一次。";
    } else if (err.message === "api_connection_failed") {
      message = "API 連線失敗，可能是 Cloudflare tunnel 已更換；請重新查詢或重啟 tunnel。";
    } else if (err.message === "invalid_share_payload") {
      message = "API 回傳格式不完整，請重啟資源導航 API 後再查詢。";
    }
    statusEl.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
    summaryEl.textContent = "無法讀取本次分享資料。";
    if (resultCountEl) resultCountEl.hidden = true;
    listEl.innerHTML = "";
    mapEl.innerHTML = `<div class="status">${escapeHtml(message)}</div>`;
  }

  async function loadShare() {
    let staticError = null;
    for (const path of staticShareCandidates()) {
      try {
        return await fetchStaticShare(path);
      } catch (err) {
        staticError = err;
      }
    }
    const runtimeBases = await runtimeApiBases();
    const bases = unique([urlApiBase, ...runtimeBases]);
    if (!bases.length) throw staticError || new Error("missing_api_base");
    let apiError = null;
    for (const base of bases) {
      try {
        return await fetchShare(base);
      } catch (err) {
        apiError = err;
      }
    }
    throw staticError || apiError || new Error("api_connection_failed");
  }

  async function main() {
    if (!shareId) {
      statusEl.textContent = "缺少 share_id，無法讀取地圖結果。";
      summaryEl.textContent = "連結格式不完整。";
      if (resultCountEl) resultCountEl.hidden = true;
      renderMapFallback(null, "缺少 share_id");
      return;
    }
    const data = await loadShare();
    renderList(data);
    renderMap(data);
  }

  main().catch(renderLoadError);
})();
