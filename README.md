# CityPulse AI

Urban analytics and digital-twin platform for **Gwalior, Madhya Pradesh**, starting
with the **Maharaj Bada / Lashkar** Area of Interest (4.434 km²).

![Digital Twin 3D](docs/screenshots/digital-twin-3d.png)

## Repository layout

| Path | Contents |
|------|----------|
| `citypulse-ai/` | React + Vite + TypeScript frontend (Leaflet 2D, CesiumJS 3D) |
| `citypulse-ai-backend/` | FastAPI backend, ingestion pipeline, validation, tests |
| `docs/screenshots/` | Screenshots captured from the running application |
| `citypulse-ai-DEVELOPMENT_STATUS.md` | Verified status, gaps and next priorities |

## What currently works (verified 13 Nov 2026)

- Real OpenStreetMap data ingested into PostgreSQL/PostGIS for the AOI:
  **862 road segments, 127 buildings, 25 facilities, 5 green spaces**, with zero
  invalid geometries and all spatial indexes in place.
- A FastAPI service that returns real GeoJSON for those layers.
- A Digital Twin that renders that geometry in 2D (Leaflet) and 3D (CesiumJS,
  extruded buildings), with layer toggles and a feature inspector.
- **Environmental intelligence** from Copernicus CAMS (air quality) and ERA5/IFS
  (temperature) via Open-Meteo: **984 stored observations** (960 hourly pollutant
  rows, 24 daily temperature rows), every value labelled *modelled* with its
  dataset, timestamp and WHO guideline comparison. Land-surface temperature and
  NDVI are reported as unavailable rather than estimated.
- **Civic issue reporting**: real PostGIS-backed submissions with map placement,
  six categories, severity, moderation transitions, 60 m / 30-day duplicate
  linkage and DBSCAN hotspot analysis. No demonstration rows are shipped.
- **AI Analyst** that answers from SQL over those datasets, cites dataset and
  observation date, states uncertainty and refuses questions it cannot answer
  from stored data.
- **Scenario Lab** grounded in the real baseline (AOI area, mapped green share,
  network length, CAMS PM2.5) with published formulas and an assumption-based,
  clearly labelled air-quality response.
- Backend tests: 28 passing. Frontend tests: 4 passing. Production build passes.
- AOI boundary investigation documented in `docs/aoi-boundary-investigation.md`;
  data provenance in `docs/data-sources.md`.

## Quick start

```bash
# 1. Start the database (WSL2 Ubuntu, provisioned once)
wsl -d Ubuntu-22.04 -u root -- bash -lc "pg_ctlcluster 14 main start"

# 2. Backend
cd citypulse-ai-backend
./.venv/Scripts/python.exe setup_db.py
./.venv/Scripts/python.exe ingest_aoi.py
./.venv/Scripts/python.exe -m uvicorn app:app --port 8000

# 3. Frontend (separate terminal)
cd citypulse-ai
npm install
npm run dev        # http://localhost:5173
```

Detailed instructions, environment notes and troubleshooting are in
`citypulse-ai-backend/README.md` and `citypulse-ai/README.md`.

## Data

OpenStreetMap via the OpenStreetMap France PBF extract
(© OpenStreetMap contributors, ODbL 1.0). Geometry is stored in EPSG:4326 and
measured in EPSG:32644.

Air quality (CAMS global, ~40 km) and temperature (ERA5/IFS, ~9–11 km) come from
Open-Meteo and are **modelled fields sampled at the AOI centroid** — not local
station readings. Green cover is derived from mapped OSM polygons and is a lower
bound. No synthetic value is presented as a measurement; illustrative building
heights and scenario outputs are labelled as such. Full provenance, units,
resolution and limitations: `docs/data-sources.md`.

## Screenshots

| Page | Image |
|------|-------|
| Digital Twin (3D) | `docs/screenshots/digital-twin-3d.png` |
| Environment | `docs/screenshots/environment.png` |
| Civic Issues | `docs/screenshots/civic-issues.png` |
| AI Analyst | `docs/screenshots/ai-analyst.png` |
| Scenario Lab | `docs/screenshots/scenario-lab.png` |

## Known gaps

- No local air-quality or traffic sensor feed: environmental values are modelled
  grid fields, and no traffic volumes exist at all.
- No NDVI, land-surface temperature or thermal imagery product is configured.
- The AOI is still a documented rectangle: no authoritative Maharaj Bada/Lashkar
  polygon was found (see `docs/aoi-boundary-investigation.md`).
- No ML models are trained; the Scenario Lab is arithmetic with stated assumptions.
- The civic database intentionally ships empty — reports only exist once someone
  submits them. See `citypulse-ai-DEVELOPMENT_STATUS.md` for the full list.
