let routeData;
let activeRouteId;
let map;
let routeLayer;
let stopLayer;
let lastPayload;
const busMarkers = new Map();
const API_BASE = window.SPEEDO_API_BASE || '';

function api(path) {
  return `${API_BASE}${path}`;
}

function toLatLng(p) {
  return [p[0], p[1]];
}

function setStatus(live) {
  document.getElementById('dot').classList.toggle('live', live);
  document.getElementById('status-text').textContent = live ? 'Live connection' : 'Reconnecting…';
}

function speedOf(bus) {
  return bus.speed && bus.speed > 1 ? bus.speed : 8;
}

function nextStopFor(bus) {
  const d = bus.distance || 0;
  const dir = bus.direction || 1;
  const distances = routeData.stopDistances;
  if (dir < 0) {
    for (let i = distances.length - 1; i >= 0; i--) {
      if (distances[i] < d - 1) return { index: i, distance: d - distances[i] };
    }
    return { index: 0, distance: d };
  }
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] > d + 1) return { index: i, distance: distances[i] - d };
  }
  return { index: distances.length - 1, distance: routeData.length - d };
}

function etaMinutes(distance, speed) {
  return Math.round(distance / (speed * 60));
}

function renderBusList(buses) {
  const el = document.getElementById('bus-list');
  if (!buses.length) {
    el.innerHTML = '<div class="card">No buses reporting right now.</div>';
    return;
  }
  el.innerHTML = buses.map((bus) => {
    const next = nextStopFor(bus);
    const eta = etaMinutes(next.distance, speedOf(bus));
    const badge = bus.source === 'sim' ? '<span class="badge sim">SIM</span>' : '<span class="badge">GPS</span>';
    return `<div class="card"><span class="eta">${eta} min</span><div class="title">${bus.busId}${badge}</div><div class="meta">Next: ${routeData.stops[next.index].name}</div></div>`;
  }).join('');
}

function renderArrivals(buses) {
  const rows = routeData.stops.map((stop, i) => {
    let best = Infinity;
    for (const bus of buses) {
      const d = bus.distance || 0;
      const stopD = routeData.stopDistances[i];
      const remaining = bus.direction === -1 ? d - stopD : stopD - d;
      if (remaining >= 0) best = Math.min(best, etaMinutes(remaining, speedOf(bus)));
    }
    return { name: stop.name, eta: best };
  }).filter((row) => Number.isFinite(row.eta)).slice(0, 16);

  const el = document.getElementById('eta-list');
  el.innerHTML = rows.length
    ? rows.map((row) => `<div class="card"><span class="eta">${row.eta} min</span><div class="title">${row.name}</div></div>`).join('')
    : '<div class="card">Waiting for bus data…</div>';
}

function render(payload) {
  lastPayload = payload;
  const buses = payload.buses.filter((bus) => bus.routeId === activeRouteId);
  const seen = new Set();
  for (const bus of buses) {
    seen.add(bus.busId);
    let marker = busMarkers.get(bus.busId);
    if (!marker) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="bus-marker${bus.source === 'sim' ? ' sim' : ''}" style="background:${routeData.color}">BUS</div>`,
        iconSize: [34, 20],
        iconAnchor: [17, 10]
      });
      marker = L.marker([bus.lat, bus.lng], { icon }).addTo(map);
      busMarkers.set(bus.busId, marker);
    }
    marker.setLatLng([bus.lat, bus.lng]);
    const next = nextStopFor(bus);
    marker.setPopupContent(`<b>${bus.busId}</b><br>${bus.source === 'sim' ? 'Simulated' : 'GPS'}<br>Next: ${routeData.stops[next.index].name} (~${etaMinutes(next.distance, speedOf(bus))} min)`);
  }
  for (const [id, marker] of busMarkers) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      busMarkers.delete(id);
    }
  }
  renderBusList(buses);
  renderArrivals(buses);
  document.getElementById('updated').textContent = new Date(payload.serverTime).toLocaleTimeString();
}

function drawRoute() {
  if (routeLayer) map.removeLayer(routeLayer);
  if (stopLayer) map.removeLayer(stopLayer);
  for (const marker of busMarkers.values()) map.removeLayer(marker);
  busMarkers.clear();

  map.fitBounds(L.latLngBounds(routeData.path.map(toLatLng)));
  routeLayer = L.polyline(routeData.path.map(toLatLng), { color: routeData.color, weight: 5, opacity: 0.85 }).addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  routeData.stops.forEach((stop, i) => {
    L.circleMarker([stop.lat, stop.lng], {
      radius: 5,
      color: '#121b29',
      weight: 2,
      fillColor: '#e8eef7',
      fillOpacity: 1
    }).bindPopup(`<b>${i + 1}. ${stop.name}</b>`).addTo(stopLayer);
  });
}

async function loadRoute(id) {
  activeRouteId = id;
  const response = await fetch(api(`/api/route?id=${encodeURIComponent(id)}`));
  routeData = await response.json();
  document.getElementById('route-name').textContent = `${routeData.id} · ${routeData.name} · ${routeData.stops.length} stops`;
  drawRoute();
  if (lastPayload) render(lastPayload);
}

function connect() {
  const events = new EventSource(api('/api/stream'));
  events.onmessage = (event) => {
    setStatus(true);
    render(JSON.parse(event.data));
  };
  events.onerror = () => setStatus(false);
}

async function init() {
  const response = await fetch(api('/api/routes'));
  const list = await response.json();
  const select = document.getElementById('route-select');
  select.innerHTML = list.map((r) => `<option value="${r.id}">${r.id} · ${r.name}</option>`).join('');
  const initial = new URLSearchParams(location.search).get('route') || list[0].id;
  select.value = initial;
  select.addEventListener('change', () => loadRoute(select.value));

  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);
  await loadRoute(initial);
  connect();
}

init();
