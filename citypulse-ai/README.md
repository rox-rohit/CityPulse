# CityPulse AI — Frontend

React + Vite + TypeScript frontend for the CityPulse AI urban analytics platform.
Focused on the **Maharaj Bada / Lashkar** Area of Interest in Gwalior,
Madhya Pradesh (4.434 km²).

## Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 + TypeScript + Vite 5 |
| Styling | Tailwind CSS with HSL design tokens (dark-first) |
| Routing | react-router-dom 6 |
| 2D map | Leaflet + react-leaflet |
| 3D map | CesiumJS (lazy-loaded, Esri World Imagery) |
| Tests | Vitest + Testing Library |

## Commands

```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api to 127.0.0.1:8000)
npm run build    # tsc + vite build
npx vitest run   # unit tests
npx tsc --noEmit # type check
```

The backend must be running on port 8000 for the Digital Twin to load data.

## Pages

| Route | State |
|-------|-------|
| `/` | Landing page |
| `/digital-twin` | **Wired to real PostGIS data** — 2D Leaflet and 3D Cesium views |
| `/traffic` | Simulated dataset (clearly labelled); not yet connected to the API |
| `/environment` | Simulated dataset; no measurement source exists yet |
| `/civic-issues` | Simulated dataset; no reporting store yet |
| `/scenario-lab` | Simulation definitions with stated assumptions and limitations |
| `/ai-analyst` | Rule-based responses over documented data categories |
| `/methodology` | Objectives, sources, cleaning, limitations, roadmap |

## Digital Twin

- Fetches `/api/layers`, `/api/layers/{layer}/geojson`, `/api/aoi` and `/api/summary`.
- Renders roads (cyan), buildings (violet), facilities (teal points), green spaces
  and the dashed AOI boundary.
- Layer toggles show the actual number of features returned by the API.
- Clicking a feature opens an inspector with the real attribute values and OSM id.
- Loading, error (with retry) and empty states are implemented.
- The 3D view extrudes buildings using `height_m`; where that is absent it uses
  3.2 m per storey and labels the extrusion as illustrative in the overlay.

## Data and honesty rules

- Values shown in the Digital Twin come from ingested OpenStreetMap geometry.
- OSM coverage in this area is incomplete (127 mapped buildings in 4.4 km²);
  unmapped features are simply absent rather than invented.
- Pages still using simulated data state that clearly in their copy.
- Attribution: © OpenStreetMap contributors (ODbL).
