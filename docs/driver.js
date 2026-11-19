let watchId = null;
let lastSent = 0;

const log = document.getElementById('log');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const busInput = document.getElementById('bus-id');
const routeSelect = document.getElementById('route-select');
const tokenInput = document.getElementById('token');
const API_BASE = window.SPEEDO_API_BASE || '';

function api(path) {
  return `${API_BASE}${path}`;
}

fetch(api('/api/routes')).then((r) => r.json()).then((list) => {
  routeSelect.innerHTML = list.map((r) => `<option value="${r.id}">${r.id} · ${r.name}</option>`).join('');
  const initial = new URLSearchParams(location.search).get('route') || list[0].id;
  routeSelect.value = initial;
  document.getElementById('route-name').textContent = `Reporting to: ${initial}`;
});
routeSelect.addEventListener('change', () => {
  document.getElementById('route-name').textContent = `Reporting to: ${routeSelect.value}`;
});

function report(message) {
  log.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${log.textContent}`;
}

async function send(position) {
  const now = Date.now();
  if (now - lastSent < 3000) return;
  lastSent = now;
  const payload = {
    busId: busInput.value.trim(),
    routeId: routeSelect.value,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    bearing: position.coords.heading,
    speed: position.coords.speed === null ? null : position.coords.speed,
    source: 'gps'
  };
  try {
    const response = await fetch(api('/api/telemetry'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telemetry-token': tokenInput.value.trim() },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    report(`Sent ${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)}`);
  } catch (err) {
    report(`Send failed: ${err.message}`);
  }
}

function onPosition(position) {
  report(`Fix: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} ±${Math.round(position.coords.accuracy)}m`);
  send(position);
}

startBtn.addEventListener('click', () => {
  const busId = busInput.value.trim();
  if (!busId) {
    report('Enter a bus ID first.');
    return;
  }
  if (!navigator.geolocation) {
    report('Geolocation is not available in this browser.');
    return;
  }
  watchId = navigator.geolocation.watchPosition(onPosition, (err) => report(`GPS error: ${err.message}`), {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 10000
  });
  startBtn.disabled = true;
  stopBtn.disabled = false;
  busInput.disabled = true;
  routeSelect.disabled = true;
  tokenInput.disabled = true;
  report('Sharing started.');
});

stopBtn.addEventListener('click', () => {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  busInput.disabled = false;
  routeSelect.disabled = false;
  tokenInput.disabled = false;
  fetch(api('/api/telemetry/stop'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telemetry-token': tokenInput.value.trim() },
    body: JSON.stringify({ busId: busInput.value.trim() })
  }).catch(() => {});
  report('Sharing stopped.');
});
