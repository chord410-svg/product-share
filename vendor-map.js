(function () {
  "use strict";
  const form = document.getElementById("queryForm");
  const listEl = document.getElementById("resultList");
  const countEl = document.getElementById("resultCount");
  const tpl = document.getElementById("vendorCardTemplate");
  const mapEl = document.getElementById("map");
  const fallbackEl = document.getElementById("mapFallback");
  const saveButton = document.getElementById("saveMapResult");
  let map = null;
  let markerLayer = null;
  let latest = null;

  function selectedService() {
    const checked = form.querySelector('input[name="service"]:checked');
    return checked ? checked.value : "";
  }

  function addressValue() {
    return ["cityInput", "districtInput", "roadInput", "numberInput"].map(function (id) {
      return document.getElementById(id).value.trim();
    }).join("");
  }

  function renderList(rows) {
    listEl.innerHTML = "";
    countEl.textContent = "找到 " + rows.length + " 家（依距離排序）";
    if (!rows.length) {
      const empty = document.createElement("p"); empty.className = "muted-text"; empty.textContent = "沒有符合條件的廠商。"; listEl.appendChild(empty); return;
    }
    rows.forEach(function (vendor, index) {
      const node = tpl.content.cloneNode(true);
      node.querySelector(".vendor-card__rank").textContent = String(index + 1);
      node.querySelector(".vendor-card__title").textContent = vendor.name;
      node.querySelector(".vendor-card__addr").textContent = vendor.address;
      node.querySelector(".vendor-card__dist").textContent = "約 " + Number(vendor.distance_km || 0).toFixed(1) + " 公里";
      const tags = node.querySelector(".vendor-card__tags");
      (vendor.service_types || []).forEach(function (label) { const tag = document.createElement("span"); tag.className = "badge badge--soft"; tag.textContent = label; tags.appendChild(tag); });
      const nav = node.querySelector(".vendor-card__nav"); nav.href = vendor.directions_url || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(vendor.address));
      const tel = node.querySelector(".vendor-card__tel"); tel.href = "tel:" + String(vendor.phone || "").replace(/[^0-9+]/g, ""); node.querySelector(".vendor-card__tel-text").textContent = vendor.phone || "未提供電話";
      listEl.appendChild(node);
    });
  }

  function markerIcon(text, home) {
    return window.L.divIcon({ className: "", html: '<span class="map-marker' + (home ? " map-marker--home" : "") + '">' + text + "</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function renderMap(data) {
    if (!window.L || !mapEl) { fallbackEl.hidden = false; return; }
    try {
      const home = data.home || {};
      if (!map) { map = window.L.map(mapEl, { scrollWheelZoom: false }).setView([home.lat, home.lng], 13); window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map); markerLayer = window.L.layerGroup().addTo(map); }
      markerLayer.clearLayers(); const bounds = [];
      window.L.marker([home.lat, home.lng], { icon: markerIcon("起", true) }).bindPopup(data.address || "查詢位置").addTo(markerLayer); bounds.push([home.lat, home.lng]);
      (data.vendors || []).forEach(function (vendor, index) { if (vendor.lat == null || vendor.lng == null) return; window.L.marker([vendor.lat, vendor.lng], { icon: markerIcon(String(index + 1), false) }).bindPopup("<strong>" + vendor.name + "</strong><br>" + vendor.address).addTo(markerLayer); bounds.push([vendor.lat, vendor.lng]); });
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
      setTimeout(function () { map.invalidateSize(); }, 50);
    } catch (_error) { fallbackEl.hidden = false; }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault(); const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; countEl.textContent = "查詢中"; saveButton.hidden = true;
    try {
      const data = await window.OBPortal.getJson("/api/v1/assistive-vendors/nearest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addressValue(), district: document.getElementById("districtInput").value.trim(), service_type: selectedService(), limit: Number(document.getElementById("limitInput").value || 5) }) });
      latest = data; renderList(data.vendors || []); renderMap(data); saveButton.hidden = false;
    } catch (error) { listEl.innerHTML = ""; const message = document.createElement("p"); message.className = "muted-text"; message.textContent = error.message || "查詢失敗"; listEl.appendChild(message); countEl.textContent = "查詢未完成"; }
    finally { submit.disabled = false; }
  });

  saveButton.addEventListener("click", async function () {
    if (!latest) return; saveButton.disabled = true;
    try { await window.OBPortal.getJson("/api/v1/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "vendor-map", title: "附近特約輔具廠商", summary: latest.address || addressValue(), share_url: latest.share_url || "", payload: latest }) }); countEl.textContent = "結果已儲存到我的結果"; }
    catch (error) { countEl.textContent = error.message || "儲存失敗"; }
    finally { saveButton.disabled = false; }
  });
})();
