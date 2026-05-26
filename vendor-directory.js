(function () {
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("vendorList");
  const mapEl = document.getElementById("map");
  const districtFilter = document.getElementById("districtFilter");
  const serviceFilter = document.getElementById("serviceFilter");
  const categoryFilter = document.getElementById("categoryFilter");
  const keywordFilter = document.getElementById("keywordFilter");
  const rawDirectoryUrl = "https://raw.githubusercontent.com/chord410-svg/product-share/main/vendor-directory.json";
  let directoryData = null;
  let map = null;
  let mapLayer = null;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function validLatLng(lat, lng) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    return Number.isFinite(latNum) && Number.isFinite(lngNum) && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180;
  }

  function hasPreciseCoordinate(vendor) {
    return ["google", "literal", "manual", "official"].includes(String(vendor && vendor.geocode_provider || ""));
  }

  function serviceLabel(vendor) {
    return (vendor.service_types || []).join("、") || "未標示";
  }

  function categoryLabel(vendor) {
    return String(vendor.vendor_category || "未分類");
  }

  function placeSearchUrl(vendor) {
    const query = [vendor.name, vendor.address].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query }).toString()}`;
  }

  function directionsUrl(vendor) {
    const destination = [vendor.name, vendor.address].filter(Boolean).join(" ");
    return `https://www.google.com/maps/dir/?${new URLSearchParams({
      api: "1",
      destination,
      travelmode: "driving"
    }).toString()}`;
  }

  function markerIcon(label, className) {
    return L.divIcon({
      className: `map-marker ${className || ""}`,
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: null,
      iconAnchor: [24, 16],
      popupAnchor: [0, -16]
    });
  }

  function districtShortName(district) {
    return String(district || "未標示").replace(/[區鄉鎮市]$/, "");
  }

  function vendorPopup(vendor, index) {
    return `
      <strong>${index + 1}. ${escapeHtml(vendor.name)}</strong><br>
      ${escapeHtml(categoryLabel(vendor))}<br>
      ${escapeHtml(vendor.district)}｜${escapeHtml(serviceLabel(vendor))}<br>
      ${escapeHtml(vendor.address)}<br>
      ${escapeHtml(vendor.phone || "無電話")}<br>
      <a href="${placeSearchUrl(vendor)}" target="_blank" rel="noopener">查看 Google 地圖</a> ·
      <a href="${directionsUrl(vendor)}" target="_blank" rel="noopener">導航</a>
    `;
  }

  function groupPopup(group) {
    const preview = group.vendors.slice(0, 8).map((vendor) => (
      `${escapeHtml(vendor.name)}｜${escapeHtml(vendor.phone || "無電話")}`
    )).join("<br>");
    return `
      <strong>${escapeHtml(group.district)}區級群組</strong><br>
      共 ${group.vendors.length} 家。這是行政區估算點，不是店家門牌位置。<br>
      ${preview}
    `;
  }

  function renderStatus(data, vendors) {
    const summary = data.summary || {};
    const precise = Number(summary.precise_geocoded || 0);
    const districtOnly = Number(summary.district_centroid_geocoded || 0);
    const missing = Number(summary.missing_coordinates || 0);
    statusEl.innerHTML = `
      <strong>${escapeHtml(data.source_label || "新北市特約廠商清冊")}</strong><br>
      總筆數：${Number(summary.total || data.vendors.length)}｜目前顯示：${vendors.length}<br>
      精準座標：${precise}｜區級座標：${districtOnly}｜缺座標：${missing}<br>
      ${categorySummary(summary.vendor_categories || {})}<br>
      <span class="warning">目前區級座標不代表店家門牌位置；請用單店 Google 地圖確認。</span>
    `;
    summaryEl.textContent = `新北市 ${Number(summary.total || data.vendors.length)} 筆特約廠商名單，可依行政區、服務類型與關鍵字篩選。`;
  }

  function serviceMatches(vendor, service) {
    if (!service) return true;
    const services = vendor.service_types || [];
    if (service === "__blank__") return services.length === 0;
    return services.includes(service);
  }

  function keywordMatches(vendor, keyword) {
    if (!keyword) return true;
    const haystack = [vendor.name, vendor.district, vendor.address, vendor.phone, serviceLabel(vendor), categoryLabel(vendor)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword.toLowerCase());
  }

  function categoryMatches(vendor, category) {
    return !category || categoryLabel(vendor) === category;
  }

  function categorySummary(categories) {
    const entries = Object.entries(categories || {}).filter(([, count]) => Number(count) > 0);
    if (!entries.length) return "單位類型：尚未分類";
    return `單位類型：${entries.map(([name, count]) => `${name} ${count}`).join("｜")}`;
  }

  function filteredVendors() {
    const district = districtFilter.value;
    const service = serviceFilter.value;
    const category = categoryFilter.value;
    const keyword = keywordFilter.value.trim();
    return (directoryData.vendors || []).filter((vendor) => (
      (!district || vendor.district === district)
      && serviceMatches(vendor, service)
      && categoryMatches(vendor, category)
      && keywordMatches(vendor, keyword)
    ));
  }

  function renderFilters(data) {
    const districts = Array.from(new Set((data.vendors || []).map((vendor) => vendor.district).filter(Boolean))).sort();
    const categories = Array.from(new Set((data.vendors || []).map((vendor) => categoryLabel(vendor)).filter(Boolean))).sort();
    districtFilter.innerHTML = [
      '<option value="">全部行政區</option>',
      ...districts.map((district) => `<option value="${escapeHtml(district)}">${escapeHtml(district)}</option>`)
    ].join("");
    categoryFilter.innerHTML = [
      '<option value="">全部單位類型</option>',
      ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    ].join("");
  }

  function renderList(vendors) {
    if (!vendors.length) {
      listEl.innerHTML = '<div class="status">沒有符合條件的廠商。</div>';
      return;
    }
    listEl.innerHTML = vendors.map((vendor, index) => `
      <article class="vendor">
        <h2>${index + 1}. ${escapeHtml(vendor.name)}</h2>
        <p class="meta"><span class="tag">${escapeHtml(categoryLabel(vendor))}</span></p>
        <p class="meta">${escapeHtml(vendor.district)}｜${escapeHtml(serviceLabel(vendor))}｜${escapeHtml(vendor.geocode_provider || "未定位")}</p>
        <p class="meta">${escapeHtml(vendor.address)}<br>${escapeHtml(vendor.phone || "無電話")}</p>
        <div class="actions">
          <a class="button" href="${placeSearchUrl(vendor)}" target="_blank" rel="noopener">查看 Google 地圖</a>
          <a class="button secondary" href="${directionsUrl(vendor)}" target="_blank" rel="noopener">導航到這裡</a>
        </div>
      </article>
    `).join("");
  }

  function initMap() {
    if (!window.L) {
      mapEl.innerHTML = '<div class="status map-note">互動地圖暫時無法載入；左側名單仍可使用。</div>';
      return false;
    }
    if (map) return true;
    map = L.map(mapEl, { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
    const note = L.control({ position: "topright" });
    note.onAdd = function () {
      const div = L.DomUtil.create("div", "status map-note");
      div.innerHTML = "<strong>行政區群組圖</strong><br>初始地圖以行政區群組顯示，不把區中心誤標成店家門牌。";
      return div;
    };
    note.addTo(map);
    return true;
  }

  function renderMap(vendors) {
    if (!initMap()) return;
    mapLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    const preciseVendors = [];
    const groups = new Map();

    vendors.forEach((vendor, index) => {
      if (!validLatLng(vendor.lat, vendor.lng)) return;
      if (hasPreciseCoordinate(vendor) && vendors.length <= 50) {
        preciseVendors.push({ vendor, index });
        return;
      }
      const key = `${vendor.district || "未標示"}|${vendor.lat}|${vendor.lng}`;
      const group = groups.get(key) || {
        district: vendor.district || "未標示",
        lat: Number(vendor.lat),
        lng: Number(vendor.lng),
        vendors: [],
      };
      group.vendors.push(vendor);
      groups.set(key, group);
    });

    groups.forEach((group) => {
      const point = [group.lat, group.lng];
      L.marker(point, {
        icon: markerIcon(`${districtShortName(group.district)}${group.vendors.length}`),
        title: `${group.district} ${group.vendors.length} 家`
      }).bindPopup(groupPopup(group)).addTo(mapLayer);
      bounds.extend(point);
    });

    preciseVendors.forEach(({ vendor, index }) => {
      const point = [Number(vendor.lat), Number(vendor.lng)];
      L.marker(point, {
        icon: markerIcon(String(index + 1), "precise-marker"),
        title: vendor.name
      }).bindPopup(vendorPopup(vendor, index)).addTo(mapLayer);
      bounds.extend(point);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 13 });
    } else {
      map.setView([25.0169, 121.4628], 11);
    }
  }

  function renderAll() {
    const vendors = filteredVendors();
    renderStatus(directoryData, vendors);
    renderList(vendors);
    renderMap(vendors);
  }

  function validateDirectoryPayload(data) {
    if (!data || data.ok !== true || !Array.isArray(data.vendors)) {
      throw new Error("invalid_directory_payload");
    }
    return data;
  }

  async function fetchDirectory(url) {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`directory_http_${response.status}`);
    return validateDirectoryPayload(await response.json());
  }

  async function loadDirectory() {
    try {
      const local = await fetchDirectory("vendor-directory.json");
      const total = Number(local.summary && local.summary.total || local.vendors.length || 0);
      if (total >= 100) return local;
    } catch (_err) {
      // Fall back to raw GitHub below.
    }
    return fetchDirectory(rawDirectoryUrl);
  }

  async function main() {
    directoryData = await loadDirectory();
    renderFilters(directoryData);
    districtFilter.addEventListener("change", renderAll);
    serviceFilter.addEventListener("change", renderAll);
    categoryFilter.addEventListener("change", renderAll);
    keywordFilter.addEventListener("input", renderAll);
    renderAll();
  }

  main().catch((err) => {
    const message = `全部廠商名單載入失敗：${err.message || err}`;
    statusEl.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
    summaryEl.textContent = "無法讀取全部特約廠商資料。";
    listEl.innerHTML = "";
    mapEl.innerHTML = `<div class="status">${escapeHtml(message)}</div>`;
  });
})();
