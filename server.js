const http = require('http');
const fs = require('fs');
const path = require('path');
const { routes, getRoute } = require('./route-data');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.join(__dirname, 'docs');
const STALE_MS = 60000;
const TELEMETRY_TOKEN = process.env.TELEMETRY_TOKEN || '';

const buses = new Map();
const clients = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function pointAt(distance, route) {
  const d = Math.max(0, Math.min(distance, route.length));
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.path[i - 1];
  const b = route.path[i];
  const segment = Math.max(route.cum[i] - route.cum[i - 1], 0.001);
  const t = Math.max(0, Math.min(1, (d - route.cum[i - 1]) / segment));
  const lat = a[0] + (b[0] - a[0]) * t;
  const lng = a[1] + (b[1] - a[1]) * t;
  const bearing = Math.atan2((b[1] - a[1]) * Math.cos(lat * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
  return { lat, lng, bearing: (bearing + 360) % 360 };
}

function distanceAlong(lat, lng, route) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.path.length; i++) {
    const d = Math.hypot((route.path[i][0] - lat) * 111320, (route.path[i][1] - lng) * 102000);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return route.cum[best];
}

function snapshot() {
  const now = Date.now();
  const list = [];
  for (const bus of buses.values()) {
    if (now - bus.updatedAt > STALE_MS) {
      buses.delete(bus.busId);
      continue;
    }
    list.push({ ...bus, ageMs: now - bus.updatedAt });
  }
  return { buses: list, serverTime: now };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-telemetry-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function serveStatic(res, urlPath) {
  const clean = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(FRONTEND_DIR, path.normalize(clean).replace(/^([.][.][\\/])+/, ''));
  if (!file.startsWith(FRONTEND_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (pathname === '/api/routes' && req.method === 'GET') {
    sendJson(res, 200, routes.map((r) => ({ id: r.id, name: r.name, color: r.color, stops: r.stops.length })));
    return;
  }

  if (pathname === '/api/route' && req.method === 'GET') {
    const route = getRoute(url.searchParams.get('id'));
    sendJson(res, 200, {
      id: route.id,
      name: route.name,
      color: route.color,
      path: route.path,
      stops: route.stops,
      stopDistances: route.stopDistances,
      length: route.length
    });
    return;
  }

  if (pathname === '/api/buses' && req.method === 'GET') {
    sendJson(res, 200, snapshot());
    return;
  }

  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/api/telemetry/stop' && req.method === 'POST') {
    if (TELEMETRY_TOKEN && req.headers['x-telemetry-token'] !== TELEMETRY_TOKEN) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await readBody(req);
      buses.delete(String(body.busId || '').trim().slice(0, 40));
      sendJson(res, 200, { ok: true });
      broadcast();
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/telemetry' && req.method === 'POST') {
    if (TELEMETRY_TOKEN && req.headers['x-telemetry-token'] !== TELEMETRY_TOKEN) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await readBody(req);
      const busId = String(body.busId || '').trim().slice(0, 40);
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const route = getRoute(body.routeId);
      if (!busId || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 28 || lat > 34 || lng < 70 || lng > 78) {
        sendJson(res, 400, { error: 'busId, lat and lng are required and must be plausible' });
        return;
      }
      buses.set(busId, {
        busId,
        routeId: route.id,
        lat,
        lng,
        bearing: Number.isFinite(Number(body.bearing)) ? Number(body.bearing) : null,
        speed: Number.isFinite(Number(body.speed)) ? Math.max(0, Number(body.speed)) : null,
        source: String(body.source || 'gps').slice(0, 20),
        updatedAt: Date.now(),
        distance: distanceAlong(lat, lng, route)
      });
      sendJson(res, 200, { ok: true });
      broadcast();
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET') {
    serveStatic(res, pathname === '/driver' ? '/driver.html' : pathname);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

const simState = [];
for (const route of routes) {
  for (let i = 0; i < 2; i++) {
    simState.push({
      busId: `${route.id}-SIM-${i + 1}`,
      route,
      distance: route.length * (0.12 + i * 0.45),
      speed: 7 + i * 2,
      dir: 1
    });
  }
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 5);
  lastTick = now;
  for (const sim of simState) {
    sim.distance += sim.speed * dt * sim.dir;
    if (sim.distance >= sim.route.length) {
      sim.distance = sim.route.length;
      sim.dir = -1;
    } else if (sim.distance <= 0) {
      sim.distance = 0;
      sim.dir = 1;
    }
    const p = pointAt(sim.distance, sim.route);
    buses.set(sim.busId, {
      busId: sim.busId,
      routeId: sim.route.id,
      lat: p.lat,
      lng: p.lng,
      bearing: sim.dir === 1 ? p.bearing : (p.bearing + 180) % 360,
      speed: sim.speed,
      direction: sim.dir,
      source: 'sim',
      updatedAt: now,
      distance: sim.distance
    });
  }
  broadcast();
}, 1000);

server.listen(PORT, () => {
  console.log(`Speedo tracker prototype running at http://localhost:${PORT}`);
  console.log(`Driver telemetry page: http://localhost:${PORT}/driver`);
});
