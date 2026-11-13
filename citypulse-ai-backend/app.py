"""CityPulse AI backend API.

Serves geographic layers stored in PostgreSQL/PostGIS for the Digital Twin
and the analytics pages. All geometry comes from ingested OpenStreetMap data;
nothing here fabricates measurements.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from db_config import get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("api")

# Allowed browser origins come from the environment so a deployment can point at
# its own frontend without editing code. Comma-separated list.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="CityPulse AI API",
    description="Urban analytics backend for the Maharaj Bada AOI, Gwalior",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

engine = get_engine()

# Feature routers. Environmental observations and civic reporting live in their
# own modules so the geographic endpoints stay focused.
from analyst_api import router as analyst_router  # noqa: E402
from civic_api import router as civic_router  # noqa: E402
from environment_api import router as environment_router  # noqa: E402

app.include_router(environment_router)
app.include_router(civic_router)
app.include_router(analyst_router)

OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_identifier(name: str) -> str:
    if not IDENTIFIER_RE.match(name or ""):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {name!r}")
    return name


def _layer(table: str | None = None, key: str | None = None) -> dict[str, Any]:
    """Look up an ingested layer by database table name, id or display name."""
    query = (
        "SELECT id, name, table_name, description, source, collected_at, "
        "geometry_type, row_count, bounds, data_freshness, validation_status, notes "
        "FROM geographic_layers"
    )
    with engine.connect() as conn:
        row = None
        if table:
            row = conn.execute(
                text(query + " WHERE table_name = :v"), {"v": table}
            ).mappings().first()
        if row is None and key:
            row = conn.execute(
                text(query + " WHERE id = :v OR lower(name) = lower(:v)"),
                {"v": key},
            ).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Layer not found or not ingested yet")
        result = dict(row)
        result["bounds"] = result["bounds"] or None
        result["table_name"] = _safe_identifier(result["table_name"])
        return result


def _columns(table: str) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t "
                "AND column_name NOT IN ('id', 'geometry') ORDER BY ordinal_position"
            ),
            {"t": table},
        ).all()
    return [r[0] for r in rows]


def _feature_collection(
    table: str,
    limit: int,
    tolerance: float,
    bbox: str | None = None,
) -> dict[str, Any]:
    table = _safe_identifier(table)
    columns = _columns(table)
    select_props = ", ".join(f'"{c}"' for c in columns)
    geometry_expr = (
        "CASE WHEN ST_IsValid(geometry) THEN geometry ELSE ST_MakeValid(geometry) END"
    )
    if tolerance > 0:
        geometry_expr = f"ST_SimplifyPreserveTopology({geometry_expr}, :tolerance)"

    where = ""
    params: dict[str, Any] = {"limit": limit, "tolerance": tolerance}
    if bbox:
        try:
            minx, miny, maxx, maxy = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bbox must be minLon,minLat,maxLon,maxLat") from exc
        where = "WHERE geometry && ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)"
        params.update({"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy})

    sql = (
        f"SELECT ST_AsGeoJSON({geometry_expr}, 6) AS geojson, {select_props} "
        f"FROM {table} {where} LIMIT :limit"
    )
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()

    features = []
    for row in rows:
        if not row["geojson"]:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(row["geojson"]),
                "properties": {c: row[c] for c in columns},
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "table": table,
            "features_returned": len(features),
            "simplify_tolerance": tolerance,
            "attribution": OSM_ATTRIBUTION,
        },
    }


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------


@app.get("/api/health", tags=["system"])
def health() -> dict[str, Any]:
    try:
        with engine.connect() as conn:
            postgis = conn.execute(text("SELECT PostGIS_Version()")).scalar()
            database = conn.execute(text("SELECT current_database()")).scalar()
            layers = conn.execute(text("SELECT count(*) FROM geographic_layers")).scalar()
        return {
            "status": "healthy",
            "database": database,
            "postgis": postgis,
            "layers_registered": layers,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception as exc:  # noqa: BLE001
        LOG.error("Health check failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}") from exc


@app.get("/api/summary", tags=["system"])
def summary() -> dict[str, Any]:
    """Feature counts and AOI extent, used by the dashboard header."""
    with engine.connect() as conn:
        aoi = conn.execute(
            text(
                "SELECT name, city, state, area_km2::float, "
                "ST_XMin(Box2D(geometry)), ST_YMin(Box2D(geometry)), "
                "ST_XMax(Box2D(geometry)), ST_YMax(Box2D(geometry)) "
                "FROM aoi_boundary LIMIT 1"
            )
        ).first()
        layers = conn.execute(
            text("SELECT table_name, name, row_count FROM geographic_layers ORDER BY name")
        ).all()
    return {
        "aoi": (
            {
                "name": aoi[0], "city": aoi[1], "state": aoi[2], "area_km2": round(aoi[3], 3),
                "bbox": [aoi[4], aoi[5], aoi[6], aoi[7]],
            }
            if aoi else None
        ),
        "layers": [
            {"table": row[0], "name": row[1], "feature_count": row[2]} for row in layers
        ],
        "attribution": OSM_ATTRIBUTION,
    }


# ---------------------------------------------------------------------------
# Geographic data
# ---------------------------------------------------------------------------


@app.get("/api/layers", tags=["geographic"])
def list_layers() -> list[dict[str, Any]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, name, table_name, description, geometry_type, row_count, "
                "bounds, data_freshness, validation_status, source, collected_at "
                "FROM geographic_layers ORDER BY name"
            )
        ).mappings().all()
    return [dict(row) for row in rows]


@app.get("/api/layers/{layer_key}", tags=["geographic"])
def get_layer(layer_key: str) -> dict[str, Any]:
    return _layer(key=layer_key)


@app.get("/api/layers/{layer_key}/geojson", tags=["geographic"])
def layer_geojson(
    layer_key: str,
    limit: int = Query(6000, ge=1, le=20000),
    tolerance: float = Query(0.00002, ge=0, le=0.01),
    bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
) -> dict[str, Any]:
    layer = _layer(key=layer_key)
    collection = _feature_collection(layer["table_name"], limit, tolerance, bbox)
    collection["layer"] = {
        "id": layer["id"],
        "name": layer["name"],
        "table": layer["table_name"],
        "row_count": layer["row_count"],
        "geometry_type": layer["geometry_type"],
        "source": layer["source"],
        "freshness": layer["data_freshness"],
    }
    return collection


@app.get("/api/aoi", tags=["geographic"])
def aoi_boundary() -> dict[str, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT name, city, state, area_km2::float, ST_AsGeoJSON(geometry, 6) "
                "FROM aoi_boundary LIMIT 1"
            )
        ).first()
    if not row:
        raise HTTPException(status_code=404, detail="AOI boundary not ingested yet")
    return {
        "type": "Feature",
        "geometry": json.loads(row[4]),
        "properties": {
            "name": row[0], "city": row[1], "state": row[2],
            "area_km2": round(row[3], 3),
        },
    }


@app.get("/api/metadata/{layer_key}", tags=["geographic"])
def layer_metadata(layer_key: str) -> dict[str, Any]:
    layer = _layer(key=layer_key)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT layer_name AS dataset_name, source, source_url, license, collection_timestamp, "
                "spatial_resolution, geographic_coverage, processing_history, "
                "known_limitations, feature_count FROM dataset_metadata "
                "WHERE layer_name = :name"
            ),
            {"name": layer["name"]},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No dataset metadata recorded for this layer")
    return dict(row)


# ---------------------------------------------------------------------------
# Analytics derived from ingested geometry
# ---------------------------------------------------------------------------


@app.get("/api/analytics/network", tags=["analytics"])
def network_analytics() -> dict[str, Any]:
    """Road-network composition. Descriptive geometry statistics only."""
    with engine.connect() as conn:
        by_class = conn.execute(
            text(
                "SELECT COALESCE(highway, 'unclassified') AS highway_class, count(*) AS segments, "
                "round((sum(length_m) / 1000.0)::numeric, 2) AS length_km "
                "FROM roads GROUP BY 1 ORDER BY length_km DESC NULLS LAST"
            )
        ).all()
        totals = conn.execute(
            text(
                "SELECT count(*), round((COALESCE(sum(length_m), 0) / 1000.0)::numeric, 2), "
                "count(*) FILTER (WHERE name IS NOT NULL) FROM roads"
            )
        ).first()
    return {
        "segments": totals[0],
        "total_length_km": float(totals[1] or 0),
        "named_segments": totals[2],
        "by_class": [
            {"highway_class": r[0], "segments": r[1], "length_km": float(r[2] or 0)}
            for r in by_class
        ],
        "note": (
            "Derived from OpenStreetMap road geometry only. No live traffic, "
            "speed or volume measurements are available."
        ),
    }


@app.get("/api/analytics/green-cover", tags=["analytics"])
def green_cover() -> dict[str, Any]:
    """Mapped green-space area inside the AOI, as a fraction of AOI area."""
    with engine.connect() as conn:
        mapped = conn.execute(
            text("SELECT COALESCE(sum(area_m2), 0) FROM green_spaces")
        ).scalar() or 0
        aoi_area = conn.execute(
            text("SELECT area_km2::float FROM aoi_boundary LIMIT 1")
        ).scalar()
        largest = conn.execute(
            text(
                "SELECT name, COALESCE(leisure, landuse, natural_type, 'unclassified'), "
                "round((area_m2 / 10000.0)::numeric, 2) FROM green_spaces "
                "WHERE area_m2 IS NOT NULL ORDER BY area_m2 DESC LIMIT 5"
            )
        ).all()
    aoi_m2 = (aoi_area or 0) * 1_000_000
    return {
        "mapped_green_area_ha": round(float(mapped) / 10_000, 2),
        "aoi_area_ha": round(aoi_area * 100 if aoi_area else 0, 2),
        "mapped_share_of_aoi_percent": (
            round(float(mapped) / aoi_m2 * 100, 2) if aoi_m2 else None
        ),
        "largest_areas": [
            {"name": r[0], "category": r[1], "area_ha": float(r[2])} for r in largest
        ],
        "note": (
            "Only explicitly mapped OSM parks and vegetated land use are counted. "
            "Street trees and unmapped vegetation are excluded, so this is a lower "
            "bound on green cover, not a complete measurement."
        ),
    }


@app.get("/", tags=["system"])
def root() -> dict[str, Any]:
    return {
        "service": "CityPulse AI API",
        "version": app.version,
        "documentation": "/docs",
        "endpoints": [
            "/api/health", "/api/summary", "/api/layers",
            "/api/layers/{layer}/geojson", "/api/aoi",
            "/api/metadata/{layer}", "/api/analytics/network",
            "/api/analytics/green-cover", "/api/environment/overview",
            "/api/environment/sources", "/api/civic-issues",
            "/api/civic-issues/stats", "/api/civic-issues/hotspots",
            "/api/analyst/ask", "/api/analyst/capabilities",
        ],
    }
