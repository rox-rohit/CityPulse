"""CityPulse AI - Maharaj Bada AOI ingestion pipeline.

Reads OpenStreetMap data for the Maharaj Bada / Lashkar study area in Gwalior
from a local OSM PBF extract (downloaded from the OpenStreetMap France
extract service), clips it to the AOI polygon, validates and repairs geometry,
and loads it into PostgreSQL/PostGIS with provenance recorded in
`geographic_layers` and `dataset_metadata`.

A local extract is used instead of live Overpass queries because the public
Overpass endpoints are unreachable or rate limited from this network; the
extract is a full, unmodified OSM snapshot, so no data is invented.

Usage:
    python ingest_aoi.py                  # ingest using the cached extract
    python ingest_aoi.py --refresh-extract  # re-download the newest extract
    python ingest_aoi.py --extract PATH     # use a specific .osm.pbf file
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import requests
import shapely
from shapely.geometry import shape
from sqlalchemy import text

from db_config import (
    AOI_GEOJSON,
    EXTRACT_PATH,
    EXTRACT_URL,
    METRIC_CRS,
    REPORTS_DIR,
    get_engine,
)
from setup_db import ensure_schema

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("ingest")

OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
LICENSE = "Open Database License (ODbL) 1.0"

TAG_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')

FACILITY_AMENITIES = {
    "hospital", "clinic", "doctors", "pharmacy", "school", "college",
    "university", "bank", "atm", "townhall", "marketplace", "police",
    "fire_station", "bus_station", "place_of_worship", "fuel", "library",
}
GREEN_LEISURE = {"park", "garden", "playground", "pitch"}
GREEN_LANDUSE = {"grass", "forest", "recreation_ground", "meadow", "village_green"}
GREEN_NATURAL = {"wood", "scrub", "grassland"}


# ---------------------------------------------------------------------------
# Extract handling
# ---------------------------------------------------------------------------


def ensure_extract(path: Path, refresh: bool = False) -> Path:
    """Return a local .osm.pbf extract, downloading it when required."""
    if path.exists() and not refresh:
        LOG.info("Using cached OSM extract: %s (%.1f MB)",
                 path, path.stat().st_size / 1_048_576)
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    LOG.info("Downloading OSM extract: %s", EXTRACT_URL)
    with requests.get(EXTRACT_URL, stream=True, timeout=300,
                      headers={"User-Agent": "CityPulseAI/0.2 (urban analytics research)"}) as response:
        response.raise_for_status()
        total = int(response.headers.get("Content-Length", 0))
        downloaded = 0
        next_report = 0.0
        with partial.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1 << 20):
                handle.write(chunk)
                downloaded += len(chunk)
                if total:
                    percent = downloaded / total * 100
                    if percent >= next_report:
                        LOG.info("  download %.0f%% (%.1f MB)", percent, downloaded / 1_048_576)
                        next_report = percent + 10
    partial.replace(path)
    LOG.info("Extract saved: %s (%.1f MB)", path, path.stat().st_size / 1_048_576)
    return path


def read_layer(extract: Path, layer: str, bbox: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    """Read one OSM layer restricted to the bounding box."""
    LOG.info("Reading OSM layer '%s' ...", layer)
    started = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        gdf = gpd.read_file(extract, layer=layer, bbox=bbox)
    LOG.info("  %s: %d features in %.1fs", layer, len(gdf), time.time() - started)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def parse_other_tags(value: Any) -> dict[str, str]:
    """Parse GDAL's `other_tags` hstore-style string into a dict."""
    if not isinstance(value, str) or not value:
        return {}
    return {key: val for key, val in TAG_RE.findall(value)}


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------


def scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except (ValueError, AttributeError):
            pass
    return str(value)


def osm_identifier(row: Any) -> str | None:
    """OSM id for a GDAL OSM feature.

    The OSM driver leaves `osm_id` empty for multipolygon features and exposes
    the way/relation id in `osm_way_id` instead, so both are checked.
    """
    for key in ("osm_id", "osm_way_id", "id"):
        value = scalar(row.get(key))
        if value is None or value == "":
            continue
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    return None


