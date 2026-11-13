# AOI boundary investigation (Milestone 2, Phase 5)

**Question:** can the 4.434 km² rectangular study area around Maharaj Bada / Lashkar
be replaced by an authoritative polygon?

**Answer: no — not from the data available to this project.** The rectangle is
retained and remains explicitly labelled as a buffered bounding box. No boundary
was guessed.

## What was checked

| Candidate | Result | Size | Usable as the AOI? |
|-----------|--------|------|--------------------|
| `place` / `landuse` polygon named “Maharaj Bada” | does not exist in OSM | — | no |
| `place` / `boundary` named “Lashkar” | does not exist as an area; “Lashkar” appears only in street and locality names | — | no |
| Gwalior administrative boundary (smallest containing the AOI) | found | ≈ 143 km² | no — 32× the study area |
| Gird Tahsil | found | ≈ 436 km² | no |
| Gwalior district | found | ≈ 4,568 km² | no |
| Madhya Pradesh state | found | — | no |

Queries were run against the same OSM data used for ingestion (the Madhya Pradesh
PBF extract and the Overpass API), searching `boundary=administrative`,
`place=*` and `landuse=*` for the names above plus their Hindi spellings.

## Why not substitute a larger polygon

Gwalior's municipal boundary is a legitimate polygon, but it covers the entire
city. Using it would silently change the meaning of every figure the platform
reports — road length, building count, green share, population of reported
issues — to a city-wide scale while the UI still says “Maharaj Bada”. That is a
worse error than an honestly labelled rectangle.

## Decision

- The AOI stays the documented rectangle: 78.170–78.190 E, 26.210–26.230 N,
  4.434 km², stored in `aoi_boundary` and shown as such in the UI.
- Every derived statistic is reported against that rectangle.
- Nothing in the codebase claims the rectangle is an administrative boundary.

## What would settle it

Any one of these, obtained from an authoritative source, would allow a real polygon:

1. Gwalior Municipal Corporation ward boundaries (GeoJSON/SHP) covering wards that
   contain Maharaj Bada and Lashkar.
2. A Gwalior Smart City / municipal master-plan study-area polygon.
3. A digitised boundary from a published planning document, with the source
   document recorded as provenance.

When such a file is available it should be added as a versioned asset, loaded into
`aoi_boundary` with its source and licence recorded, and every derived number
regenerated — the rectangle must not be hand-edited into a guessed shape.
