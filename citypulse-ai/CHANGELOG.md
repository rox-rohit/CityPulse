# CityPulse AI — CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Conventional Commits](https://conventionalcommits.org/).

## [Unreleased]

### Added
- **LandingPage**: Hero section, capabilities grid, CTA, features with icons
- **DigitalTwin**: Leaflet map with OSM tile layer, layer controls, data guidance when no layers loaded, responsive design
- **Traffic**: Network overview, congestion analysis, risk & accessibility assessment, mode tabs (network/congestion/risk), selected-road detail panel
- **Environment**: PM2.5, urban heat island, green cover indicators with units/dates/source/notes, detail panel on click
- **Civic Issues**: Status filters (all/pending/in-progress/resolved), severity badges (high/medium/low), detail panel, status counts
- **Scenario Lab**: Three simulations (green cover increase, road closure, tree planting) grounded in Maharaj Bada AOI with assumptions, methodology, limitations
- **AI Analyst**: Natural language interface with 5 categories (civic, traffic, environment, green cover, compare) + grounded responses + data provenance + "cannot answer" fallback
- **Methodology**: Objectives, data sources, collection methods, cleaning, methodology, limitations, roadmap
- **Navigation**: Sticky top bar with branding, responsive mobile menu, skip links for accessibility
- **DashboardLayout**: Main layout with sidebar, skip-nav area, focus-managed main content
- **Design System**: Tailwind CSS with dark-first tokens (navy #0B1020, cyan #39D5FF, teal #35D6B4, violet #8B7CFF), Inter font, responsive utilities
- **AOI Boundary**: `static/aoi-maharaj-bada.geojson` — configurable polygon (~1.5–2 km radius)
- **Backend**: FastAPI with CORS, Pydantic models, API endpoints (/health, /layers, /metadata/{layer_name}, /ingest, /)
- **Docker Compose**: PostgreSQL 16 + PostGIS + pgAdmin service configuration
- **Ingestion Pipeline**: `ingest_aoi.py` — OSMnx roads/buildings/facilities with geometry validation, CRS transform, duplicate removal, spatial indexes, metadata recording
- **Database Schema**: GeographicLayer, DatasetMetadata models with validation_status, crss, spatial_index fields
- **Accessibility**: Skip links, ARIA labels, focus-visible styles, keyboard navigation support, reduced motion media query
- **Quality Audit**: Comprehensive audit with 11 category scores documented in DEVELOPMENT_STATUS.md
- **Conventional Commits**: Commit message specification for all changes

### Changed
- **tailwind.config.cjs**: Updated color palette, added Inter font family, refined dark-first token system
- **postcss.config.js**: Configured Tailwind + Autoprefixer, added responsive utilities
- **App.tsx**: Updated router with 7 routes, added error boundary support
- **DEVELOPMENT_STATUS.md**: Written with full audit, quality scores, milestone status, and next priorities

### Fixed
- Color contrast ratios verified against WCAG AA for dark-first palette
- Focus-visible styles applied consistently across all interactive elements
- Skip links added to Navigation and DashboardLayout for screen reader navigation
- All pages have loading, error, and empty states
- No fake statistics or fabricated results on any page
- All environmental indicators have explicit units, dates, sources, and limitations
- All AI Analyst responses cite data provenance and limitations
- All traffic data clearly disclaimed as static OSM network geometry (not live traffic)
- All scenario simulations explicitly marked as model-estimated with documented assumptions

### Deprecated
- None (initial release)

### Removed
- None (initial release)

---

## [0.1.0] — 2026-11-13

### Added
- Initial project foundation
- Git repository initialized; project structure established with `citypulse-ai/` (frontend) and `citypulse-ai-backend/` (backend)
- 8 frontend pages built and structured: LandingPage, DigitalTwin, Traffic, Environment, CivicIssues, ScenarioLab, AIAnalyst, Methodology
- Design system: Tailwind CSS configured with dark-first tokens, Inter font, responsive utilities
- Backend FastAPI app with database models (GeographicLayer, DatasetMetadata), API endpoints (/health, /layers, /metadata/{layer_name}, /ingest, /)
- AOI boundary GeoJSON created: `citypulse-ai/static/aoi-maharaj-bada.geojson` (~1.5–2 km radius polygon)
- Ingestion pipeline built: `citypulse-ai-backend/ingest_aoi.py` — OSMnx-based roads, buildings, facilities ingestion with geometry validation, CRS transform to EPSG:4326, duplicate removal, spatial index creation (GIST indexes), metadata recording
- Docker Compose configured: `citypulse-ai-backend/docker-compose.yml` for PostgreSQL 16 + PostGIS + pgAdmin
- DEVELOPMENT_STATUS.md written with full audit, quality scores, milestone status, and next priorities
- All pages have loading, error, and empty states; no fake statistics or fabricated results
- Navigation: sticky top bar, sidebar (desktop), responsive mobile menu; consistent across all pages

---

## Subsequent Versions (Pending PostgreSQL Data Ingestion)

### [0.2.0] — Pending
- Execute ingestion pipeline: `python ingest_aoi.py`
- Verify data in pgAdmin: roads (~150–300 edges), buildings (~500–800 footprints), facilities (~30–50 points)
- Refresh Digital Twin — displays actual OSM data clipped to AOI boundary
- Commit: `git add . && git commit -m "feat: load Maharaj Bada AOI data — roads, buildings, facilities via OSMnx"`
- Continue to Digital Twin Level 2 enhancements: 2.5D building extrusion (CesiumJS), thematic overlays, search functionality, selection/inspection panels
- Refine urban intelligence pages (Traffic, Environment, Civic Issues) with real data from database
- Execute next milestone per roadmap: Milestone 2 continuation or Milestone 4 refinement

---

*This project follows Conventional Commits. See commit messages for detailed change history.*