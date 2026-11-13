# Data sources, provenance and limitations

Every value the platform displays is traceable to one of the datasets below, and
the API returns the same provenance fields (`/api/environment/sources`). Nothing
is presented as a measurement unless it was measured.

## Environmental datasets

### Air quality — CAMS global via Open-Meteo

| Field | Value |
|-------|-------|
| Provider | Copernicus Atmosphere Monitoring Service (CAMS) global, delivered by Open-Meteo |
| URL | https://open-meteo.com/en/docs/air-quality-api |
| Variables | `pm2_5`, `pm10`, `nitrogen_dioxide`, `carbon_monoxide`, `ozone` |
| Type | **modelled** (not a station measurement) |
| Coverage | global; sampled for the AOI centroid (78.178 E, 26.218 N) |
| Resolution | ~40 km grid cell, bilinearly interpolated to the point |
| Temporal resolution | hourly |
| Units | µg/m³ |
| Update frequency | re-fetched on demand (`POST /api/environment/refresh`) |
| Stored | 960 hourly rows for 5 variables over 7 days (13 Nov 2026 run) |
| Licence / attribution | CAMS data © ECMWF/Copernicus, CC BY 4.0; Open-Meteo attribution required |

Limitations: a 40 km model cell cannot resolve street-level concentration;
Gwalior traffic and dust effects are parameterised, not observed. WHO 2021 24-hour
AQG levels (PM2.5 15, PM10 45, NO₂ 25 µg/m³) are compared against the 24-hour mean
and the comparison is shown per pollutant.

### Temperature — Open-Meteo forecast/archive (ERA5 / IFS)

| Field | Value |
|-------|-------|
| Provider | ECMWF ERA5 reanalysis + IFS forecast, via Open-Meteo |
| URL | https://open-meteo.com/en/docs |
| Variables | `temperature_2m_mean`, `temperature_2m_max`, `temperature_2m_min` |
| Type | **modelled** |
| Coverage | AOI centroid |
| Resolution | ~9–11 km reanalysis grid |
| Temporal resolution | daily |
| Units | °C |
| Stored | 24 daily rows (8 days) |
| Licence / attribution | ERA5 © ECMWF/Copernicus (CC BY 4.0); Open-Meteo attribution |

Limitations: 2 m air temperature, not land-surface temperature and not an urban
heat-island measurement. No thermal satellite product is configured.

### Green cover — derived from OpenStreetMap

| Field | Value |
|-------|-------|
| Source | same OSM PBF extract as the geometry layers |
| Type | **derived** (mapped-polygon lower bound) |
| Coverage | inside the AOI rectangle |
| Stored | 5 green-space polygons, 9.4 ha, 2.11 % of the AOI |
| Licence / attribution | © OpenStreetMap contributors, ODbL 1.0 |

Limitations: only explicitly mapped `leisure=park`, `landuse=grass/forest/...`
and `natural=*` polygons are counted. Street trees and unmapped vegetation are
excluded, so this is a lower bound and not a canopy measurement.

## Deliberately unavailable

Reported as unavailable by the API and shown as such in the UI:

| Variable | Why it is unavailable |
|----------|-----------------------|
| Land surface temperature | requires Landsat/Sentinel-3 thermal scenes and atmospheric correction; no Earth-observation credentials configured |
| NDVI | requires Sentinel-2/Landsat surface reflectance plus cloud masking; not configured |
| Local PM10 monitor | no CPCB/GPCB station feed is connected |

## Civic issue data

Reports are user submissions stored in `civic_issues` (PostGIS point geometry).

- Categories: pothole, garbage, drainage, streetlight, water supply, road damage.
- Severity: low / medium / high. Status: reported → verified → in progress → resolved,
  with `rejected` reachable from `reported` and `verified`. Transitions outside
  that graph are refused with HTTP 409.
- Duplicate detection: same category, within 60 m, created in the last 30 days →
  the new report is stored and linked (`duplicate_of`) with a distance in the response.
  It is never silently discarded.
- Hotspots: `ST_ClusterDBSCAN` over EPSG:3857 geometry, default ε = 250 m,
  minimum 2 open reports; centroid, member count, dominant category and
  approximate radius are returned.
- Demonstration rows can only be created by explicitly sending `is_demo: true`;
  no seed script inserts them. They are badged `demo` in the UI, counted
  separately by `/api/civic-issues/stats` and excluded when `include_demo=false`.
- The database currently holds **0** civic rows: the repository ships no
  fabricated reports, and the reports created during testing were deleted.

Limitations: citizen reports are self-selected and unverified; they are not a
municipal work register. Coordinates come from where the reporter clicked, which
carries tens of metres of imprecision.

## Analyst policy

`POST /api/analyst/ask` classifies the question against the datasets above and
answers with SQL over the database. Each answer carries the dataset, the
observation date, whether values are modelled/reported/derived, and explicit
limitations. Questions outside the datasets (for example population projections)
return a refusal with `intent: null` and no facts. There is no language model
involved and no hardcoded per-question answer text.
