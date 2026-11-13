# Contributing to CityPulse AI

## Sole contributor

This is a solo project maintained by **Rohit Ahirwar**. All commits must be
authored by him using the email verified on his GitHub account. AI tools are
development assistants and are never added as authors, co-authors or
contributors.

## Setup

See:

- `citypulse-ai/README.md` — frontend and project overview
- `citypulse-ai-backend/README.md` — database, ingestion pipeline and API
- `citypulse-ai-DEVELOPMENT_STATUS.md` — what is actually implemented and verified

## Workflow

1. Create a branch from `master` (`feature/...`, `fix/...`, `docs/...`).
2. Make the change and verify it locally:
   - backend: `./.venv/Scripts/python.exe -m pytest tests -q`
   - frontend: `npm run build` and `npx vitest run`
   - data change: `./.venv/Scripts/python.exe validate_data.py`
3. Stage only the intended files. Never commit `.env`, credentials, virtual
   environments, `node_modules`, build output, the OSM extract or reports.
4. Commit using Conventional Commits, e.g.
   `feat(digital-twin): render ingested road network from PostGIS`.
5. Do not claim features as complete unless they are implemented and verified.

## Data rules

- No invented data, metrics, record counts or model scores.
- Every dataset must record its source, collection date, CRS, spatial resolution
  and known limitations.
- Simulated or illustrative outputs must be labelled as such in both code and UI.
- OpenStreetMap content is © OpenStreetMap contributors, licensed under ODbL 1.0;
  attribution must remain visible in the UI and in API responses.
