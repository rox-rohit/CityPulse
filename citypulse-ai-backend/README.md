# CityPulse AI Backend

FastAPI + PostgreSQL/PostGIS service that serves the ingested OpenStreetMap
geometry for the Maharaj Bada (Lashkar) Area of Interest in Gwalior.

## Verified environment (13 November 2026)

| Component | Where | Version |
|-----------|-------|---------|
| PostgreSQL + PostGIS | WSL2 Ubuntu 22.04 (`citypulse` DB) | 14.24 / PostGIS 3.2 |
| Python | `.venv` (3.12.10) | 3.12 |
| FastAPI / SQLAlchemy / GeoPandas | venv | 0.115+ / 2.1 / 1.2 |
| Node (frontend) | Windows | 24.21 |

Docker is **not** installed on this machine; PostgreSQL runs inside the existing
WSL2 Ubuntu distro instead. `docker-compose.yml` is kept for environments that
do have Docker.

## 1. Start the database

The cluster is provisioned by `scripts/setup_postgis_wsl.sh` (run once, as root
inside WSL). To start it for a work session:

```bash
wsl -d Ubuntu-22.04 -u root -- bash -lc "pg_ctlcluster 14 main start; pg_isready"
```

WSL stops idle distros, which drops the Windows `localhost:5432` forward, so keep
the distro alive while developing:

```bash
wsl -d Ubuntu-22.04 -u root -- bash -lc "setsid nohup sleep 100000000 </dev/null >/dev/null 2>&1 &"
```

Connection string (default in `db_config.py`, override with `DATABASE_URL`):

```
postgresql+psycopg2://citypulse:citypulse_password@localhost:5432/citypulse
```

## 2. Install dependencies

```bash
# Python 3.12 is required: GeoPandas/Shapely have no wheels for Python 3.15
"C:/Users/<you>/AppData/Local/Programs/Python/Python312/python.exe" -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
```

## 3. Create the schema and ingest data

```bash
./.venv/Scripts/python.exe setup_db.py        # extensions, tables, GiST indexes
./.venv/Scripts/python.exe ingest_aoi.py      # download extract if needed, load AOI data
./.venv/Scripts/python.exe validate_data.py   # SQL validation report
```

`ingest_aoi.py` reads a local OSM extract
(`.cache/osm/madhya_pradesh.osm.pbf`, 136 MB, from the OpenStreetMap France
extract service) instead of live Overpass queries, because the public Overpass
endpoints are unreachable or rate limited from this network. The extract is an
unmodified OSM snapshot, filtered with a bounding-box read and clipped to the
AOI polygon.

Flags: `--refresh-extract` re-downloads the newest extract, `--extract PATH`
uses a different `.osm.pbf`.

Every run writes `reports/ingest-<timestamp>.json` with row counts, bounds,
source and CRS; `validate_data.py` writes `reports/validation-<timestamp>.json`.

### Last verified ingestion (13 Nov 2026)

| Layer | Table | Features | Geometry | Invalid | Outside AOI | GiST |
|-------|-------|----------|----------|---------|-------------|------|
| Road network | `roads` | 862 | LineString/MultiLineString | 0 | 0 | yes |
| Building footprints | `buildings` | 127 | Polygon/MultiPolygon | 0 | 0 | yes |
| Important facilities | `facilities` | 25 | Point | 0 | 0 | yes |
| Parks / green spaces | `green_spaces` | 5 | Polygon/MultiPolygon | 0 | 0 | yes |

All geometry is EPSG:4326 with no duplicate OSM ids.

## 4. Run the API

```bash
./.venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Database + PostGIS status |
| `GET /api/summary` | AOI extent and per-layer feature counts |
| `GET /api/layers` | Registered layers with provenance |
| `GET /api/layers/{layer}/geojson` | Real GeoJSON (`limit`, `tolerance`, `bbox`) |
| `GET /api/aoi` | AOI boundary polygon |
| `GET /api/metadata/{layer}` | License, resolution, processing history, limitations |
| `GET /api/analytics/network` | Road length by highway class (no traffic data) |
| `GET /api/analytics/green-cover` | Mapped green area as a share of the AOI |
| `GET /api/environment/overview` | Modelled air quality, temperature, green cover and data gaps |
| `GET /api/environment/sources` | Provenance for every dataset and CPCB station |
| `GET /api/environment/stations` | Stations with `inside_aoi`, distance to the AOI boundary and observation counts |
| `GET /api/environment/observations` | Observed readings per station/variable (404 when none) |
| `POST /api/environment/refresh` | Re-fetch CAMS air quality and ERA5 temperature |
| `GET/POST /api/civic-issues` | List and create civic reports |
| `PATCH /api/civic-issues/{id}/status` | Moderation transitions |
| `GET /api/civic-issues/stats`, `/hotspots` | Counters and DBSCAN clusters |
| `POST /api/analyst/ask` | Answer a question from stored data |

Interactive docs: <http://127.0.0.1:8000/docs>.

### Environmental and station ingestion

```bash
./.venv/Scripts/python.exe environment_ingest.py   # CAMS + ERA5 → environmental_observations
./.venv/Scripts/python.exe station_ingest.py       # CPCB stations → air_quality_observations
```

`station_ingest.py` registers the two Gwalior CAAQMS stations (5273 City Center,
5275 Phool Bagh) and pulls readings through the XKDR India Air Quality API when
`XKDR_AQI_KEY` is set. Without a key it stores nothing and reports observations as
unavailable — it never fabricates readings. Station distance is measured to the
AOI boundary (`ST_Distance` over `geography`), returning 0 km when a station lies
inside the AOI.

## 5. Tests

```bash
./.venv/Scripts/python.exe -m pytest tests -q
```

`tests/test_api.py` exercises the live database through the ASGI app;
`tests/test_ingest_helpers.py` covers tag/height/ID parsing.

## Data provenance

- Source: OpenStreetMap via the OSM PBF extract (© OpenStreetMap contributors, ODbL 1.0)
- CRS: EPSG:4326 (metric calculations use EPSG:32644, UTM zone 44N)
- Heights: `osm:height` where tagged, otherwise `derived:building:levels*3.2 (illustrative)`
- Limitations: static geometry, no live traffic or sensor measurements; OSM coverage in Gwalior is incomplete
