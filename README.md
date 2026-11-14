# CityPulse AI

**Understand Your City. Anticipate Its Future.**

An urban analytics and digital-twin platform for **Maharaj Bada / Lashkar, Gwalior
(4.434 km²)**, built on real geospatial data. Every number it shows is labelled by
how it was produced — measured, modelled, derived or simulated — and gaps are
shown as gaps rather than filled with invented values.

![Landing page](docs/screenshots/landing.png)

---

## Features

| Module | What it does | Data type |
|--------|--------------|-----------|
| **Digital Twin** | 862 road segments, 127 buildings, 25 facilities and 5 green spaces from OpenStreetMap, in 2D (Leaflet), 3D (CesiumJS with imagery) and a Virtual City (holographic Cesium, no imagery) where simulated interventions update the scene and a running impact panel | measured geometry; simulated effects |
| **Traffic / Road Network** | Network length by highway class, named-segment share, attribute completeness. Explicitly reports that no traffic volumes exist | measured geometry |
| **Environmental Intelligence** | CAMS air quality and ERA5/IFS temperature with WHO 2021 comparison, OSM-derived green cover, and CPCB station metadata with distance to the AOI | modelled + observed, kept separate |
| **Civic Issues** | Report six issue categories on the map, duplicate linkage (60 m / 30 days), moderation state machine, DBSCAN hotspots | citizen-reported, unverified |
| **AI Analyst** | Natural-language questions answered by parameterised SQL over the stored datasets, with sources, observation dates and stated uncertainty; refuses what it cannot support | SQL over stored data |
| **Scenario Lab** | Green-space and road-closure scenarios from real baselines, with the formula, assumption and uncertainty printed beside each simulated result | simulated |
| **Methodology** | Architecture, database design, geographic methods, formulas, provenance, reproducibility and limitations | documentation |

## Screenshots

| Page | Capture |
|------|---------|
| Digital Twin (3D) | ![Digital Twin 3D](docs/screenshots/digital-twin-3d.png) |
| Digital Twin (2D) | ![Digital Twin 2D](docs/screenshots/digital-twin-2d.png) |
| Environment | ![Environment](docs/screenshots/environment.png) |
| Traffic | ![Traffic](docs/screenshots/traffic.png) |
| Civic Issues | ![Civic Issues](docs/screenshots/civic-issues.png) |
| Scenario Lab | ![Scenario Lab](docs/screenshots/scenario-lab.png) |
| AI Analyst | ![AI Analyst](docs/screenshots/ai-analyst.png) |
| Methodology | ![Methodology](docs/screenshots/methodology.png) |

All captures are from the running application at 1440 × 900.

## Technology stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS (HSL design tokens, dark-first) |
| Maps | Leaflet + react-leaflet (2D), CesiumJS lazy-loaded (3D) |
| Backend | FastAPI, SQLAlchemy 2, Pydantic |
| Database | PostgreSQL 14 + PostGIS 3.2 (geometry in EPSG:4326, measures in EPSG:32644) |
| Data | OpenStreetMap PBF extract, Copernicus CAMS, ERA5/IFS via Open-Meteo, CPCB CAAQMS |
| Tests | pytest (API + PostGIS), Vitest |

## Architecture

```
OSM PBF extract ─┐
Open-Meteo CAMS ─┼─► ingestion (Python) ─► PostgreSQL 14 + PostGIS 3.2
CPCB CAAQMS ─────┘                              │
                                                ▼
                                        FastAPI (SQLAlchemy)
                                                │  /api/*
                                                ▼
                              React 18 + Vite (Leaflet 2D, CesiumJS 3D)
```

Observed and modelled air quality live in **separate tables**
(`air_quality_observations` vs `environmental_observations`) so they cannot be
accidentally aggregated into one misleading metric.

## Repository layout

| Path | Contents |
|------|----------|
| `citypulse-ai/` | React frontend |
| `citypulse-ai-backend/` | FastAPI service, ingestion, validation, tests |
| `docs/` | Data sources, AOI investigation, screenshots |
| `citypulse-ai-DEVELOPMENT_STATUS.md` | Verified status and known gaps |

## Installation (Windows 11 + WSL2)

Verified with Python 3.12, Node 24, PostgreSQL 14 + PostGIS 3.2 in WSL2 Ubuntu 22.04.

### 1. Database

```bash
wsl -d Ubuntu-22.04 -u root -- bash -lc "pg_ctlcluster 14 main start; pg_isready"
# keep the distro (and its localhost forward) alive while developing
wsl -d Ubuntu-22.04 -u root -- bash -lc "setsid nohup sleep 100000000 </dev/null >/dev/null 2>&1 &"
```

Provision once with `citypulse-ai-backend/scripts/setup_postgis_wsl.sh`, or use the
provided `docker-compose.yml` where Docker is available.

Connection string (override with `DATABASE_URL`):
`postgresql+psycopg2://citypulse:citypulse_password@localhost:5432/citypulse`