def parse_height_m(raw: Any) -> float | None:
    """Parse an OSM `height` tag such as '12', '12.5 m', "40'"."""
    if raw is None:
        return None
    text_value = str(raw).strip().lower().replace(",", ".")
    if not text_value:
        return None
    multiplier = 0.3048 if (text_value.endswith("ft") or text_value.endswith("'")) else 1.0
    text_value = text_value.rstrip("'").replace("ft", "").replace("m", "").strip()
    try:
        value = float(text_value.split(";")[0])
    except ValueError:
        return None
    value *= multiplier
    return round(value, 2) if 1.5 <= value <= 400 else None


def parse_levels(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        levels = int(float(str(raw).split(";")[0]))
    except ValueError:
        return None
    return levels if 1 <= levels <= 120 else None


def flag(value: Any) -> bool | None:
    if value is None:
        return None
    return str(value).lower() not in ("no", "false", "0")


# ---------------------------------------------------------------------------
# AOI
# ---------------------------------------------------------------------------


def load_aoi() -> tuple[gpd.GeoDataFrame, shapely.geometry.base.BaseGeometry, dict]:
    if not AOI_GEOJSON.exists():
        raise FileNotFoundError(f"AOI boundary not found: {AOI_GEOJSON}")

    data = json.loads(AOI_GEOJSON.read_text(encoding="utf-8"))
    features = [
        f for f in data.get("features", [])
        if f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon")
    ]
    if not features:
        raise ValueError("AOI GeoJSON contains no Polygon/MultiPolygon feature")

    feature = features[0]
    polygon = shape(feature["geometry"])
    if not polygon.is_valid:
        LOG.warning("AOI polygon was invalid - repairing with make_valid()")
        polygon = shapely.make_valid(polygon)
    if polygon.is_empty:
        raise ValueError("AOI polygon is empty after validation")

    props = dict(feature.get("properties") or {})
    aoi_gdf = gpd.GeoDataFrame([props], geometry=[polygon], crs="EPSG:4326")
    area_km2 = float(aoi_gdf.to_crs(METRIC_CRS).area.iloc[0] / 1_000_000)
    minx, miny, maxx, maxy = polygon.bounds
    LOG.info("AOI '%s' (%s, %s)", props.get("name", "unnamed"), polygon.geom_type,
             props.get("city", ""))
    LOG.info("AOI bounds: W %.5f S %.5f E %.5f N %.5f | area %.3f km²",
             minx, miny, maxx, maxy, area_km2)
    LOG.info("AOI valid=%s vertices=%d", polygon.is_valid, len(polygon.exterior.coords))
    props["_area_km2"] = area_km2
    return aoi_gdf, polygon, props


# ---------------------------------------------------------------------------
# Cleaning / clipping
# ---------------------------------------------------------------------------


def clip_to_aoi(gdf: gpd.GeoDataFrame, polygon, label: str,
                drop_types: tuple[str, ...] = ()) -> gpd.GeoDataFrame:
    if gdf is None or len(gdf) == 0:
        LOG.warning("%s: no features available", label)
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    total = len(gdf)
    invalid_before = int((~gdf.geometry.is_valid).sum())
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf["geometry"] = gdf.geometry.apply(
        lambda geometry: shapely.make_valid(geometry) if not geometry.is_valid else geometry
    )
    if drop_types:
        gdf = gdf[~gdf.geometry.geom_type.isin(drop_types)].copy()

    intersecting = gdf[gdf.intersects(polygon)].copy()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clipped = intersecting.clip(polygon)
    clipped = clipped[clipped.geometry.notna() & ~clipped.geometry.is_empty].copy()

    if "osm_id" in clipped.columns:
        has_id = clipped["osm_id"].notna()
        with_id = clipped[has_id].drop_duplicates(subset=["osm_id"], keep="first")
        without_id = clipped[~has_id].drop_duplicates(subset=["geometry"], keep="first")
        clipped = gpd.GeoDataFrame(
            pd.concat([with_id, without_id]), geometry="geometry", crs="EPSG:4326"
        )
    else:
        clipped = clipped.drop_duplicates(subset=["geometry"], keep="first")

    LOG.info("%s: %d in extract -> %d intersect AOI -> %d after clip "
             "(invalid repaired: %d)", label, total, len(intersecting),
             len(clipped), invalid_before)
    return clipped


# ---------------------------------------------------------------------------
# Layer builders
# ---------------------------------------------------------------------------


def build_roads(extract: Path, bbox, polygon) -> gpd.GeoDataFrame:
    lines = read_layer(extract, "lines", bbox)
    roads = lines[lines["highway"].notna()].copy()
    LOG.info("roads: %d highway ways in bbox", len(roads))

    records = []
    for _, row in roads.iterrows():
        tags = parse_other_tags(row.get("other_tags"))
        records.append({
            "osm_id": osm_identifier(row),
            "name": scalar(row.get("name")),
            "highway": scalar(row.get("highway")),
            "ref": scalar(row.get("ref")),
            "oneway": flag(tags.get("oneway")),
            "bridge": flag(tags.get("bridge")),
            "tunnel": flag(tags.get("tunnel")),
            "lanes": tags.get("lanes"),
            "maxspeed": tags.get("maxspeed"),
            "surface": tags.get("surface"),
            "geometry": row.geometry,
        })
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    gdf["length_m"] = gdf.to_crs(METRIC_CRS).length.round(1)
    return clip_to_aoi(gdf, polygon, "roads",
                       drop_types=("Point", "Polygon", "MultiPolygon", "GeometryCollection"))


def build_buildings(extract: Path, bbox, polygon) -> gpd.GeoDataFrame:
    polygons = read_layer(extract, "multipolygons", bbox)
    raw = polygons[polygons["building"].notna()].copy()
    LOG.info("buildings: %d tagged building footprints in bbox", len(raw))

    records = []
    for _, row in raw.iterrows():
        tags = parse_other_tags(row.get("other_tags"))
        levels = parse_levels(tags.get("building:levels"))
        height = parse_height_m(tags.get("height"))
        if height is not None:
            height_source = "osm:height"
        elif levels is not None:
            height = round(levels * 3.2, 1)  # illustrative storey height
            height_source = "derived:building:levels*3.2 (illustrative)"
        else:
            height, height_source = None, None
        records.append({
            "osm_id": osm_identifier(row),
            "name": scalar(row.get("name")),
            "building": scalar(row.get("building")),
            "levels": levels,
            "height_m": height,
            "height_source": height_source,
            "addr_street": tags.get("addr:street"),
            "addr_housenumber": tags.get("addr:housenumber"),
            "geometry": row.geometry,
        })
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    return clip_to_aoi(gdf, polygon, "buildings",
                       drop_types=("Point", "LineString", "MultiLineString", "GeometryCollection"))


def build_facilities(extract: Path, bbox, polygon) -> gpd.GeoDataFrame:
    polygons = read_layer(extract, "multipolygons", bbox)
    points = read_layer(extract, "points", bbox)
    records: list[dict[str, Any]] = []

    def collect(row, tags: dict[str, str], geometry) -> None:
        amenity = tags.get("amenity") or scalar(row.get("amenity"))
        healthcare = tags.get("healthcare")
        shop = tags.get("shop") or scalar(row.get("shop"))
        if not any([amenity, healthcare, shop]):
            return
        if amenity and amenity not in FACILITY_AMENITIES:
            return
        records.append({
            "osm_id": osm_identifier(row),
            "name": scalar(row.get("name")),
            "amenity": amenity,
            "healthcare": healthcare,
            "shop": shop,
            "geometry": geometry,
        })

    for _, row in polygons.iterrows():
        collect(row, parse_other_tags(row.get("other_tags")), row.geometry)
    for _, row in points.iterrows():
        collect(row, parse_other_tags(row.get("other_tags")), row.geometry)

    LOG.info("facilities: %d candidate features", len(records))
    if not records:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    polygon_mask = gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])
    if polygon_mask.any():
        centroids = gdf.loc[polygon_mask].to_crs("EPSG:3857").geometry.centroid.to_crs("EPSG:4326")
        gdf.loc[polygon_mask, "geometry"] = centroids
    return clip_to_aoi(gdf, polygon, "facilities",
                       drop_types=("LineString", "MultiLineString", "GeometryCollection"))


