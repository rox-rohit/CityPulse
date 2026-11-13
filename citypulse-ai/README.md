# CityPulse AI — Frontend

React + Vite + TypeScript frontend for the CityPulse AI urban analytics platform.
Focused on the **Maharaj Bada / Lashkar** Area of Interest in Gwalior, Madhya
Pradesh (4.434 km²).

## Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 + TypeScript + Vite 5 |
| Styling | Tailwind CSS with HSL design tokens (dark-first) |
| Routing | react-router-dom 6 (shared `DashboardLayout` for dashboard routes) |
| 2D map | Leaflet + react-leaflet |
| 3D map | CesiumJS (lazy-loaded, Esri World Imagery) |
| Tests | Vitest + Testing Library |

## Commands

```bash
npm install
npm run dev       # http://localhost:5173 (proxies /api to 127.0.0.1:8000)
npm run build     # tsc + vite build
npm test          # vitest run
npx tsc --noEmit  # type check
```

The backend must be running on port 8000 for any data to load.

## Pages

| Route | State |
|-------|-------|
| `/` | Landing page: product identity, module overview, real screenshots, limitations |
| `/digital-twin` | **Real PostGIS geometry** — 2D Leaflet and 3D Cesium views |
| `/traffic` | **Real** road-network statistics; states explicitly that no traffic volumes exist |
| `/environment` | **Real** modelled CAMS/ERA5 data plus CPCB station metadata and an honest empty state for observations |
| `/civic-issues` | **Real** PostGIS-backed reporting, moderation and hotspots; empty database is handled |
| `/scenario-lab` | Real baselines, simulated outputs with printed formulas and assumptions |
| `/ai-analyst` | SQL-backed answers with sources and uncertainty; refusals for unsupported questions |
| `/methodology` | Architecture, data types, database design, methods, provenance, limitations |

Dashboard routes share the responsive header in
`src/components/DashboardLayout.tsx` (desktop links plus a mobile menu with
active states and a skip link).

## Digital Twin

- Fetches `/api/layers`, `/api/layers/{layer}/geojson`, `/api/aoi` and `/api/summary`.
- Renders roads (cyan), buildings (violet), facilities (teal points), green spaces
  and the dashed AOI boundary.
- Layer toggles show the actual number of features returned by the API.
- Clicking a feature opens an inspector with real attribute values and OSM id.
- Loading, error (with retry) and empty states are implemented.
- The 3D view extrudes buildings using `height_m`; where absent it uses 3.2 m per
  storey and labels the extrusion illustrative in the overlay.

## Data and honesty rules

- Geometry comes from ingested OpenStreetMap data; nothing is invented.
- OSM coverage in this area is incomplete (127 mapped buildings in 4.4 km²).
- Modelled, observed, derived and simulated values are visually distinguished and
  never merged into a single metric.
- Missing data renders as an explicit unavailable state.
- Attribution: © OpenStreetMap contributors (ODbL).
