/* Rutas Bloobit — lógica de la aplicación.
 * Servicios gratuitos usados (sin llaves):
 *   - OSRM (router.project-osrm.org): tiempos de manejo reales por calles y trazo de la ruta.
 *   - Nominatim (OpenStreetMap): búsqueda de direcciones y dirección del pin.
 * Los datos de empresas se guardan en este navegador (localStorage) y se pueden exportar/importar en JSON.
 */
(function () {
  "use strict";

  const OSRM = "https://router.project-osrm.org";
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const QRO_VIEWBOX = "-100.70,20.90,-100.10,20.35"; // prioriza resultados en la zona de Querétaro
  const LS_KEY = "rutas-bloobit-v1";

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ------------------------------------------------------------------ estado
  let state = { places: [], selected: [], settings: { start: "09:00", service: 15, ret: true } };
  function load() {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && Array.isArray(s.places)) state = Object.assign(state, s); } catch (e) {}
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { toast("No se pudo guardar en este navegador."); } }
  const office = () => state.places.find((p) => p.isOffice);
  const byId = (id) => state.places.find((p) => p.id === id);
  const uid = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ------------------------------------------------------------------ utilidades
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
  }
  function showMsg(node, text, info) { node.textContent = text; node.classList.toggle("info", !!info); node.hidden = !text; }
  const fmtKm = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km");
  function fmtDur(s) { const m = Math.round(s / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min"; }
  function fmtClock(minsFromMidnight) { const m = Math.round(minsFromMidnight) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function haversine(a, b) {
    const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Coordenadas desde texto o link largo de Google Maps
  function parseCoords(txt) {
    if (!txt) return null;
    let t = txt.trim(); try { t = decodeURIComponent(t); } catch (e) {}
    const pats = [
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
      /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
      /[?&](?:q|query|ll|destination|daddr|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
      /^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/
    ];
    for (const p of pats) {
      const m = t.match(p);
      if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; }
    }
    return null;
  }
  const isShortLink = (t) => /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(t || "");

  async function getJSON(url, timeoutMs = 15000) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "Accept": "application/json", "Accept-Language": "es" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  function setSvc(ok, text) { const s = $("#svcStatus"); s.textContent = text; s.className = "svc " + (ok ? "ok" : "bad"); }

  // Nominatim pide máximo 1 petición por segundo
  let lastNom = 0;
  async function nominatim(path) {
    const wait = Math.max(0, lastNom + 1100 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastNom = Date.now();
    return getJSON(NOMINATIM + path);
  }

  // ------------------------------------------------------------------ mapa
  const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20.5888, -100.3899], 12);
  // Mapa base de OpenStreetMap (sin llave); el tono oscuro azul se aplica con un filtro CSS
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Rutas: <a href="https://project-osrm.org">OSRM</a> · Búsqueda: Nominatim / Photon'
  }).addTo(map);
  const placesLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  let editMarker = null;
  let lastRoute = null; // { order:[ids], legs }

  function icon(kind, label) {
    const sizes = { stop: 28, idle: 14, office: 30, edit: 22 };
    const s = sizes[kind];
    return L.divIcon({ className: "", html: '<div class="pin ' + kind + '">' + (label || "") + "</div>", iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
  }
  function popupFor(p) {
    const d = el("div");
    d.appendChild(el("b", null, p.name));
    if (p.address) d.appendChild(el("div", null, p.address));
    if (p.notes) { const n = el("div", null, p.notes); n.style.color = "var(--muted)"; d.appendChild(n); }
    return d;
  }
  function drawPlaces() {
    placesLayer.clearLayers();
    const order = new Map(); if (lastRoute) lastRoute.order.forEach((id, i) => order.set(id, i + 1));
    for (const p of state.places) {
      let ic;
      if (p.isOffice) ic = icon("office", "OF");
      else if (order.has(p.id)) ic = icon("stop", order.get(p.id));
      else ic = icon("idle");
      L.marker([p.lat, p.lng], { icon: ic, zIndexOffset: p.isOffice ? 1000 : order.has(p.id) ? 500 : 0 }).bindPopup(popupFor(p)).addTo(placesLayer);
    }
  }
  function fitAll() {
    const pts = state.places.map((p) => [p.lat, p.lng]);
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
    else if (pts.length === 1) map.setView(pts[0], 14);
  }

  // ------------------------------------------------------------------ pestañas
  let currentTab = "ruta";
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("active", on); t.setAttribute("aria-selected", on); });
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
    if (name !== "registro") clearEdit(false);
    setTimeout(() => map.invalidateSize(), 50);
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  // ------------------------------------------------------------------ listas
  function renderAll() {
    $("#countEmp").textContent = state.places.length;
    renderPick(); renderCompanies(); drawPlaces();
  }
  function renderPick() {
    const ul = $("#pickList"); ul.textContent = "";
    const list = state.places.filter((p) => !p.isOffice).sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (!office()) { ul.appendChild(el("p", "empty", "Primero registra la oficina en la pestaña Registrar.")); }
    if (!list.length) { ul.appendChild(el("p", "empty", "Aún no hay empresas registradas.")); return; }
    for (const p of list) {
      const li = el("li"), lab = el("label"), cb = el("input");
      cb.type = "checkbox"; cb.id = "pk-" + p.id; cb.checked = state.selected.includes(p.id);
      cb.addEventListener("change", () => {
        state.selected = cb.checked ? [...new Set([...state.selected, p.id])] : state.selected.filter((x) => x !== p.id);
        save();
      });
      lab.htmlFor = cb.id;
      lab.append(cb, el("span", "name", p.name), el("span", "badge " + (p.verified ? "ver" : "unver"), p.verified ? "Verificada" : "Sin verificar"));
      li.appendChild(lab); ul.appendChild(li);
    }
  }
  function renderCompanies() {
    const ul = $("#companyList"); ul.textContent = "";
    const q = ($("#filter").value || "").toLowerCase().trim();
    const list = state.places
      .filter((p) => !q || [p.name, p.address, p.contact, p.notes].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.isOffice - a.isOffice) || a.name.localeCompare(b.name, "es"));
    if (!list.length) { ul.appendChild(el("p", "empty", q ? "Ninguna empresa coincide con la búsqueda." : "Aún no hay empresas. Regístralas en la pestaña Registrar.")); return; }
    for (const p of list) {
      const li = el("li", "company"), top = el("div", "top");
      top.appendChild(el("div", "nm", p.name));
      const badges = el("div", "row");
      if (p.isOffice) badges.appendChild(el("span", "badge office", "Oficina"));
      badges.appendChild(el("span", "badge " + (p.verified ? "ver" : "unver"), p.verified ? "Verificada" : "Sin verificar"));
      top.appendChild(badges); li.appendChild(top);
      if (p.address) li.appendChild(el("div", "meta", p.address));
      const contact = [p.contact, p.phone].filter(Boolean).join(" · "); if (contact) li.appendChild(el("div", "meta", contact));
      if (p.notes) li.appendChild(el("div", "meta", p.notes));
      li.appendChild(el("div", "mono", p.lat.toFixed(6) + ", " + p.lng.toFixed(6) + (p.verified && p.verified.roadDist != null ? "  ·  a " + Math.round(p.verified.roadDist) + " m de la calle" : "")));
      const acts = el("div", "acts");
      const bSee = el("button", "link", "Ver en mapa"); bSee.type = "button";
      bSee.onclick = () => { map.setView([p.lat, p.lng], 17); if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: "smooth" }); };
      const bEdit = el("button", "link", "Editar / verificar"); bEdit.type = "button"; bEdit.onclick = () => startEdit(p);
      const bG = el("a", "link", "Abrir en Google Maps"); bG.href = "https://www.google.com/maps/search/?api=1&query=" + p.lat + "," + p.lng; bG.target = "_blank"; bG.rel = "noopener";
      const bDel = el("button", "link danger", "Eliminar"); bDel.type = "button";
      bDel.onclick = () => {
        if (!bDel.dataset.armed) { bDel.dataset.armed = "1"; bDel.textContent = "Confirmar eliminar"; setTimeout(() => { delete bDel.dataset.armed; bDel.textContent = "Eliminar"; }, 3500); return; }
        state.places = state.places.filter((x) => x.id !== p.id); state.selected = state.selected.filter((x) => x !== p.id);
        save(); clearRoute(); renderAll(); toast("Empresa eliminada.");
      };
      acts.append(bSee, bEdit, bG, bDel); li.appendChild(acts); ul.appendChild(li);
    }
  }
  $("#filter").addEventListener("input", renderCompanies);
  $("#selAll").onclick = () => { state.selected = state.places.filter((p) => !p.isOffice).map((p) => p.id); save(); renderPick(); };
  $("#selNone").onclick = () => { state.selected = []; save(); renderPick(); };

  // ------------------------------------------------------------------ registro y verificación
  let editingId = null;
  let pin = null;          // {lat,lng}
  let verification = null; // {roadDist, roadName, address, at}
  let verifyToken = 0;

  function clearEdit(resetForm = true) {
    if (editMarker) { map.removeLayer(editMarker); editMarker = null; }
    pin = null; verification = null; $("#verifyBox").hidden = true; $("#geoResults").textContent = "";
    if (resetForm) {
      editingId = null; $("#regForm").reset(); $("#geoQuery").value = "";
      $("#regTitle").textContent = "Registrar empresa"; $("#btnSave").textContent = "Guardar empresa";
      showMsg($("#regMsg"), "");
    }
  }
  function startEdit(p) {
    showTab("registro"); clearEdit(true);
    editingId = p.id;
    $("#regTitle").textContent = "Editar: " + p.name; $("#btnSave").textContent = "Guardar cambios";
    $("#fName").value = p.name || ""; $("#fAddr").value = p.address || ""; $("#fContact").value = p.contact || "";
    $("#fPhone").value = p.phone || ""; $("#fNotes").value = p.notes || ""; $("#fOffice").checked = !!p.isOffice;
    setPin(p.lat, p.lng, true);
  }

  function setPin(lat, lng, zoom) {
    pin = { lat, lng };
    if (!editMarker) {
      editMarker = L.marker([lat, lng], { icon: icon("edit"), draggable: true, zIndexOffset: 2000, autoPan: true }).addTo(map);
      editMarker.on("dragend", () => { const ll = editMarker.getLatLng(); pin = { lat: ll.lat, lng: ll.lng }; $("#fConfirm").checked = false; verify(); });
    } else editMarker.setLatLng([lat, lng]);
    if (zoom) map.setView([lat, lng], 18);
    $("#fConfirm").checked = false;
    verify();
  }

  async function verify() {
    const token = ++verifyToken, p = pin;
    verification = null;
    $("#verifyBox").hidden = false;
    $("#vCoords").textContent = p.lat.toFixed(6) + ", " + p.lng.toFixed(6);
    const chip = $("#vChip"); chip.className = "chip"; chip.textContent = "Verificando…";
    $("#vAddr").textContent = "Consultando…"; $("#vRoad").textContent = "Consultando…"; $("#vAdvice").textContent = "";

    const [rev, near] = await Promise.allSettled([
      nominatim("/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=es&lat=" + p.lat + "&lon=" + p.lng),
      getJSON(OSRM + "/nearest/v1/driving/" + p.lng + "," + p.lat + "?number=1")
    ]);
    if (token !== verifyToken) return; // el pin se movió mientras consultábamos

    const v = { at: new Date().toISOString(), address: null, roadDist: null, roadName: null };
    if (rev.status === "fulfilled" && rev.value && rev.value.display_name) {
      v.address = rev.value.display_name;
      $("#vAddr").textContent = v.address;
      if (!$("#fAddr").value.trim()) $("#fAddr").value = shortAddress(rev.value);
    } else $("#vAddr").textContent = "No se pudo obtener la dirección (revisa tu conexión).";

    if (near.status === "fulfilled" && near.value && near.value.code === "Ok" && near.value.waypoints && near.value.waypoints[0]) {
      const w = near.value.waypoints[0];
      v.roadDist = w.distance; v.roadName = w.name || "calle sin nombre";
      $("#vRoad").textContent = v.roadName + " · a " + Math.round(w.distance) + " m del pin";
      setSvc(true, "Servicio de rutas: en línea");
    } else { $("#vRoad").textContent = "No se pudo consultar el servicio de rutas."; setSvc(false, "Servicio de rutas: sin respuesta"); }

    if (v.roadDist == null) { chip.className = "chip warn"; chip.textContent = "Verificación incompleta"; $("#vAdvice").textContent = "Puedes guardar, pero vuelve a verificarla después."; }
    else if (v.roadDist <= 60) { chip.className = "chip ok"; chip.textContent = "Ubicación correcta"; $("#vAdvice").textContent = "El pin está junto a una calle transitable. Confirma que sea la entrada correcta."; }
    else if (v.roadDist <= 200) { chip.className = "chip warn"; chip.textContent = "Revisa el pin"; $("#vAdvice").textContent = "El pin está algo lejos de la calle. Si el acceso está en otra calle, arrástralo a la puerta o al andén de carga."; }
    else { chip.className = "chip bad"; chip.textContent = "Pin lejos de la calle"; $("#vAdvice").textContent = "Está a más de 200 m de una calle. Lo más probable es que el pin esté mal; acércalo a la entrada."; }
    verification = v;
  }
  function shortAddress(r) {
    const a = r.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ");
    const parts = [street, a.neighbourhood || a.suburb || a.quarter || a.industrial, a.city || a.town || a.village || a.municipality, a.state].filter(Boolean);
    return parts.length ? parts.join(", ") : r.display_name;
  }

  async function geoSearch() {
    const q = $("#geoQuery").value.trim(), ul = $("#geoResults"); ul.textContent = "";
    showMsg($("#regMsg"), "");
    if (!q) return;
    const c = parseCoords(q);
    if (c) { setPin(c.lat, c.lng, true); return; }
    if (isShortLink(q)) {
      showMsg($("#regMsg"), "Los links cortos (maps.app.goo.gl) no traen las coordenadas. Ábrelo en Google Maps, mantén presionado el lugar y copia los números que aparecen (ej. 20.5888, -100.3899), o copia el link completo de la barra del navegador.");
      return;
    }
    $("#btnGeo").disabled = true; $("#btnGeo").textContent = "Buscando…";
    try {
      const results = await searchAddress(q);
      if (!results.length) { ul.appendChild(el("p", "empty", "Sin resultados. Prueba solo con calle, número y ciudad (ej. «Puente de Alvarado 303, Querétaro»), o coloca el pin con un clic en el mapa.")); return; }
      for (const r of results) {
        const li = el("li"), b = el("button"); b.type = "button";
        b.appendChild(document.createTextNode(r.label));
        const prec = r.precision === "exacta" ? "Número exacto" : r.precision === "calle" ? "Solo la calle: ajusta el pin al número" : "Zona aproximada: ajusta el pin";
        b.appendChild(el("small", null, prec + " · " + r.lat.toFixed(5) + ", " + r.lng.toFixed(5) + " · " + r.source));
        b.onclick = () => {
          ul.textContent = ""; if (!$("#fAddr").value.trim()) $("#fAddr").value = r.short;
          setPin(r.lat, r.lng, true);
          if (r.precision !== "exacta") toast("Ubicación aproximada: arrastra el pin hasta la entrada exacta.");
        };
        li.appendChild(b); ul.appendChild(li);
      }
    } catch (e) {
      ul.appendChild(el("p", "empty", "No se pudo buscar la dirección (" + e.message + "). Intenta de nuevo en unos segundos o pega las coordenadas."));
    } finally { $("#btnGeo").disabled = false; $("#btnGeo").textContent = "Buscar"; }
  }

  // Normaliza direcciones mexicanas: abreviaturas, código postal y estado
  function cleanQuery(q) {
    return q
      .replace(/\bC\.?\s?P\.?\s*(?=\d)/gi, "").replace(/\bC\.\s*/gi, "Calle ").replace(/\bAv\.?\s+/gi, "Avenida ").replace(/\bBlvd\.?\s+/gi, "Boulevard ")
      .replace(/\bProl\.?\s+/gi, "Prolongación ").replace(/\bCarr\.?\s+/gi, "Carretera ").replace(/\bCol\.?\s+/gi, "")
      .replace(/\b\d{5}\b/g, "")
      .replace(/\bQro\.?(?=\s|,|$)/gi, "Querétaro").replace(/\bSantiago de Querétaro\b/gi, "Querétaro")
      .replace(/\s+,/g, ",").replace(/(,\s*)+/g, ", ").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
  }
  // Calle y número sin colonia (Nominatim falla seguido con la colonia)
  function streetOnly(clean) {
    const parts = clean.split(",").map((s) => s.trim()).filter(Boolean);
    const city = parts.find((p) => /quer[eé]taro|corregidora|marqu[eé]s|monterrey|san juan del r[ií]o/i.test(p)) || "Querétaro";
    return parts[0] + ", " + city;
  }

  function fromNominatim(r) {
    const a = r.address || {};
    const precision = a.house_number ? "exacta" : (r.addresstype === "road" || r.category === "highway") ? "calle" : "zona";
    return { lat: +r.lat, lng: +r.lon, label: r.display_name, short: shortAddress(r), precision, source: "OpenStreetMap" };
  }
  function fromPhoton(f) {
    const p = f.properties || {}, c = f.geometry.coordinates;
    const street = [p.street || (p.type === "street" ? p.name : null), p.housenumber].filter(Boolean).join(" ");
    const parts = [p.type !== "street" && p.type !== "house" ? p.name : null, street, p.district || p.locality, p.city, p.state, p.postcode].filter(Boolean);
    const precision = p.housenumber ? "exacta" : p.type === "street" ? "calle" : "zona";
    return { lat: c[1], lng: c[0], label: [...new Set(parts)].join(", "), short: [street, p.district || p.locality, p.city].filter(Boolean).join(", ") || p.name, precision, source: "Photon" };
  }

  async function photon(q) {
    const r = await getJSON("https://photon.komoot.io/api/?limit=6&bbox=-101.2,20.0,-99.6,21.7&lat=20.59&lon=-100.39&q=" + encodeURIComponent(q), 12000);
    return (r.features || []).filter((f) => f.geometry && f.properties && f.properties.countrycode === "MX").map(fromPhoton);
  }
  async function nomSearch(q) {
    const r = await nominatim("/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=mx&accept-language=es&viewbox=" + QRO_VIEWBOX + "&q=" + encodeURIComponent(q));
    return r.map(fromNominatim);
  }

  // Busca en dos servicios y con varias versiones de la dirección; ordena por precisión
  async function searchAddress(q) {
    const clean = cleanQuery(q);
    const tries = [() => photon(clean), () => nomSearch(clean)];
    let out = [];
    const settled = await Promise.allSettled(tries.map((f) => f()));
    settled.forEach((s) => { if (s.status === "fulfilled") out.push(...s.value); });
    if (!out.length) {
      for (const f of [() => nomSearch(q), () => nomSearch(streetOnly(clean)), () => photon(streetOnly(clean))]) {
        try { out.push(...(await f())); } catch (e) {}
        if (out.length) break;
      }
    }
    if (!out.length && settled.every((s) => s.status === "rejected")) throw new Error("servicios de búsqueda sin respuesta");
    const rank = { exacta: 0, calle: 1, zona: 2 };
    out.sort((a, b) => rank[a.precision] - rank[b.precision]);
    const unique = [];
    for (const r of out) if (!unique.some((u) => haversine(u, r) < 30)) unique.push(r);
    return unique.slice(0, 6);
  }
  $("#btnGeo").onclick = geoSearch;
  $("#geoQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); geoSearch(); } });
  map.on("click", (e) => { if (currentTab === "registro") setPin(e.latlng.lat, e.latlng.lng, false); });
  $("#btnCancel").onclick = () => clearEdit(true);

  $("#regForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("#regMsg"), name = $("#fName").value.trim();
    if (!name) return showMsg(msg, "Escribe el nombre de la empresa.");
    if (!pin) return showMsg(msg, "Falta la ubicación: busca la dirección o haz clic en el mapa.");
    if (!$("#fConfirm").checked) return showMsg(msg, "Confirma que revisaste el pin en el mapa antes de guardar.");
    const dup = state.places.find((p) => p.id !== editingId && haversine(p, pin) < 25);
    if (dup && !msg.dataset.dupOk) { msg.dataset.dupOk = "1"; return showMsg(msg, "Ya existe «" + dup.name + "» a menos de 25 m. Si es otra empresa, presiona Guardar otra vez."); }
    delete msg.dataset.dupOk;
    const isOffice = $("#fOffice").checked;
    const rec = {
      id: editingId || uid(), name, address: $("#fAddr").value.trim(), contact: $("#fContact").value.trim(),
      phone: $("#fPhone").value.trim(), notes: $("#fNotes").value.trim(), lat: +pin.lat.toFixed(7), lng: +pin.lng.toFixed(7),
      isOffice, verified: verification && verification.roadDist != null && verification.roadDist <= 200 ? verification : null,
      updated: new Date().toISOString()
    };
    if (isOffice) state.places.forEach((p) => (p.isOffice = false));
    const i = state.places.findIndex((p) => p.id === rec.id);
    if (i >= 0) state.places[i] = rec; else { state.places.push(rec); if (!isOffice) state.selected.push(rec.id); }
    if (isOffice) state.selected = state.selected.filter((x) => x !== rec.id);
    save(); clearRoute(); clearEdit(true); renderAll();
    toast(isOffice ? "Oficina guardada." : "Empresa guardada.");
  });

  // ------------------------------------------------------------------ cálculo de ruta
  function clearRoute() { lastRoute = null; routeLayer.clearLayers(); $("#routeResult").hidden = true; drawPlaces(); }

  async function osrmMatrix(pts) {
    const coords = pts.map((p) => p.lng + "," + p.lat).join(";");
    const r = await getJSON(OSRM + "/table/v1/driving/" + coords + "?annotations=duration,distance", 25000);
    if (r.code !== "Ok") throw new Error(r.message || r.code);
    return r;
  }
  async function osrmRoute(pts) {
    const coords = pts.map((p) => p.lng + "," + p.lat).join(";");
    const r = await getJSON(OSRM + "/route/v1/driving/" + coords + "?overview=full&geometries=geojson&steps=false", 25000);
    if (r.code !== "Ok" || !r.routes || !r.routes[0]) throw new Error(r.message || r.code);
    return r.routes[0];
  }

  async function calcRoute() {
    const msg = $("#routeMsg"); showMsg(msg, "");
    const o = office();
    if (!o) return showMsg(msg, "Registra primero la oficina (pestaña Registrar, marca «Esta es la oficina»).");
    const stops = state.selected.map(byId).filter((p) => p && !p.isOffice);
    if (!stops.length) return showMsg(msg, "Marca al menos una empresa a visitar.");
    if (stops.length > 60) return showMsg(msg, "Selecciona como máximo 60 paradas por ruta.");
    const ret = $("#returnOffice").checked;
    const pts = [o, ...stops];
    const btn = $("#btnRoute"); btn.disabled = true; btn.textContent = "Calculando con tráfico típico de calles…";
    let M, D, estimated = false;
    try {
      const t = await osrmMatrix(pts);
      M = t.durations; D = t.distances;
      const bad = [];
      for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) if (i !== j && (M[i][j] == null)) bad.push(j);
      if (bad.length) {
        const names = [...new Set(bad)].map((j) => pts[j].name).join(", ");
        btn.disabled = false; btn.textContent = "Calcular mejor ruta";
        return showMsg(msg, "No hay camino por calle hacia: " + names + ". Revisa su pin en Empresas → Editar / verificar.");
      }
      setSvc(true, "Servicio de rutas: en línea");
    } catch (e) {
      // Respaldo: distancia en línea recta × 1.35 a 30 km/h
      estimated = true; setSvc(false, "Servicio de rutas: sin respuesta");
      M = pts.map((a) => pts.map((b) => (haversine(a, b) * 1.35) / (30 / 3.6)));
      D = pts.map((a) => pts.map((b) => haversine(a, b) * 1.35));
    }

    const seqIdx = RouteSolver.solve(M, ret);
    const ordered = seqIdx.map((i) => pts[i]);
    const path = [o, ...ordered].concat(ret ? [o] : []);

    let legs = [], geometry = null;
    if (!estimated) {
      try {
        const r = await osrmRoute(path);
        legs = r.legs.map((l) => ({ duration: l.duration, distance: l.distance }));
        geometry = r.geometry.coordinates.map((c) => [c[1], c[0]]);
      } catch (e) { /* se usa la matriz */ }
    }
    if (!legs.length) {
      const idx = [0, ...seqIdx].concat(ret ? [0] : []);
      for (let i = 0; i < idx.length - 1; i++) legs.push({ duration: M[idx[i]][idx[i + 1]], distance: D[idx[i]][idx[i + 1]] });
    }
    lastRoute = { order: ordered.map((p) => p.id), legs, ret, estimated };
    btn.disabled = false; btn.textContent = "Recalcular ruta";
    renderRoute(o, ordered, legs, ret, estimated, geometry, path);
  }

  function renderRoute(o, ordered, legs, ret, estimated, geometry, path) {
    const start = (() => { const [h, m] = ($("#startTime").value || "09:00").split(":").map(Number); return h * 60 + m; })();
    const service = Math.max(0, +$("#serviceMin").value || 0);
    const driveS = legs.reduce((a, l) => a + l.duration, 0), distM = legs.reduce((a, l) => a + l.distance, 0);

    const first = $("#firstStop"); first.textContent = "";
    first.append(el("span", null, "Ve primero a"), el("b", null, ordered[0].name),
      el("small", null, fmtDur(legs[0].duration) + " desde la oficina · " + fmtKm(legs[0].distance)));

    const ol = $("#itinerary"); ol.textContent = "";
    let t = start;
    const row = (numCls, numTxt, name, sub, time, small) => {
      const li = el("li"); li.append(el("div", "num " + numCls, numTxt));
      const mid = el("div"); mid.append(el("div", "it-name", name)); if (sub) mid.append(el("div", "it-sub", sub)); li.append(mid);
      const tm = el("div", "it-time", time); if (small) tm.append(el("small", null, small)); li.append(tm);
      ol.appendChild(li);
    };
    row("office", "SAL", o.name, "Salida", fmtClock(t), "");
    ordered.forEach((p, i) => {
      t += legs[i].duration / 60;
      const arrive = t; t += service;
      row("", String(i + 1), p.name, [p.address, p.notes].filter(Boolean).join(" · "), fmtClock(arrive), "+" + fmtDur(legs[i].duration) + " · " + fmtKm(legs[i].distance));
    });
    if (ret) { const l = legs[legs.length - 1]; t += l.duration / 60; row("office", "FIN", o.name, "Regreso", fmtClock(t), "+" + fmtDur(l.duration) + " · " + fmtKm(l.distance)); }

    $("#kStops").textContent = ordered.length;
    $("#kDrive").textContent = fmtDur(driveS);
    $("#kDist").textContent = fmtKm(distM);
    $("#kEnd").textContent = fmtClock(t);

    // Enlaces de navegación (Google Maps admite 9 paradas intermedias por enlace)
    const nav = $("#navLinks"); nav.textContent = "";
    const ll = (p) => p.lat + "," + p.lng;
    const chunks = []; let i = 0;
    while (i < path.length - 1) { const end = Math.min(i + 10, path.length - 1); chunks.push(path.slice(i, end + 1)); i = end; }
    chunks.forEach((c, k) => {
      let url = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + ll(c[0]) + "&destination=" + ll(c[c.length - 1]);
      const w = c.slice(1, -1); if (w.length) url += "&waypoints=" + encodeURIComponent(w.map(ll).join("|"));
      const a = el("a", "btn primary", chunks.length > 1 ? "Abrir tramo " + (k + 1) + " de " + chunks.length + " en Google Maps" : "Abrir ruta en Google Maps");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; nav.appendChild(a);
    });
    const wz = el("a", "btn ghost", "Primera parada en Waze"); wz.href = "https://waze.com/ul?ll=" + ll(ordered[0]) + "&navigate=yes"; wz.target = "_blank"; wz.rel = "noopener"; nav.appendChild(wz);

    $("#routeNote").textContent = estimated
      ? "El servicio de rutas no respondió: el orden se calculó con distancias aproximadas. Vuelve a calcular en unos minutos para usar tiempos reales."
      : "Orden calculado con tiempos de manejo reales por calles (OpenStreetMap). " + (ordered.length <= 12 ? "Es la combinación óptima." : "Optimizado por aproximación.") + " Google Maps ajustará según el tráfico del momento.";
    $("#routeResult").hidden = false;

    routeLayer.clearLayers();
    const line = geometry || path.map((p) => [p.lat, p.lng]);
    L.polyline(line, { color: "#0B2F7A", weight: 9, opacity: 0.8 }).addTo(routeLayer);
    L.polyline(line, { color: "#5FA0FF", weight: 4.5, opacity: 1, dashArray: geometry ? null : "8 8" }).addTo(routeLayer);
    drawPlaces();
    map.fitBounds(line, { padding: [50, 50] });
  }
  $("#btnRoute").onclick = calcRoute;
  ["startTime", "serviceMin", "returnOffice"].forEach((id) => $("#" + id).addEventListener("change", () => {
    state.settings = { start: $("#startTime").value, service: +$("#serviceMin").value || 0, ret: $("#returnOffice").checked }; save();
    if (lastRoute) calcRoute();
  }));

  // ------------------------------------------------------------------ exportar / importar
  $("#btnExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "rutas-bloobit", version: 1, exported: new Date().toISOString(), places: state.places }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "empresas-rutas-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.places;
      if (!Array.isArray(list)) throw new Error("formato");
      let added = 0, updated = 0;
      for (const p of list) {
        if (typeof p.lat !== "number" || typeof p.lng !== "number" || !p.name) continue;
        const rec = Object.assign({ id: uid() }, p);
        const i = state.places.findIndex((x) => x.id === rec.id);
        if (i >= 0) { state.places[i] = rec; updated++; } else { state.places.push(rec); added++; }
      }
      const offices = state.places.filter((p) => p.isOffice); offices.slice(0, -1).forEach((p) => (p.isOffice = false));
      save(); clearRoute(); renderAll(); fitAll();
      toast("Importadas: " + added + " nuevas, " + updated + " actualizadas.");
    } catch (err) { toast("El archivo no es un respaldo válido de Rutas."); }
    e.target.value = "";
  });

  // ------------------------------------------------------------------ arranque
  async function bootstrap() {
    load();
    // Si no hay datos en el navegador, intenta cargar la lista base del repositorio (empresas.json)
    if (!state.places.length) {
      try {
        const base = await getJSON("empresas.json", 5000);
        const list = Array.isArray(base) ? base : base.places;
        if (Array.isArray(list) && list.length) { state.places = list.filter((p) => typeof p.lat === "number"); save(); }
      } catch (e) {}
    }
    $("#startTime").value = state.settings.start || "09:00";
    $("#serviceMin").value = state.settings.service ?? 15;
    $("#returnOffice").checked = state.settings.ret !== false;
    renderAll(); fitAll();
    if (!office()) { showTab("registro"); showMsg($("#regMsg"), "Empieza registrando la oficina: busca su dirección o pega sus coordenadas y marca «Esta es la oficina».", true); }
    // Prueba rápida del servicio de rutas
    getJSON(OSRM + "/nearest/v1/driving/-100.3899,20.5888?number=1", 8000)
      .then((r) => setSvc(r.code === "Ok", r.code === "Ok" ? "Servicio de rutas: en línea" : "Servicio de rutas: con fallas"))
      .catch(() => setSvc(false, "Servicio de rutas: sin respuesta"));
  }
  bootstrap();
})();
