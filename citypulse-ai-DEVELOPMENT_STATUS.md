# CityPulse AI — Development Status

**Last verified: 13 November 2026** on the developer's Windows 11 machine.

Everything below was executed and observed. Anything not verified is listed as
pending rather than complete.

## Verified environment

| Item | Value |
|------|-------|
| OS | Windows 11 (build 26300), Git Bash / MSYS |
| Python | 3.15.0 system; **3.12.10 venv** used for the backend |
| Node / npm | 24.21.0 / 11.19.0 |
| Git | 2.56.0, branch `master`, repository had no commits before this session |
| Docker / Docker Compose | **not installed** |
| PostgreSQL / PostGIS (Windows) | **not installed** |
| WSL2 | Ubuntu 22.04.5, PostgreSQL **14.24** + PostGIS **3.2**, database `citypulse` |
| Disk | D: 128 GB free, C: 7 GB free |

## Database

- Provisioned inside WSL2 by `citypulse-ai-backend/scripts/setup_postgis_wsl.sh`
  (role `citypulse`, database `citypulse`, PostGIS enabled, TCP from the Windows
  host allowed, systemd boot enabled).
- WSL2 stops idle distros and drops the localhost port forward, so a keep-alive
  process is used during development (documented in the backend README).

## Ingested data (real, not estimated)

AOI: Maharaj Bada / Lashkar, Gwalior — 78.170–78.190 E, 26.210–26.230 N,
**4.434 km²**, polygon validity checked before ingestion.

Source: `.cache/osm/madhya_pradesh.osm.pbf` (142,175,951 bytes) from the
OpenStreetMap France extract service.

| Layer | Features | Invalid geoms | Outside AOI | Duplicate OSM ids | GiST index |
|-------|----------|---------------|-------------|-------------------|------------|
| roads | 862 | 0 | 0 | 0 | yes |
| buildings | 127 | 0 | 0 | 0 | yes |
| facilities | 25 | 0 | 0 | 0 | yes |
| green_spaces | 5 | 0 | 0 | 0 | yes |

Validation result: **PASSED** (`citypulse-ai-backend/reports/validation-20261113T110241Z.json`).

Bugs found and fixed during this work (the previous scripts could not have run):

1. `setup_db.py` did not parse (unterminated f-string).
2. `ingest_aoi.py` wrote to a table named `" roads_aoi"` (leading space).
3. Buildings were built from a road graph instead of polygon features.
4. Metadata updates targeted a non-existent `aoi_setters` table.
5. Spatial indexes were created before their tables existed.
6. Overpass URL was set to the full `/interpreter` endpoint, producing
   `.../api/interpreter/interpreter` (403/timeouts).
7. multipolygon features have a null `osm_id`; the way id is in `osm_way_id`,
   which collapsed 127 buildings into 1 during deduplication.
8. `postcss.config.js` was CommonJS in an ESM package (build failure).
9. Three JSX syntax errors (invalid template literal, mismatched closing tags).
10. Design tokens were hex values read through `hsl()`, so the whole UI resolved
    to unstyled white.
11. The old `DigitalTwin` used `useMap` outside a map container and imported
    packages that were not installed.

## Application

- Backend API: FastAPI serving real GeoJSON from PostGIS; `/api/health`,
  `/api/summary`, `/api/layers`, `/api/layers/{layer}/geojson`, `/api/aoi`,
  `/api/metadata/{layer}`, `/api/analytics/network`, `/api/analytics/green-cover`.
- Digital Twin 2D: Leaflet + react-leaflet rendering roads, buildings,
  facilities, green spaces and the AOI boundary, with layer toggles, feature
  inspector, loading/error/empty states and a reset view.
- Digital Twin 3D: CesiumJS (lazy-loaded) with Esri World Imagery, extruded
  buildings (OSM height where tagged, otherwise clearly labelled illustrative
  extrusion), road polylines, facility points and the AOI outline.
- Environment: real CAMS/ERA5-modelled values with provenance badges, WHO
  guideline comparison, temperature series, derived green cover and an
  explicit “not available” block (land-surface temperature, NDVI, local PM10).
