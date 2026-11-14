# Changelog

All notable changes to CityPulse AI. Dates are ISO-8601.

## [0.5.0] - 2026-11-14

### Added
- **Virtual City, a third Digital Twin view.** A holographic Cesium scene built
  from the ingested OSM geometry with no satellite imagery: extruded building
  footprints (residential and generic footprints in a distinct colour), the road
  network, mapped green space and the AOI outline. The 2D and 3D views are kept.
- Schematic 3D objects instead of dots: trees with trunk and canopy, waste
  sites with pile and bin, vehicles, potholes, and a proposed building with its
  60 m assessment radius.
- Intervention controls with live impact arithmetic: trees, waste sites, extra
  vehicles per day, potholes repaired, drains blocked, road-class closure share,
  and a proposed building (storeys and footprint).
- Simulated analytics panel: canopy and green share, projected PM2.5 with its
  CPCB band, road length closed, waste load, repaired and flood-exposed area, a
  composite city-condition index, and a simplified seismic screen of the
  proposed building against its real neighbours.
- `src/lib/simulation.ts` keeps the running estimate pure and unit-tested,
  including PGA attenuation and a logistic fragility curve (20 tests).
- Simple on-screen camera controls (zoom, rotate, top-down, reset) alongside
  drag and wheel, so no extra mouse buttons are needed.

### Notes
- Every effect is simulated. Constants are labelled as assumptions and the panel
  lists what is deliberately not modelled: congestion, pollutant dispersion,
  structural response and code compliance.
- The AOI contains no mapped lake or river in OpenStreetMap (three drain lines
  and a swimming pool only), so no water body is drawn. Drain blockage is
  reported numerically instead.

## [0.4.0] - 2026-11-13

### Added
- **CPCB ground-station integration.** `station_ingest.py` registers the two
  Gwalior CAAQMS stations (5273 City Center, 5275 Phool Bagh) and retrieves
  observations through the XKDR India Air Quality API, storing them in a new
  `air_quality_observations` table keyed by station, variable and timestamp.
  Without `XKDR_AQI_KEY` the module stores nothing and the UI reports observed
  data as unavailable — no reading is ever fabricated.
- `/api/environment/stations` (containment, boundary distance, observation
  counts and freshness), `/api/environment/observations`, and station entries in
  `/api/environment/sources`.
- `station_geo.py`: AOI containment and boundary distance using PostGIS
  `ST_Covers` and `ST_Distance` over `geography`, returning exactly 0 km for
  stations inside the AOI.
- Shared responsive `DashboardLayout` wired into the router: desktop links, a
  mobile menu with active states and a skip link.
- Environment page sections for Gwalior monitoring stations and ground-observed
  readings, with an explicit empty state and freshness per station.
- Landing page rebuilt around real captures, module overview, technology stack,
  data types and stated limitations.
- Methodology page rebuilt: data types, architecture, database design,
  geographic methods, formulas, provenance, reproducibility and limitations.
- Regression tests for stations inside, outside and on the AOI boundary (33
  backend tests total).
- `CORS_ORIGINS` environment variable; `.env.example` documents every variable
  including the optional station API key.

### Changed
- Station distance is now measured to the nearest AOI boundary, not a hardcoded
  centroid. Phool Bagh lies inside the AOI (0 km); City Center is 0.80 km outside.
- `/api/environment/sources` reads stations on a live connection; it previously
  queried a closed one and silently dropped station provenance.
- Landing and Methodology copy no longer claim machine learning, SHAP or
  predictive analytics — none are implemented.

### Fixed
- Removed the unused, syntactically invalid `Navigation.tsx`.
- Environment page no longer renders modelled values under an "observed" heading.

### Known gaps
- CPCB observation rows require an API key; none are stored by default.
- Traffic volumes, NDVI, land-surface temperature and ML models remain unavailable
  and are reported as such.

## [0.3.0] - 2026-11-13

### Added
- Environmental intelligence: `environment_ingest.py` fetches CAMS global air
  quality (PM2.5, PM10, NO₂, CO, O₃, hourly) and ERA5/IFS temperature (daily)
  from Open-Meteo and stores them in `environmental_observations` with source,
  dataset, data type, unit and fetch timestamp. 984 rows ingested for the AOI
  centroid (960 hourly pollutant values, 24 daily temperature values).
- `environment_datasets` provenance table and `/api/environment/sources`;
  `/api/environment/overview` returns air quality, temperature series, derived
  green cover, WHO 2021 24-hour guideline comparisons and an explicit list of
  unavailable variables (land-surface temperature, NDVI, local PM10 monitor).