def build_green_spaces(extract: Path, bbox, polygon) -> gpd.GeoDataFrame:
    polygons = read_layer(extract, "multipolygons", bbox)
    leisure = polygons["leisure"].isin(GREEN_LEISURE)
    landuse = polygons["landuse"].isin(GREEN_LANDUSE)
    natural = polygons["natural"].isin(GREEN_NATURAL)
    raw = polygons[leisure | landuse | natural].copy()
    LOG.info("green spaces: %d mapped polygons in bbox", len(raw))

    records = []
    for _, row in raw.iterrows():
        records.append({
            "osm_id": osm_identifier(row),
            "name": scalar(row.get("name")),
            "leisure": scalar(row.get("leisure")),
            "landuse": scalar(row.get("landuse")),
            "natural_type": scalar(row.get("natural")),
            "geometry": row.geometry,
        })
    if not records:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    gdf = clip_to_aoi(gdf, polygon, "green spaces",
                      drop_types=("Point", "LineString", "MultiLineString", "GeometryCollection"))
    if len(gdf):
        gdf["area_m2"] = gdf.to_crs(METRIC_CRS).area.round(1)
    return gdf


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

LAYERS = {
    "roads": {
        "name": "Road Network",
        "columns": ["osm_id", "name", "highway", "ref", "oneway", "bridge", "tunnel",
                    "lanes", "maxspeed", "surface", "length_m"],
        "description": "OpenStreetMap road centre-lines clipped to the Maharaj Bada AOI",
        "geometry_type": "LineString / MultiLineString",
        "spatial_resolution": "OSM way geometry (sub-metre vertex precision)",
        "limitations": (
            "Static OSM network geometry, not live traffic. Attribute completeness "
            "(lanes, maxspeed, surface) varies with OSM contributor coverage."
        ),
    },
    "buildings": {
        "name": "Building Footprints",
        "columns": ["osm_id", "name", "building", "levels", "height_m", "height_source",
                    "addr_street", "addr_housenumber"],
        "description": "OpenStreetMap building footprints clipped to the Maharaj Bada AOI",
        "geometry_type": "Polygon / MultiPolygon",
        "spatial_resolution": "OSM building footprint geometry",
        "limitations": (
            "Only buildings mapped in OSM are included, so coverage is incomplete. "
            "Heights exist only where tagged; values derived from building:levels*3.2 "
            "are illustrative and flagged in height_source."
        ),
    },
    "facilities": {
        "name": "Important Facilities",
        "columns": ["osm_id", "name", "amenity", "healthcare", "shop"],
        "description": "Healthcare, education, civic and commercial facilities in the AOI",
        "geometry_type": "Point (centroid of source feature)",
        "spatial_resolution": "Facility location (centroid)",
        "limitations": (
            "Presence in OSM does not guarantee a facility is operating; mapping "
            "completeness varies by category."
        ),
    },
    "green_spaces": {
        "name": "Parks and Green Spaces",
        "columns": ["osm_id", "name", "leisure", "landuse", "natural_type", "area_m2"],
        "description": "Parks, gardens and vegetated areas in the AOI",
        "geometry_type": "Polygon / MultiPolygon",
        "spatial_resolution": "OSM land-use polygon geometry",
        "limitations": (
            "Only explicitly mapped green areas are included; street trees and "
            "unmapped vegetation are absent, so green cover is a lower bound."
        ),
    },
}


