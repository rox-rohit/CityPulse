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
- Backend tests: 16 passing. Frontend tests: 4 passing. Production build passes.

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
measured in EPSG:32644. No synthetic values are presented as measurements;
illustrative building heights are labelled as such.

## Known gaps

Traffic, Environment, Civic Issues, Scenario Lab and AI Analyst pages still use
simulated datasets. No ML models are trained. See
`citypulse-ai-DEVELOPMENT_STATUS.md` for the complete list.
