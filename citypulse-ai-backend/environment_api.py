"""Environmental intelligence endpoints.

All values come from `environmental_observations`, populated by
`environment_ingest.py` from Open-Meteo (CAMS / ERA5). Every response states
whether the value is modelled or observed, its dataset and its timestamp, and
lists variables for which no source is available yet.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

import environment_ingest
from db_config import get_engine
from setup_db import ensure_schema
from station_geo import describe_distance, station_aoi_distances

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger("environment-api")

router = APIRouter(prefix="/api/environment", tags=["environment"])
engine = get_engine()

# Sources we deliberately do not have. Reporting these honestly is part of the
# contract with the user: the UI shows an unavailable state instead of a number.
UNAVAILABLE = [
    {
        "variable": "land_surface_temperature",
        "reason": (
            "Requires Landsat/Sentinel-3 thermal imagery and atmospheric correction. "
            "No Earth-observation credentials are configured for this project."
        ),
    },
    {
        "variable": "ndvi",
        "reason": (
            "Requires Sentinel-2 or Landsat surface-reflectance scenes plus cloud masking. "
            "Not configured; green cover is currently derived from mapped OSM polygons instead."
        ),
    },
    {
        "variable": "pm10_local_monitor",
        "reason": (
            "No CPCB/GPCB station feed is connected. The PM values shown are CAMS model "
            "output for the grid cell containing the AOI, not a local instrument reading."
        ),
    },
]

WHO_24H = environment_ingest.WHO_GUIDELINES_24H


def _air_quality() -> dict[str, Any]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT variable,
                       max(unit) AS unit,
                       max(data_type) AS data_type,
                       max(dataset) AS dataset,
                       max(source) AS source,
                       max(observed_at) AS latest_time,
                       (array_agg(value ORDER BY observed_at DESC))[1] AS latest_value,
                       avg(value) FILTER (WHERE observed_at > now() - interval '24 hours') AS mean_24h,
                       min(value) FILTER (WHERE observed_at > now() - interval '24 hours') AS min_24h,
                       max(value) FILTER (WHERE observed_at > now() - interval '24 hours') AS max_24h,
                       count(*) FILTER (WHERE observed_at > now() - interval '24 hours') AS samples_24h,
                       max(fetched_at) AS fetched_at
                FROM environmental_observations
                WHERE granularity = 'hourly'
                GROUP BY variable
                ORDER BY variable
                """
            )
        ).mappings().all()

    pollutants = []
    for row in rows:
        guideline = WHO_24H.get(row["variable"])
        latest = row["latest_value"]
        pollutants.append(
            {
                "variable": row["variable"],
                "unit": row["unit"],
                "latest": round(latest, 1) if latest is not None else None,
                "latest_time": row["latest_time"],
                "mean_24h": round(row["mean_24h"], 1) if row["mean_24h"] is not None else None,
                "min_24h": round(row["min_24h"], 1) if row["min_24h"] is not None else None,
                "max_24h": round(row["max_24h"], 1) if row["max_24h"] is not None else None,
                "samples_24h": row["samples_24h"],
                "data_type": row["data_type"],
                "dataset": row["dataset"],
                "source": row["source"],
                "fetched_at": row["fetched_at"],
                "guideline": guideline,
                "exceeds_guideline": (
                    row["mean_24h"] is not None
                    and guideline is not None
                    and row["mean_24h"] > guideline["value"]
                ),
            }
        )
    return {"pollutants": pollutants, "who_reference": WHO_24H}


