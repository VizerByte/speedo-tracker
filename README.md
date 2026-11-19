# 🚌 Speedo Tracker

A lightweight, real-time bus tracking prototype. A zero-dependency Node.js backend keeps bus positions in memory and streams them to a Leaflet map hosted on GitHub Pages. Drivers can post GPS updates from a separate page, protected by an optional shared token.

![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-0A9B88?logo=githubpages&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![Backend](https://img.shields.io/badge/backend-Bonto-6f42c1)

## Live demo

| What | Link |
| --- | --- |
| Tracker | https://vizerbyte.github.io/speedo-tracker/ |
| RT-20 direct | https://vizerbyte.github.io/speedo-tracker/?route=RT-20&api=https://speedo-tracker.bonto.run |
| Driver telemetry | https://vizerbyte.github.io/speedo-tracker/driver.html?api=https://speedo-tracker.bonto.run |

The tracker saves the backend URL in `localStorage` when opened with `?api=<backend-url>`. The links above already include it, so you only need to open one once.

## Features

- 🗺️ Live map with route polyline, numbered stops, and moving bus markers (Leaflet + OpenStreetMap)
- 📡 Server-Sent Events stream at `/api/stream` for instant position updates
- ⏱️ Per-bus ETAs to the next stop and an arrivals board for upcoming stops
- 🧪 Two simulated buses per route out of the box — no GPS hardware needed to see it work
- 🔒 Optional `x-telemetry-token` header check on telemetry endpoints
- 🪶 Zero npm dependencies; plain Node `http` server

## Routes

| ID | Name | Stops |
| --- | --- | --- |
| `RT-04` | R.A. Bazar to Chungi Amar Sidhu | 15 |
| `RT-20` | Ali Town to University of Lahore | 16 |

## Run locally

No install step is required — the app uses only Node built-ins.

```bash
npm start
# Tracker:  http://localhost:3000/
# Driver:   http://localhost:3000/driver
```

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (defaults to `3000`) |
| `TELEMETRY_TOKEN` | If set, telemetry POSTs must send the same value in `x-telemetry-token` |

Never commit the token. Set it in the hosting provider's environment settings only.

## Architecture

```
GitHub Pages (docs/)  ──REST + SSE──▶  Node backend (server.js on Bonto)
       │                                      │
  Leaflet map                          in-memory bus state
  config.js (saves ?api=)              1s simulation loop
```

- **`docs/`** — static frontend, published by GitHub Pages from the `main` branch `/docs` folder
- **`server.js`** — HTTP API, static file serving, SSE broadcast, and simulator
- **`route-data.js`** — route paths, stops, and cumulative distances

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/routes` | GET | List available routes |
| `/api/route?id=RT-20` | GET | Full route geometry and stops |
| `/api/buses` | GET | Current bus snapshot |
| `/api/stream` | GET | SSE stream of snapshots |
| `/api/telemetry` | POST | Submit a bus position (`busId`, `lat`, `lng`, `routeId`, …) |
| `/api/telemetry/stop` | POST | Remove a bus from the live map |

## Deployment notes

- Frontend: GitHub Pages → *Deploy from a branch* → `main` → `/docs`
- Backend: Node web service at `https://speedo-tracker.bonto.run`, listening on the injected `PORT`
- Bonto free apps sleep when idle; the first request may take a few seconds to wake the backend
- The driver page asks for the telemetry token at runtime — it is not stored in the repository