def write_features(engine, table: str, columns: list[str], gdf: gpd.GeoDataFrame) -> int:
    if gdf is None or len(gdf) == 0:
        with engine.begin() as conn:
            conn.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY"))
        LOG.warning("%s: 0 rows written", table)
        return 0

    rows = []
    for _, row in gdf.iterrows():
        record = {column: scalar(row.get(column)) for column in columns}
        record["wkt"] = row.geometry.wkt
        rows.append(record)

    column_sql = ", ".join(columns)
    placeholders = ", ".join(f":{c}" for c in columns)
    statement = text(
        f"INSERT INTO {table} ({column_sql}, geometry) "
        f"VALUES ({placeholders}, ST_GeomFromText(:wkt, 4326))"
    )
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY"))
        conn.execute(statement, rows)
    LOG.info("%s: wrote %d rows", table, len(rows))
    return len(rows)


def bounds_of(gdf: gpd.GeoDataFrame) -> dict | None:
    if gdf is None or len(gdf) == 0:
        return None
    minx, miny, maxx, maxy = gdf.total_bounds
    return {
        "min_lon": round(float(minx), 6),
        "min_lat": round(float(miny), 6),
        "max_lon": round(float(maxx), 6),
        "max_lat": round(float(maxy), 6),
    }