- Civic Issues: reporting form with click-to-place map, filters, moderation
  controls, duplicate linkage, live statistics and a DBSCAN hotspot overlay.
- AI Analyst: questions classified and answered by SQL over the stored data,
  with dataset, observation date, data type and limitations; refusals for
  unanswerable questions.
- Scenario Lab: real baseline values plus published formulas; the air-quality
  response is an explicitly labelled assumption, and temperature effects are
  not modelled at all.
- Traffic: uses real `/api/analytics/network` statistics (previously simulated).
- All pages now build; previously the build failed.

## Verification actually run

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | pass, 0 errors |
| `npm run build` | pass (`dist/` produced) |
| `pytest tests -q` (backend) | **33 passed** (includes AOI containment/boundary-distance regressions) |
| `vitest run` (frontend) | **4 passed** |
| API responses via curl | health, summary, layers, roads GeoJSON, green-cover all 200 |
| API (milestone 2) via curl | `/api/environment/overview`, `/api/environment/sources`, civic create/duplicate/409-status/hotspots, `/api/analyst/ask` (answered + refused) all behave as designed |
| Browser (Digital Twin 2D) | real geometry rendered, 893 overlay paths, no console errors |
| Browser (Digital Twin 3D) | satellite basemap, AOI outline, roads, buildings, facilities rendered |
| Browser (Environment) | PM2.5/PM10/NO₂ modelled values, WHO comparison, temperature table, Gwalior station cards with AOI containment, explicit "no ground-observed readings" state, sources list |
| Browser (Landing, Methodology) | Rendered with real screenshots and documented limitations; no false ML claims |
| Responsive (390 × 844) | Landing and Environment: no horizontal overflow; mobile nav control present |
| Browser (Civic Issues) | map click set coordinates, report submitted (reference returned), list and counters refreshed, `mark verified` transition applied |
| Browser (AI Analyst) | question answered with facts, source and uncertainty list |
| Browser (Scenario Lab) | baseline read from API, formulas rendered, simulated output recomputed on parameter change |
| Responsive check | 390 × 844 on Scenario Lab and Civic Issues: no horizontal overflow (`scrollWidth ≤ innerWidth`) |
| Console | no errors on the inspected pages (only the pre-existing React Router v7 future-flag warning) |

## Still not done / limitations

1. **No ground-observed reading is stored yet.** The two Gwalior CPCB stations
   are registered with their coordinates and AOI distance, but observation rows
   require an XKDR API key that is not configured. Modelled CAMS/ERA5 values are
   shown separately and are never presented as station measurements.
2. Land-surface temperature, NDVI and local PM10 monitoring are unavailable and
   are shown as unavailable — they are not estimated.
3. No machine-learning models are trained (no validated target variables yet).
4. No traffic volumes, speeds or congestion measurements exist; the Traffic page
   reports network geometry statistics only.
5. OSM coverage in Gwalior is sparse: 127 buildings and 25 facilities in a
   4.4 km² area is far below the real building count, and only 1 of those
   buildings has an OSM height. The 3D extrusion is mostly illustrative.
6. The AOI is a 0.02° × 0.02° rectangle, not a hand-traced boundary; no
   authoritative Maharaj Bada/Lashkar polygon was found in OSM
   (`docs/aoi-boundary-investigation.md`).
7. The civic database ships empty: no citizen reports or demonstration rows are
   preloaded, so the page shows an empty state until someone submits a report.
8. Citizen reports are unverified self-selections; moderation status is the only
   verification signal.
9. Scenario Lab air-quality response rests on a user-set coefficient; no local
   study establishes it.
10. No automated end-to-end (browser) test suite yet; browser checks were manual.
11. No ML prediction, no population model, and the analyst only answers from the
    bundled datasets.

## Next priorities

1. Obtain an XKDR India Air Quality API key and retrieve CPCB observations, then
   chart observed against modelled series.
2. Obtain authoritative ward or study-area boundaries so the AOI can become a
   real polygon.
3. Add a validated ML target (e.g. road-class or land-use classification) with
   time/spatial splits.
4. Add traffic counts, even a small manual survey, to make any congestion claim
   possible.
5. Add an automated browser test (Playwright) for the reporting and analyst flows.
