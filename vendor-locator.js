(function () {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get("share_id") || "";
  const apiBase = (params.get("api_base") || inferApiBase()).replace(/\/$/, "");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("vendorList");
  const mapEl = document.getElementById("map");

  function inferApiBase() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return location.origin;
    }
    return "";
  }

  async function runtimeApiBase() {
    const response = await fetch(`resource-nav-runtime.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return "";
    const runtime = await response.json();
    return String(runtime.api_base || "").replace(/\/$/, "");
  }

  async function fetchShare(base) {
    const cleanBase = String(base || "").replace(/\/$/, "");
    if (!cleanBase) throw new Error("missing_api_base");
    const response = await fetch(`${cleanBase}/api/v1/assistive-vendors/share/${encodeURIComponent(shareId)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || "share_unavailable");
      error.status = response.status;
      throw error;
    }
    return data;
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
    if (vendor.directions_url) return vendor.directions_url;
    const originPlace = data.home.geocode_provider === "district_centroid" && data.address
      ? data.address
      : `${data.home.lat},${data.home.lng}`;
    const destinationPlace = vendor.geocode_provider === "district_centroid" && vendor.address
      ? vendor.address
      : `${vendor.lat},${vendor.lng}`;
    const query = new URLSearchParams({
      api: "1",
      origin: originPlace,
      destination: destinationPlace,
      travelmode: "driving"
    });
    return `https://www.google.com/maps/dir/?${query.toString()}`;
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

  function distanceLabel(vendor) {
    if (vendor.geocode_provider === "district_centroid") return "同區估算";
    return `${Number(vendor.distance_km).toFixed(2)} km`;
  }

  function renderList(data) {
    const fallbackNote = data.home.geocode_provider === "district_centroid"
      ? '<p class="meta warning">目前使用行政區中心點定位，若要更精準請輸入完整地址或設定 Google geocoding key。</p>'
      : "";
    const allUrl = data.map_url || allDirectionsUrl(data);
    statusEl.innerHTML = `
      <strong>住家定位</strong><br>
      ${escapeHtml(data.address)}<br>
      <span class="meta">${escapeHtml(data.home.geocode_provider)} / ${escapeHtml(data.home.geocode_precision)}</span>
      ${fallbackNote}
      ${allUrl ? `<div class="actions"><a class="button" href="${allUrl}" target="_blank" rel="noopener">用 Google Maps 開啟全部點位</a></div>` : ""}
    `;
    listEl.innerHTML = data.vendors.map((vendor, index) => {
      const services = (vendor.service_types || []).join("、") || "未標示";
      const route = directionsUrl(data, vendor);
      return `
        <article class="vendor">
          <h2>${index + 1}. ${escapeHtml(vendor.name)}</h2>
          <p class="meta">${escapeHtml(vendor.district)}｜${distanceLabel(vendor)}｜${escapeHtml(services)}</p>
          <p class="meta">${escapeHtml(vendor.address)}<br>${escapeHtml(vendor.phone || "無電話")}</p>
          <div class="actions">
            <a class="button secondary" href="${route}" target="_blank" rel="noopener">導航到這裡</a>
          </div>
        </article>
      `;
    }).join("");
    summaryEl.textContent = `住家與最近 ${data.vendors.length} 家特約地點。距離為直線估算，實際路程請以 Google Maps 為準。`;
  }

  function renderMap(data) {
    if (!data.google_maps_browser_key) {
      mapEl.innerHTML = '<div class="status">尚未設定 Google Maps browser key；先顯示清單與外開 Google Maps 連結。</div>';
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
      bounds.extend(homeMarker.getPosition());
      data.vendors.forEach((vendor, index) => {
        const position = { lat: Number(vendor.lat), lng: Number(vendor.lng) };
        const marker = new google.maps.Marker({
          position,
          map,
          label: String(index + 1),
          title: vendor.name
        });
        bounds.extend(marker.getPosition());
      });
      map.fitBounds(bounds, 64);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(data.google_maps_browser_key)}&callback=__initVendorLocatorMap`;
    script.async = true;
    script.onerror = () => {
      mapEl.innerHTML = '<div class="status">Google Maps 載入失敗，請改用左側路線按鈕。</div>';
    };
    document.head.appendChild(script);
  }

  async function main() {
    if (!shareId) {
      statusEl.textContent = "缺少 share_id，無法讀取地圖結果。";
      summaryEl.textContent = "連結格式不完整。";
      return;
    }
    let data;
    try {
      data = await fetchShare(apiBase);
    } catch (err) {
      const fallbackBase = await runtimeApiBase();
      if (!fallbackBase || fallbackBase === apiBase) throw err;
      data = await fetchShare(fallbackBase);
    }
    renderList(data);
    renderMap(data);
  }

  main().catch((err) => {
    statusEl.textContent = err.message === "share_not_found_or_expired" || err.status === 404
      ? "連結已失效或找不到資料，請重新查詢一次。"
      : `載入失敗：${err.name || err}`;
    summaryEl.textContent = "請稍後重試。";
  });
})();