- `POST /api/environment/refresh` re-fetches both series and records provenance.
- Civic issue reporting on PostGIS: `POST /api/civic-issues` (six categories,
  severity, coordinates, optional reporter), duplicate detection (same category,
  60 m, 30 days) that links instead of discarding, list filters, `/stats`,
  DBSCAN `/hotspots` and a moderated `PATCH /status` state machine that rejects
  illegal transitions with HTTP 409.
- Grounded analyst: `POST /api/analyst/ask` classifies questions and answers with
  SQL over the stored datasets, citing dataset, observation date, data type and
  limitations; unanswerable questions are refused with `intent: null`.
- Rewritten Environment, Civic Issues, AI Analyst and Scenario Lab pages:
  real values with provenance badges, a reporting form with click-to-place map,
  moderation controls, hotspot overlay, cited analyst answers and a Scenario Lab
  whose formulas, baseline dataset and assumptions are printed on the page.
- Backend tests for environment provenance, the civic lifecycle, duplicate
  detection, validation, filters, hotspots and analyst citations/refusals (28
  tests total).
- Documentation: `docs/data-sources.md`, `docs/aoi-boundary-investigation.md`,
  and screenshots for the four rewritten pages.

### Changed
- CORS now allows `PATCH` so the moderation workflow works from the browser.
- Environment, Civic Issues, AI Analyst and Scenario Lab removed their
  “illustrative data” banners because they now read real data.

### Known gaps
- Land-surface temperature, NDVI and local PM10 monitoring remain unavailable and
  are reported as such rather than estimated.
- Traffic volumes are still absent; no congestion figure is produced anywhere.
- The AOI remains a documented rectangle pending an authoritative polygon.

## [0.2.0] - 2026-11-13

### Added
- PostgreSQL 14.24 + PostGIS 3.2 provisioned inside WSL2 Ubuntu 22.04
  (`citypulse-ai-backend/scripts/setup_postgis_wsl.sh`), including the
  `citypulse` role/database, TCP access from the Windows host and GiST indexes.
- Local OpenStreetMap extract ingestion (`ingest_aoi.py`) from the Madhya Pradesh
  OSM PBF extract, with AOI clipping, geometry repair, duplicate removal and
  provenance recorded in `geographic_layers` / `dataset_metadata`.
- Parks and green spaces layer, plus building heights
  (`osm:height`, or `derived:building:levels*3.2 (illustrative)`).
- `validate_data.py`: SQL validation report (counts, invalid geometry, SRID,
  AOI coverage, duplicates, GiST indexes, table sizes).
- Real PostGIS-backed API: `/api/summary`, `/api/layers/{layer}/geojson`,
  `/api/aoi`, `/api/metadata/{layer}`, `/api/analytics/network`,
  `/api/analytics/green-cover`.
- Digital Twin 2D rewrite (react-leaflet) with layer toggles, feature inspector,
  AOI outline, loading/error states and reset view.
- Digital Twin 3D view using CesiumJS with Esri World Imagery and extruded
  buildings, lazy-loaded from the 2D page.
- Backend tests (16) and a frontend API client test suite (4).
- `docs/screenshots/digital-twin-3d.png` evidence capture.

### Fixed
- `setup_db.py` syntax error (unterminated f-string) that prevented any import.
- Ingestion wrote to a table named `" roads_aoi"`; buildings were derived from a
  road graph; metadata updates targeted a non-existent `aoi_setters` table.
- Overpass endpoint double-suffix (`/api/interpreter/interpreter`) causing 403s.
- Multipolygon features lost their ids (`osm_way_id`), collapsing 127 buildings
  into 1 during deduplication.
- `postcss.config.js` was CommonJS inside an ESM package, breaking the build.
- Three JSX syntax errors in Traffic, Environment and CivicIssues.
- Design tokens were hex values consumed through `hsl()`, which made the entire
  UI render unstyled; converted to HSL triplets with alpha support.
- Digital Twin used `useMap` outside `MapContainer` and imported missing packages.

### Verified data
- roads 862, buildings 127, facilities 25, green_spaces 5 inside a 4.434 km² AOI;
  zero invalid geometries, zero features outside the AOI, zero duplicate OSM ids.

### Known gaps
- Traffic, Environment, Civic Issues, Scenario Lab and AI Analyst still use
  simulated data; no ML models are trained; no remote Git remote configured.
