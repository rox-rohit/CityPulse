"""Validate ingested CityPulse AI data directly in PostGIS.

Run after `python ingest_aoi.py`:

    python validate_data.py

Writes reports/validation-<timestamp>.json and prints a summary.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from db_config import REPORTS_DIR, get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("validate")

LAYER_TABLES = ["roads", "buildings", "facilities", "green_spaces"]

CHECKS = {
    "feature_count": "SELECT count(*) FROM {t}",
    "invalid_geometries": "SELECT count(*) FROM {t} WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)",
    "null_geometries": "SELECT count(*) FROM {t} WHERE geometry IS NULL",
    "distinct_srid": "SELECT count(DISTINCT ST_SRID(geometry)) FROM {t} WHERE geometry IS NOT NULL",
    "features_outside_aoi": (
        "SELECT count(*) FROM {t} t WHERE NOT EXISTS "
        "(SELECT 1 FROM aoi_boundary a WHERE ST_Intersects(t.geometry, a.geometry))"
    ),
    "duplicate_osm_ids": (
        "SELECT COALESCE(sum(c - 1), 0) FROM "
        "(SELECT count(*) AS c FROM {t} WHERE osm_id IS NOT NULL GROUP BY osm_id HAVING count(*) > 1) s"
    ),
}


def check_table(engine, table: str) -> dict:
    result: dict = {"table": table}
    with engine.connect() as conn:
        for name, sql in CHECKS.items():
            result[name] = conn.execute(text(sql.format(t=table))).scalar()
        result["geometry_types"] = {
            str(k): v
            for k, v in conn.execute(
                text(f"SELECT GeometryType(geometry), count(*) FROM {table} "
                     f"WHERE geometry IS NOT NULL GROUP BY 1 ORDER BY 2 DESC")
            ).all()
        }
        result["srids"] = [
            r[0] for r in conn.execute(
                text(f"SELECT DISTINCT ST_SRID(geometry) FROM {table} WHERE geometry IS NOT NULL")
            )
        ]
        result["spatial_indexes"] = [
            r[0] for r in conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE tablename = :t "
                    "AND indexdef ILIKE '%gist%'"
                ),
                {"t": table},
            )
        ]
        result["total_size"] = conn.execute(
            text(f"SELECT pg_size_pretty(pg_total_relation_size('{table}'))")
        ).scalar()
    return result


def main() -> int:
    engine = get_engine()
    timestamp = datetime.now(timezone.utc)
    report: dict = {"generated_at": timestamp.isoformat(timespec="seconds"), "layers": {}}

    with engine.connect() as conn:
        report["postgis_version"] = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        report["database"] = conn.execute(text("SELECT current_database()")).scalar()
        aoi = conn.execute(
            text(
                "SELECT name, city, state, round(area_km2::numeric, 3), "
                "ST_AsGeoJSON(geometry) FROM aoi_boundary LIMIT 1"
            )
        ).first()
        report["aoi"] = (
            {"name": aoi[0], "city": aoi[1], "state": aoi[2], "area_km2": float(aoi[3]),
             "geojson": json.loads(aoi[4])}
            if aoi else None
        )

    failures: list[str] = []
    for table in LAYER_TABLES:
        layer = check_table(engine, table)
        report["layers"][table] = layer
        if layer["feature_count"] == 0:
            failures.append(f"{table}: no features ingested")
        if layer["invalid_geometries"]:
            failures.append(f"{table}: {layer['invalid_geometries']} invalid geometries")
        if layer["null_geometries"]:
            failures.append(f"{table}: {layer['null_geometries']} null geometries")
        if layer["srids"] not in ([4326], []) and layer["srids"] != 4326:
            failures.append(f"{table}: unexpected SRID(s) {layer['srids']}")
        if layer["features_outside_aoi"]:
            failures.append(f"{table}: {layer['features_outside_aoi']} features outside AOI")
        if not layer["spatial_indexes"]:
            failures.append(f"{table}: missing GiST spatial index")

    report["passed"] = not failures
    report["failures"] = failures

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / f"validation-{timestamp.strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    LOG.info("PostGIS: %s", report["postgis_version"])
    for table, layer in report["layers"].items():
        LOG.info(
            "%-13s rows=%-5s invalid=%-3s srid=%-6s outside_aoi=%-3s dup_osm=%-3s gist=%s size=%s",
            table, layer["feature_count"], layer["invalid_geometries"],
            layer["srids"], layer["features_outside_aoi"], layer["duplicate_osm_ids"],
            bool(layer["spatial_indexes"]), layer["total_size"],
        )
    LOG.info("Validation %s -> %s", "PASSED" if report["passed"] else "FAILED", path)
    for failure in failures:
        LOG.error("  %s", failure)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