def register_layer(engine, table: str, meta: dict, count: int, bounds: dict | None,
                   ingestion_ts: str, extract_name: str) -> None:
    layer_id = table.replace("_", "-")
    coverage = f"Maharaj Bada / Lashkar AOI, Gwalior ({AOI_GEOJSON.name})"
    history = {
        "fetched_at": ingestion_ts,
        "source": "OpenStreetMap extract via OpenStreetMap France (OSM PBF)",
        "extract": extract_name,
        "aoi_file": AOI_GEOJSON.name,
        "clip": "features intersecting and clipped to the AOI polygon",
        "geometry_repair": "shapely.make_valid applied to invalid geometries",
        "deduplication": "osm_id",
        "crs": "EPSG:4326",
        "rows_written": count,
    }
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO geographic_layers
                    (id, name, table_name, description, source, collected_at,
                     coordinate_reference_system, validation_status, data_freshness,
                     geometry_type, bounds, row_count, notes)
                VALUES
                    (:id, :name, :table_name, :description, :source, now(),
                     'EPSG:4326', 'validated', :freshness, :geometry_type,
                     CAST(:bounds AS jsonb), :row_count, :notes)
                ON CONFLICT (name) DO UPDATE SET
                    table_name = EXCLUDED.table_name,
                    description = EXCLUDED.description,
                    source = EXCLUDED.source,
                    collected_at = now(),
                    validation_status = EXCLUDED.validation_status,
                    data_freshness = EXCLUDED.data_freshness,
                    geometry_type = EXCLUDED.geometry_type,
                    bounds = EXCLUDED.bounds,
                    row_count = EXCLUDED.row_count,
                    notes = EXCLUDED.notes
                """
            ),
            {
                "id": layer_id,
                "name": meta["name"],
                "table_name": table,
                "description": meta["description"],
                "source": f"OpenStreetMap via OSM PBF extract - {OSM_ATTRIBUTION}",
                "freshness": ingestion_ts[:10],
                "geometry_type": meta["geometry_type"],
                "bounds": json.dumps(bounds) if bounds else None,
                "row_count": count,
                "notes": f"Ingested {ingestion_ts} from {extract_name}",
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO dataset_metadata
                    (id, layer_name, source, source_url, license, collection_timestamp,
                     spatial_resolution, geographic_coverage, processing_history,
                     known_limitations, feature_count)
                VALUES
                    (:id, :layer_name, :source, :source_url, :license, now(),
                     :spatial_resolution, :coverage, CAST(:history AS jsonb),
                     :limitations, :feature_count)
                ON CONFLICT (layer_name) DO UPDATE SET
                    source = EXCLUDED.source,
                    source_url = EXCLUDED.source_url,
                    license = EXCLUDED.license,
                    collection_timestamp = now(),
                    spatial_resolution = EXCLUDED.spatial_resolution,
                    geographic_coverage = EXCLUDED.geographic_coverage,
                    processing_history = EXCLUDED.processing_history,
                    known_limitations = EXCLUDED.known_limitations,
                    feature_count = EXCLUDED.feature_count
                """
            ),
            {
                "id": f"meta-{layer_id}",
                "layer_name": meta["name"],
                "source": "OpenStreetMap (OSM PBF extract)",
                "source_url": EXTRACT_URL,
                "license": LICENSE,
                "spatial_resolution": meta["spatial_resolution"],
                "coverage": coverage,
                "history": json.dumps(history),
                "limitations": meta["limitations"],
                "feature_count": count,
            },
        )