def _temperature(days: int = 14) -> dict[str, Any]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT observed_at::date AS day, variable, value, unit, data_type, dataset, source
                FROM environmental_observations
                WHERE granularity = 'daily'
                  AND variable LIKE 'temperature_2m_%'
                  AND observed_at >= now() - (:days || ' days')::interval
                ORDER BY observed_at
                """
            ),
            {"days": days},
        ).mappings().all()

    by_day: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    for row in rows:
        day = row["day"].isoformat()
        entry = by_day.setdefault(day, {"date": day})
        key = row["variable"].replace("temperature_2m_", "")
        entry[key] = round(row["value"], 1) if row["value"] is not None else None
        meta = {
            "unit": row["unit"],
            "data_type": row["data_type"],
            "dataset": row["dataset"],
            "source": row["source"],
        }
    return {"days": sorted(by_day.values(), key=lambda item: item["date"]), **meta}


def _green_cover() -> dict[str, Any]:
    with engine.connect() as conn:
        mapped = conn.execute(text("SELECT COALESCE(sum(area_m2), 0) FROM green_spaces")).scalar() or 0
        aoi_area_km2 = conn.execute(text("SELECT area_km2::float FROM aoi_boundary LIMIT 1")).scalar() or 0
        count = conn.execute(text("SELECT count(*) FROM green_spaces")).scalar() or 0
        largest = conn.execute(
            text(
                "SELECT name, COALESCE(leisure, landuse, natural_type, 'unclassified'), "
                "round((area_m2 / 10000.0)::numeric, 2) FROM green_spaces "
                "WHERE area_m2 IS NOT NULL ORDER BY area_m2 DESC LIMIT 5"
            )
        ).all()
    aoi_m2 = aoi_area_km2 * 1_000_000
    return {
        "mapped_green_area_ha": round(float(mapped) / 10_000, 2),
        "aoi_area_ha": round(aoi_m2 * 0.0001, 2),
        "mapped_share_of_aoi_percent": round(float(mapped) / aoi_m2 * 100, 2) if aoi_m2 else None,
        "polygons": count,
        "largest_areas": [
            {"name": row[0], "category": row[1], "area_ha": float(row[2])} for row in largest
        ],
        "data_type": "derived from mapped OSM land use (lower bound, not a canopy measurement)",
        "source": "OpenStreetMap via OSM PBF extract",
    }


@router.get("/overview", summary="Air quality, temperature, green cover and data gaps")
def overview(days: int = 14) -> dict[str, Any]:
    ensure_schema(engine)
    air = _air_quality()
    temperature = _temperature(days)
    green = _green_cover()

    has_data = bool(air["pollutants"]) or bool(temperature["days"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "available": has_data,
        "air_quality": air,
        "temperature": temperature,
        "green_cover": green,
        "unavailable": UNAVAILABLE,
        "notes": [
            "Air quality and temperature are modelled fields sampled at the AOI centroid; "
            "they are not station measurements.",
            "Green cover counts only explicitly mapped OSM polygons and is therefore a lower bound.",
        ],
    }


@router.get("/sources", summary="Dataset provenance for every environmental variable")
def sources() -> list[dict[str, Any]]:
    ensure_schema(engine)
    base: list[dict[str, Any]] = []
    srows: list[dict[str, Any]] = []
    # Read both datasets and stations inside one connection: reusing a connection
    # after its `with` block closed silently dropped the station entries before.
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, name, provider, source_url, variables, data_type, "
                "temporal_resolution, spatial_resolution, coverage, license, attribution, "
                "known_limitations, last_fetched, record_count FROM environment_datasets "
                "ORDER BY name"
            )
        ).mappings().all()
        base = [dict(row) for row in rows]
        try:
            srows = [
                dict(row)
                for row in conn.execute(
                    text(
                        "SELECT station_id, name, latitude, longitude, operating_agency, "
                        "source, inserted_at FROM stations ORDER BY name"
                    )
                ).mappings().all()
            ]
        except Exception:  # noqa: BLE001
            LOG.warning("Could not read stations table for provenance")

    if srows:
        distances = station_aoi_distances(engine, srows)
        for s in srows:
            geo = distances[s["station_id"]]
            base.append(
                {
                    "id": s["station_id"],
                    "name": s["name"],
                    "provider": s["operating_agency"],
                    "source_url": "https://app.cpcbccr.com/ccr/#/caaqm-dashboard-all/caaqm-landing/aqi-repository?station=" + s["station_id"],
                    "variables": ["pm2_5", "pm10", "no2", "so2", "co", "o3"],
                    "data_type": "observed",
                    "temporal_resolution": "hourly / daily",
                    "spatial_resolution": "point measurement",
                    "coverage": s["name"] + " (" + s["station_id"] + "), Gwalior, MP",
                    "license": "CPCB (Central Pollution Control Board), ODbL-compatible",
                    "attribution": "Central Pollution Control Board – Continuous Ambient Air Quality Monitoring Station",
                    "known_limitations": (
                        "Point measurement at a fixed station, not a city-wide average. "
                        + describe_distance(geo)
                    ),
                    "last_fetched": str(s["inserted_at"]) if s["inserted_at"] else None,
                    "record_count": None,
                    "inside_aoi": geo["inside_aoi"],
                    "distance_km_to_aoi_boundary": geo["distance_km_to_aoi_boundary"],
                }
            )
    return base


@router.get("/stations", summary="List known CAAQMS monitoring stations for Gwalior")
def stations() -> list[dict[str, Any]]:
    ensure_schema(engine)
    with engine.connect() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                text(
                    "SELECT station_id, name, latitude, longitude, operating_agency, "
                    "source, inserted_at FROM stations ORDER BY name"
                )
            ).mappings().all()
        ]

    # Observation availability per station, so the UI can show freshness or an
    # honest empty state instead of implying readings exist.
    with engine.connect() as conn:
        obs_rows = conn.execute(
            text(
                """
                SELECT station_id,
                       count(*)                                        AS observation_count,
                       count(*) FILTER (WHERE value IS NOT NULL)        AS value_count,
                       max(observed_at)                                AS latest_observed_at,
                       array_agg(DISTINCT variable)
                           FILTER (WHERE value IS NOT NULL)            AS variables
                FROM air_quality_observations
                GROUP BY station_id
                """
            )
        ).mappings().all()
    observations = {row["station_id"]: dict(row) for row in obs_rows}

    # Distance to the AOI boundary, from the stored SRID-4326 polygon. A station
    # inside (or on) the AOI gets exactly 0 km; see station_geo.py.
    distances = station_aoi_distances(engine, rows)
    result = []
    for s in rows:
        geo = distances[s["station_id"]]
        obs = observations.get(s["station_id"])
        result.append(
            {
                "station_id": s["station_id"],
                "name": s["name"],
                "latitude": s["latitude"],
                "longitude": s["longitude"],
                "operating_agency": s["operating_agency"],
                "source": s["source"],
                "inside_aoi": geo["inside_aoi"],
                "distance_km_to_aoi_boundary": geo["distance_km_to_aoi_boundary"],
                "distance_km_from_aoi_centroid": geo["distance_km_from_aoi_centroid"],
                "aoi_srid": geo["aoi_srid"],
                "distance_metric": "km to nearest AOI boundary; 0 when inside the AOI",
                # Backwards-compatible alias, now carrying the corrected value.
                "distance_km_from_AOI": geo["distance_km_to_aoi_boundary"],
                "observation_count": int(obs["observation_count"]) if obs else 0,
                "value_count": int(obs["value_count"]) if obs else 0,
                "latest_observed_at": (
                    str(obs["latest_observed_at"])
                    if obs and obs["latest_observed_at"]
                    else None
                ),
                "observed_variables": sorted(obs["variables"]) if obs and obs["variables"] else [],
                "inserted_at": str(s["inserted_at"]) if s["inserted_at"] else None,
            }
        )
    return result


@router.post("/refresh", summary="Fetch the latest observations from Open-Meteo")
def refresh(days: int = 7) -> dict[str, Any]:
    ensure_schema(engine)
    try:
        lon, lat = environment_ingest.aoi_centroid()

        air = environment_ingest.fetch_air_quality(lon, lat, days)
        hourly = air.get("hourly", {})
        units = air.get("hourly_units", {})
        air_rows = [
            {
                "variable": variable,
                "value": float(value),
                "unit": units.get(variable, environment_ingest.AIR_VARIABLES[variable]),
                "observed_at": timestamp,
                "granularity": "hourly",
                "source": "open-meteo-air-quality",
                "dataset": "cams_global",
                "data_type": "modelled",
                "latitude": lat,
                "longitude": lon,
            }
            for variable in environment_ingest.AIR_VARIABLES
            for timestamp, value in zip(hourly.get("time", []), hourly.get(variable, []))
            if value is not None
        ]
        air_count = environment_ingest.store_rows(engine, air_rows)
        environment_ingest.register_dataset(engine, "cams_global", air_count, lat, lon)

        weather = environment_ingest.fetch_temperature(lon, lat, days)
        daily = weather.get("daily", {})
        temp_rows = [
            {
                "variable": variable,
                "value": float(value),
                "unit": "°C",
                "observed_at": date_value,
                "granularity": "daily",
                "source": "open-meteo-weather",
                "dataset": "open_meteo_weather",
                "data_type": "modelled",
                "latitude": lat,
                "longitude": lon,
            }
            for variable in ("temperature_2m_mean", "temperature_2m_max", "temperature_2m_min")
            for date_value, value in zip(daily.get("time", []), daily.get(variable, []))
            if value is not None
        ]
        temp_count = environment_ingest.store_rows(engine, temp_rows)
        environment_ingest.register_dataset(engine, "open_meteo_weather", temp_count, lat, lon)
        return {
            "status": "refreshed",
            "air_quality_rows": air_count,
            "temperature_rows": temp_count,
            "sample_point": {"longitude": lon, "latitude": lat},
        }
    except Exception as exc:  # noqa: BLE001
        LOG.error("Environmental refresh failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Upstream data source unavailable: {exc}") from exc