### 2. Backend

```bash
cd citypulse-ai-backend
python3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
cp .env.example .env            # adjust DATABASE_URL / CORS_ORIGINS if needed

./.venv/Scripts/python.exe setup_db.py          # extensions, tables, GiST indexes
./.venv/Scripts/python.exe ingest_aoi.py        # download PBF if needed, clip to AOI
./.venv/Scripts/python.exe environment_ingest.py  # CAMS + ERA5 (modelled)
./.venv/Scripts/python.exe station_ingest.py    # CPCB stations (needs XKDR key for readings)
./.venv/Scripts/python.exe validate_data.py     # JSON validation report

./.venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

### 3. Frontend

```bash
cd citypulse-ai
npm install
npm run dev        # http://localhost:5173  (proxies /api → 127.0.0.1:8000)
```

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL + PostGIS connection string |
| `CORS_ORIGINS` | no | Comma-separated browser origins; defaults to local dev ports. Set to your deployed frontend origin in production |
| `XKDR_AQI_KEY` | no | XKDR India Air Quality API key for CPCB station observations. Without it the app runs and reports observed data as unavailable |
| `AOI_GEOJSON` | no | Alternative AOI polygon for ingestion |
| `OSM_EXTRACT_URL` / `OSM_EXTRACT` | no | Override the OSM PBF source |

Never commit `.env`. Rotate the XKDR key if it is exposed.

## API

Interactive docs at `http://127.0.0.1:8000/docs`.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Database + PostGIS status |
| `GET /api/summary` | AOI extent and per-layer counts |
| `GET /api/layers` | Registered layers with provenance |
| `GET /api/layers/{layer}/geojson` | GeoJSON (`limit`, `tolerance`, `bbox`) |
| `GET /api/aoi` | AOI boundary polygon |
| `GET /api/metadata/{layer}` | Licence, resolution, processing history, limitations |
| `GET /api/analytics/network` | Road length by class (no traffic data) |
| `GET /api/analytics/green-cover` | Mapped green area as a share of the AOI |
| `GET /api/environment/overview` | Modelled air quality, temperature, green cover, gaps |
| `GET /api/environment/sources` | Provenance for every environmental dataset and station |
| `GET /api/environment/stations` | CPCB stations with `inside_aoi`, distance to the AOI boundary, observation counts |
| `GET /api/environment/observations` | Observed readings for a station/variable; 404 when none exist |
| `POST /api/environment/refresh` | Re-fetch CAMS + ERA5 |
| `GET/POST /api/civic-issues` | List (filters) / create reports |
| `PATCH /api/civic-issues/{id}/status` | Moderation transitions (409 on illegal transitions) |
| `GET /api/civic-issues/stats`, `/hotspots` | Counters and DBSCAN clusters |
| `POST /api/analyst/ask` | Answer a question from stored data |

## Testing

```bash
cd citypulse-ai-backend && ./.venv/Scripts/python.exe -m pytest tests -q   # 33 tests
cd citypulse-ai        && npm test && npm run build                        # 4 tests + production build
```

Backend tests run against the real PostGIS database; civic fixtures are created
with `is_demo=True` and deleted afterwards.

## Data limitations

- **No traffic volumes, speeds or congestion data exist.** The Traffic page reports
  network composition only.
- **Air quality and temperature are modelled grid fields** (CAMS ~40 km, ERA5 ~9–11 km)
  sampled at the AOI centroid, not station measurements.
- **CPCB observations require an API key.** Until readings are retrieved, ground
  observations are reported as unavailable — never estimated.
- **OSM coverage is sparse:** 127 mapped buildings and 25 facilities across 4.4 km²,
  so only 1 building has a real height; the 3D extrusion is otherwise illustrative.
- **The AOI is a documented rectangle**, not a surveyed boundary
  (`docs/aoi-boundary-investigation.md`).
- **No NDVI or land-surface temperature product** is configured; both are shown unavailable.
- **No machine-learning model is trained** — there is no validated local target
  variable. The analyst is deterministic SQL, not a language model.
- Civic reports are unverified self-selections; moderation status is the only
  verification signal.

## Roadmap

1. Retrieve CPCB observations with an XKDR key and chart observed vs modelled series.
2. Add authoritative ward/study-area boundaries so the AOI becomes a real polygon.
3. Introduce a validated ML target (e.g. land-use classification) with spatial/temporal splits.
4. Add traffic counts, even a small manual survey, before any congestion claim.
5. Add Playwright end-to-end tests for reporting, analyst and scenario flows.

## Licences and attribution

© OpenStreetMap contributors, ODbL 1.0 · CAMS and ERA5 © ECMWF/Copernicus, served
by Open-Meteo (CC BY 4.0) · CPCB Central Pollution Control Board, CAAQMS.
Full provenance and limitations: `docs/data-sources.md`.