def write_aoi(engine, polygon, props: dict) -> None:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE aoi_boundary"))
        conn.execute(
            text(
                """
                INSERT INTO aoi_boundary (id, name, city, state, area_km2, geometry)
                VALUES (:id, :name, :city, :state, :area, ST_GeomFromText(:wkt, 4326))
                """
            ),
            {
                "id": "maharaj-bada",
                "name": props.get("name", "Maharaj Bada Study Area"),
                "city": props.get("city", "Gwalior"),
                "state": props.get("state", "Madhya Pradesh"),
                "area": props.get("_area_km2"),
                "wkt": polygon.wkt,
            },
        )


def table_stats(engine, table: str) -> dict:
    with engine.connect() as conn:
        count = conn.execute(text(f"SELECT count(*) FROM {table}")).scalar() or 0
        if count == 0:
            return {"table": table, "features": 0}
        invalid = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE NOT ST_IsValid(geometry)")
        ).scalar() or 0
        srids = [r[0] for r in conn.execute(
            text(f"SELECT DISTINCT ST_SRID(geometry) FROM {table}"))]
        types = dict(conn.execute(
            text(f"SELECT GeometryType(geometry), count(*) FROM {table} GROUP BY 1")
        ).all())
        index_names = [r[0] for r in conn.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": table})]
        size = conn.execute(text(f"SELECT pg_size_pretty(pg_total_relation_size('{table}'))")).scalar()
    return {
        "table": table,
        "features": count,
        "invalid_geometries": invalid,
        "srids": srids,
        "geometry_types": {str(k): v for k, v in types.items()},
        "spatial_index": any("geom" in name for name in index_names),
        "indexes": index_names,
        "total_size": size,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest Maharaj Bada AOI data")
    parser.add_argument("--refresh-extract", action="store_true",
                        help="re-download the OSM extract before ingesting")
    parser.add_argument("--extract", type=Path, default=EXTRACT_PATH,
                        help="path to a local .osm.pbf extract")
    args = parser.parse_args()

    started = time.time()
    ingestion_ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    LOG.info("CityPulse AI ingestion starting at %s", ingestion_ts)

    engine = get_engine()
    ensure_schema(engine)

    aoi_gdf, polygon, props = load_aoi()
    write_aoi(engine, polygon, props)
    minx, miny, maxx, maxy = polygon.bounds
    bbox = (minx, miny, maxx, maxy)

    extract = ensure_extract(args.extract, refresh=args.refresh_extract)

    results: dict[str, int] = {}
    builders = [
        ("roads", build_roads),
        ("buildings", build_buildings),
        ("facilities", build_facilities),
        ("green_spaces", build_green_spaces),
    ]

    for table, builder in builders:
        LOG.info("=== %s ===", table)
        try:
            gdf = builder(extract, bbox, polygon)
        except Exception as exc:  # noqa: BLE001 - keep other layers running
            LOG.exception("%s: ingestion failed: %s", table, exc)
            results[table] = 0
            continue
        meta = LAYERS[table]
        count = write_features(engine, table, meta["columns"], gdf)
        results[table] = count
        register_layer(engine, table, meta, count, bounds_of(gdf), ingestion_ts, extract.name)

    stats = {table: table_stats(engine, table) for table in LAYERS}
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"ingest-{ingestion_ts.replace(':', '')}.json"
    report = {
        "ingestion_timestamp": ingestion_ts,
        "duration_seconds": round(time.time() - started, 1),
        "extract": {"file": extract.name, "bytes": extract.stat().st_size, "source": EXTRACT_URL},
        "aoi": {
            "file": AOI_GEOJSON.name,
            "name": props.get("name"),
            "area_km2": round(props.get("_area_km2", 0.0), 4),
            "bounds": bounds_of(aoi_gdf),
        },
        "source": {
            "osm_attribution": OSM_ATTRIBUTION,
            "license": LICENSE,
            "crs": "EPSG:4326",
        },
        "row_counts": results,
        "table_stats": stats,
    }
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    LOG.info("=" * 62)
    LOG.info("Ingestion complete in %.1fs", time.time() - started)
    for table, count in results.items():
        LOG.info("  %-14s %5d features", table, count)
    LOG.info("Report: %s", report_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
