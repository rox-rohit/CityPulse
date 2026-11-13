"""Create the CityPulse AI PostGIS schema (idempotent).

Run after PostgreSQL + PostGIS is running:

    python setup_db.py
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from db_config import DATABASE_URL, get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("setup_db")

# ---------------------------------------------------------------------------
# Schema. Geometry columns are untyped `Geometry` because OSM features mix
# LineString/MultiLineString and Polygon/MultiPolygon within a single layer.
# ---------------------------------------------------------------------------
STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS postgis",
    """
    CREATE TABLE IF NOT EXISTS geographic_layers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        table_name TEXT NOT NULL,
        description TEXT,
        source TEXT NOT NULL,
        collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        coordinate_reference_system TEXT NOT NULL DEFAULT 'EPSG:4326',
        validation_status TEXT NOT NULL DEFAULT 'pending',
        data_freshness TEXT,
        geometry_type TEXT NOT NULL,
        bounds JSONB,
        row_count INTEGER,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS dataset_metadata (
        id TEXT PRIMARY KEY,
        layer_name TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        source_url TEXT,
        license TEXT,
        collection_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
        spatial_resolution TEXT,
        geographic_coverage TEXT,
        processing_history JSONB NOT NULL DEFAULT '{}'::jsonb,
        known_limitations TEXT,
        feature_count INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS roads (
        id SERIAL PRIMARY KEY,
        osm_id TEXT,
        name TEXT,
        highway TEXT,
        ref TEXT,
        oneway BOOLEAN,
        bridge BOOLEAN,
        tunnel BOOLEAN,
        lanes TEXT,
        maxspeed TEXT,
        surface TEXT,
        length_m DOUBLE PRECISION,
        geometry geometry(Geometry, 4326)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS buildings (
        id SERIAL PRIMARY KEY,
        osm_id TEXT,
        name TEXT,
        building TEXT,
        levels INTEGER,
        height_m DOUBLE PRECISION,
        height_source TEXT,
        addr_street TEXT,
        addr_housenumber TEXT,
        geometry geometry(Geometry, 4326)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS facilities (
        id SERIAL PRIMARY KEY,
        osm_id TEXT,
        name TEXT,
        amenity TEXT,
        healthcare TEXT,
        shop TEXT,
        geometry geometry(Geometry, 4326)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS green_spaces (
        id SERIAL PRIMARY KEY,
        osm_id TEXT,
        name TEXT,
        leisure TEXT,
        landuse TEXT,
        natural_type TEXT,
        area_m2 DOUBLE PRECISION,
        geometry geometry(Geometry, 4326)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS aoi_boundary (
        id TEXT PRIMARY KEY,
        name TEXT,
        city TEXT,
        state TEXT,
        area_km2 DOUBLE PRECISION,
        geometry geometry(Polygon, 4326)
    )
    """,
    # Spatial indexes (GiST) for every geometry column.
    "CREATE INDEX IF NOT EXISTS idx_roads_geom ON roads USING GIST (geometry)",
    "CREATE INDEX IF NOT EXISTS idx_buildings_geom ON buildings USING GIST (geometry)",
    "CREATE INDEX IF NOT EXISTS idx_facilities_geom ON facilities USING GIST (geometry)",
    "CREATE INDEX IF NOT EXISTS idx_green_spaces_geom ON green_spaces USING GIST (geometry)",
    "CREATE INDEX IF NOT EXISTS idx_aoi_boundary_geom ON aoi_boundary USING GIST (geometry)",
    # Attribute indexes used by the API and analytics.
    "CREATE INDEX IF NOT EXISTS idx_roads_osm_id ON roads (osm_id)",
    "CREATE INDEX IF NOT EXISTS idx_roads_highway ON roads (highway)",
    "CREATE INDEX IF NOT EXISTS idx_buildings_osm_id ON buildings (osm_id)",
    "CREATE INDEX IF NOT EXISTS idx_facilities_osm_id ON facilities (osm_id)",
    "CREATE INDEX IF NOT EXISTS idx_facilities_amenity ON facilities (amenity)",
    "CREATE INDEX IF NOT EXISTS idx_green_spaces_osm_id ON green_spaces (osm_id)",
]


def ensure_schema(engine) -> None:
    """Create extensions, tables and indexes. Safe to call repeatedly."""
    with engine.begin() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))


def main() -> None:
    LOG.info("Connecting to %s", DATABASE_URL.replace(DATABASE_URL.split("@")[0], "postgresql+psycopg2://<credentials>"))
    engine = get_engine()
    ensure_schema(engine)
    with engine.connect() as conn:
        version = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        tables = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' ORDER BY table_name"
                )
            )
        ]
    LOG.info("PostGIS version: %s", version)
    LOG.info("Tables: %s", ", ".join(tables))
    LOG.info("Schema is up to date.")


if __name__ == "__main__":
    main()
