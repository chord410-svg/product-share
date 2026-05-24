(function () {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get("share_id") || "";
  const dataParam = params.get("data") || "";
  const urlApiBase = (params.get("api_base") || inferApiBase()).replace(/\/$/, "");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("vendorList");
  const mapEl = document.getElementById("map");
  const rawRuntimeUrl = "https://raw.githubusercontent.com/chord410-svg/product-share/main/resource-nav-runtime.json";

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
    let response;
    try {
      response = await fetch(`${cleanPath}?v=${Date.now()}`, { cache: "no-store" });
    } catch (err) {
      const error = new Error("static_share_connection_failed");
      error.cause = err;
      throw error;
    }
    if (!response.ok) {
      const error = new Error("static_share_unavailable");
      error.status = response.status;
      throw error;
    }
    return validateSharePayload(await response.json());
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

  function renderList(data) {
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
      ${experimentalRoute ? `<div class="actions"><a class="button secondary" href="${experimentalRoute}" target="_blank" rel="noopener">開啟多點路線（實驗）</a></div>` : ""}
    `;
    listEl.innerHTML = data.vendors.map((vendor, index) => {
      const services = (vendor.service_types || []).join("、") || "未標示";
      const route = directionsUrl(data, vendor);
      const place = placeSearchUrl(vendor);
      return `
        <article class="vendor">
          <h2>${index + 1}. ${escapeHtml(vendor.name)}</h2>
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
      <div class="status">
        <strong>${escapeHtml(message)}</strong><br>
        請從左側選一家店開 Google Maps；下方也提供前 5 家快速查看。
        <div class="quick-links">
          ${vendors.map((vendor, index) => (
            `<a class="button secondary" href="${placeSearchUrl(vendor)}" target="_blank" rel="noopener">${index + 1}. ${escapeHtml(vendor.name)}</a>`
          )).join("")}
        </div>
      </div>
    `;
  }

  function renderMap(data) {
    if (!data.google_maps_browser_key) {
      renderMapFallback(data, "尚未設定 Google Maps browser key");
      return;
    }
    window.__vendorLocatorData = data;
    window.__initVendorLocatorMap = function () {
      const home = { lat: Number(data.home.lat), lng: Number(data.home.lng) };
      const map = new google.maps.Map(mapEl, {
        center: home,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false
      });
      const bounds = new google.maps.LatLngBounds();
      const homeMarker = new google.maps.Marker({
        position: home,
        map,
        label: "家",
        title: "住家"
      });
      const infoWindow = new google.maps.InfoWindow();
      homeMarker.addListener("click", () => {
        infoWindow.setContent(`<strong>住家</strong><br>${escapeHtml(data.address)}`);
        infoWindow.open(map, homeMarker);
      });
      bounds.extend(homeMarker.getPosition());
      data.vendors.forEach((vendor, index) => {
        const position = { lat: Number(vendor.lat), lng: Number(vendor.lng) };
        const marker = new google.maps.Marker({
          position,
          map,
          label: String(index + 1),
          title: vendor.name
        });
        marker.addListener("click", () => {
          const services = (vendor.service_types || []).join("、") || "未標示";
          infoWindow.setContent(
            `<strong>${index + 1}. ${escapeHtml(vendor.name)}</strong><br>` +
            `${escapeHtml(vendor.address)}<br>` +
            `${escapeHtml(vendor.phone || "無電話")}<br>` +
            `${escapeHtml(services)}`
          );
          infoWindow.open(map, marker);
        });
        bounds.extend(marker.getPosition());
      });
      map.fitBounds(bounds, 64);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(data.google_maps_browser_key)}&callback=__initVendorLocatorMap`;
    script.async = true;
    script.onerror = () => {
      renderMapFallback(data, "Google Maps 載入失敗");
    };
    document.head.appendChild(script);
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
      renderMapFallback(null, "缺少 share_id");
      return;
    }
    const data = await loadShare();
    renderList(data);
    renderMap(data);
  }

  main().catch(renderLoadError);
})();
