"""Distance of monitoring stations to the Maharaj Bada AOI.

The AOI is the documented rectangle (longitude 78.170–78.190, latitude
26.210–26.230), stored as an SRID 4326 polygon in `aoi_boundary`. A station's
distance to the AOI is defined as:

* **0 km** when the station lies inside the AOI or exactly on its boundary
  (`ST_Covers`, which includes the boundary), and
* otherwise the distance to the **nearest point of the AOI boundary**,
  measured on the WGS84 ellipsoid (`geography`), returned in kilometres.

This is deliberately *not* the distance to the AOI centroid: a station well
inside the rectangle can be far from the centroid yet still be an on-site
measurement. See `docs/data-sources.md`.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from sqlalchemy import text
from sqlalchemy.engine import Engine

# One statement per station keeps the SRID handling explicit: the station point
# is built as SRID 4326 to match `aoi_boundary.geometry`. Casting both sides to
# `geography` makes ST_Distance return metres on the ellipsoid.
DISTANCE_SQL = text(
    """
    SELECT
        ST_Covers(a.geometry, p.geom)                                AS inside_aoi,
        CASE
            WHEN ST_Covers(a.geometry, p.geom) THEN 0.0
            ELSE ST_Distance(a.geometry::geography, p.geom::geography)
        END                                                          AS boundary_m,
        ST_Distance(ST_Centroid(a.geometry)::geography, p.geom::geography) AS centroid_m,
        ST_SRID(a.geometry)                                          AS aoi_srid
    FROM aoi_boundary a
    CROSS JOIN (
        SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS geom
    ) p
    LIMIT 1
    """
)


def station_aoi_distances(
    engine: Engine,
    stations: Iterable[Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Return per-station AOI containment and boundary distance.

    Keys: ``inside_aoi`` (bool | None), ``distance_km_to_aoi_boundary``
    (float | None), ``distance_km_from_aoi_centroid`` (float | None) and
    ``aoi_srid`` (int | None). A missing AOI yields ``None`` values rather than
    an invented distance.
    """
    result: dict[str, dict[str, Any]] = {}
    with engine.connect() as conn:
        for station in stations:
            row = conn.execute(
                DISTANCE_SQL,
                {"lon": float(station["longitude"]), "lat": float(station["latitude"])},
            ).mappings().first()

            if row is None:  # no AOI geometry stored
                result[station["station_id"]] = {
                    "inside_aoi": None,
                    "distance_km_to_aoi_boundary": None,
                    "distance_km_from_aoi_centroid": None,
                    "aoi_srid": None,
                }
                continue

            inside = bool(row["inside_aoi"])
            boundary_km = float(row["boundary_m"]) / 1000.0
            centroid_km = float(row["centroid_m"]) / 1000.0
            result[station["station_id"]] = {
                "inside_aoi": inside,
                # Exactly 0 when inside or on the boundary — never a small
                # non-zero artefact from projecting a point to the perimeter.
                "distance_km_to_aoi_boundary": 0.0 if inside else round(boundary_km, 3),
                "distance_km_from_aoi_centroid": round(centroid_km, 3),
                "aoi_srid": int(row["aoi_srid"]) if row["aoi_srid"] is not None else None,
            }
    return result


def describe_distance(geo: Mapping[str, Any]) -> str:
    """Human-readable sentence used in API provenance text."""
    if geo.get("inside_aoi") is None:
        return "Station lie relative to the AOI is unknown (no AOI geometry stored)."
    if geo["inside_aoi"]:
        return "Station lies inside the AOI; distance to the AOI boundary is 0 km."
    return (
        f"Station is {geo['distance_km_to_aoi_boundary']:.2f} km outside the AOI, "
        "measured to the nearest AOI boundary."
    )
