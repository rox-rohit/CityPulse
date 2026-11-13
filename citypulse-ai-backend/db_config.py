"""Shared configuration for the CityPulse AI backend.

All database and data-source settings come from environment variables or a
local `.env` file so that no credentials are ever committed to the repository.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "citypulse-ai"

load_dotenv(BACKEND_DIR / ".env")

# Local development default. The citypulse database is provisioned by
# scripts/setup_postgis_wsl.sh (WSL2) or docker-compose.yml.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://citypulse:citypulse_password@localhost:5432/citypulse",
)

# AOI boundary polygon (Maharaj Bada / Lashkar, Gwalior).
AOI_GEOJSON = Path(
    os.getenv("AOI_GEOJSON", str(FRONTEND_DIR / "static" / "aoi-maharaj-bada.geojson"))
)

USER_AGENT = os.getenv("CITYPULSE_USER_AGENT", "CityPulseAI/0.2 (urban analytics research)")
CACHE_DIR = Path(os.getenv("CITYPULSE_CACHE", str(BACKEND_DIR / ".cache")))
REPORTS_DIR = BACKEND_DIR / "reports"

# Local OpenStreetMap extract used by the ingestion pipeline. Public Overpass
# endpoints are unreachable/rate-limited from this network, so a full state
# extract is downloaded once and queried locally (bbox filter).
EXTRACT_URL = os.getenv(
    "OSM_EXTRACT_URL",
    "https://download.openstreetmap.fr/extracts/asia/india/madhya_pradesh-latest.osm.pbf",
)
EXTRACT_PATH = Path(os.getenv("OSM_EXTRACT", str(CACHE_DIR / "osm" / "madhya_pradesh.osm.pbf")))

# Gwalior lies in UTM zone 44N; used for metric length/area calculations.
METRIC_CRS = "EPSG:32644"


def get_engine():
    """Create a SQLAlchemy engine for the configured PostGIS database."""
    return create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
