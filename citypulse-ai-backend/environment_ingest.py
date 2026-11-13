"""Environmental data ingestion for CityPulse AI.

Sources (no API key required):

* Air quality — Open-Meteo Air Quality API, which serves the CAMS global
  atmospheric composition forecasts. These are **modelled** fields on a
  ~40 km grid, not measurements from a local monitor.
* Temperature — Open-Meteo forecast API (past_days), which blends ERA5/IFS
  reanalysis with forecast output. Also **modelled**, not station observed.

The AOI centroid is sampled as a single point. Values are stored in
`environmental_observations` with the dataset, data type (modelled/observed)
and fetch timestamp so the API and UI can label them honestly.

Usage:
    python environment_ingest.py
    python environment_ingest.py --days 7
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone

import requests
from sqlalchemy import text

from db_config import AOI_GEOJSON, USER_AGENT, get_engine
from setup_db import ensure_schema

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("environment")

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

AIR_VARIABLES = {
    "pm2_5": "µg/m³",
    "pm10": "µg/m³",
    "nitrogen_dioxide": "µg/m³",
    "carbon_monoxide": "µg/m³",
    "ozone": "µg/m³",
}

DATASETS = {
    "cams_global": {
        "name": "CAMS global atmospheric composition (via Open-Meteo)",
        "provider": "Copernicus Atmosphere Monitoring Service / Open-Meteo",
        "source_url": "https://open-meteo.com/en/docs/air-quality-api",
        "variables": list(AIR_VARIABLES),
        "data_type": "modelled",
        "temporal_resolution": "hourly",
        "spatial_resolution": "~40 km grid cell (CAMS global), bilinearly interpolated to the AOI centroid",
        "coverage": "Global",
        "license": "CAMS data: Copernicus licence (open) · Open-Meteo API terms: free for non-commercial use",
        "attribution": "Contains modified Copernicus Atmosphere Monitoring Service information; served by Open-Meteo",
        "known_limitations": (
            "Gridded model output, not a measurement from a Gwalior monitoring station. "
            "Local street-level concentrations (traffic, burning, construction) can differ "
            "substantially from a 40 km grid cell value."
        ),
    },
    "open_meteo_weather": {
        "name": "Open-Meteo temperature (ERA5/IFS blend)",
        "provider": "Open-Meteo (ERA5 reanalysis + IFS forecast)",
        "source_url": "https://open-meteo.com/en/docs",
        "variables": ["temperature_2m_mean", "temperature_2m_max", "temperature_2m_min"],
        "data_type": "modelled",
        "temporal_resolution": "daily",
        "spatial_resolution": "~9-11 km reanalysis grid, interpolated to the AOI centroid",
        "coverage": "Global",
        "license": "CC-BY 4.0 (Open-Meteo); ERA5 © ECMWF/Copernicus",
        "attribution": "ERA5 © ECMWF/Copernicus, served by Open-Meteo",
        "known_limitations": (
            "Air temperature at 2 m from a reanalysis grid. Urban heat island intensity "
            "inside dense built-up areas is not resolved at this resolution."
        ),
    },
}

WHO_GUIDELINES_24H = {
    "pm2_5": {"value": 15.0, "unit": "µg/m³", "reference": "WHO global air quality guidelines (2021), 24-hour AQG level"},
    "pm10": {"value": 45.0, "unit": "µg/m³", "reference": "WHO global air quality guidelines (2021), 24-hour AQG level"},
    "nitrogen_dioxide": {"value": 25.0, "unit": "µg/m³", "reference": "WHO global air quality guidelines (2021), 24-hour AQG level"},
}


def aoi_centroid() -> tuple[float, float]:
    data = json.loads(AOI_GEOJSON.read_text(encoding="utf-8"))
    feature = next(f for f in data["features"] if f["geometry"]["type"] in ("Polygon", "MultiPolygon"))
    ring = feature["geometry"]["coordinates"][0]
    lons = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def fetch_air_quality(lon: float, lat: float, past_days: int) -> dict:
    response = requests.get(
        AIR_QUALITY_URL,
        params={
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "hourly": ",".join(AIR_VARIABLES),
            "past_days": past_days,
            "forecast_days": 1,
            "timezone": "Asia/Kolkata",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def fetch_temperature(lon: float, lat: float, past_days: int) -> dict:
    response = requests.get(
        WEATHER_URL,
        params={
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "daily": "temperature_2m_mean,temperature_2m_max,temperature_2m_min",
            "past_days": past_days,
            "forecast_days": 1,
            "timezone": "Asia/Kolkata",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def store_rows(engine, rows: list[dict]) -> int:
    if not rows:
        return 0
    statement = text(
        """
        INSERT INTO environmental_observations
            (variable, value, unit, observed_at, granularity, source, dataset,
             data_type, latitude, longitude, fetched_at)
        VALUES
            (:variable, :value, :unit, :observed_at, :granularity, :source, :dataset,
             :data_type, :latitude, :longitude, now())
        ON CONFLICT (variable, observed_at, source) DO UPDATE SET
            value = EXCLUDED.value,
            fetched_at = now()
        """
    )
    with engine.begin() as conn:
        conn.execute(statement, rows)
    return len(rows)


def register_dataset(engine, key: str, count: int, latitude: float, longitude: float) -> None:
    meta = DATASETS[key]
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO environment_datasets
                    (id, name, provider, source_url, variables, data_type,
                     temporal_resolution, spatial_resolution, coverage, license,
                     attribution, known_limitations, last_fetched, record_count)
                VALUES
                    (:id, :name, :provider, :source_url, :variables, :data_type,
                     :temporal_resolution, :spatial_resolution, :coverage, :license,
                     :attribution, :limitations, now(), :record_count)
                ON CONFLICT (id) DO UPDATE SET
                    variables = EXCLUDED.variables,
                    last_fetched = now(),
                    record_count = EXCLUDED.record_count
                """
            ),
            {
                "id": key,
                "name": meta["name"],
                "provider": meta["provider"],
                "source_url": meta["source_url"],
                "variables": meta["variables"],
                "data_type": meta["data_type"],
                "temporal_resolution": meta["temporal_resolution"],
                "spatial_resolution": meta["spatial_resolution"],
                "coverage": meta["coverage"],
                "license": meta["license"],
                "attribution": meta["attribution"],
                "limitations": meta["known_limitations"],
                "record_count": count,
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest environmental observations")
    parser.add_argument("--days", type=int, default=7, help="past days of hourly air quality")
    args = parser.parse_args()

    engine = get_engine()
    ensure_schema(engine)
    lon, lat = aoi_centroid()
    LOG.info("Sampling AOI centroid: lon %.5f, lat %.5f", lon, lat)

    air = fetch_air_quality(lon, lat, args.days)
    hourly = air.get("hourly", {})
    times = hourly.get("time", [])
    units = air.get("hourly_units", {})
    air_rows = []
    for variable in AIR_VARIABLES:
        values = hourly.get(variable, [])
        for timestamp, value in zip(times, values):
            if value is None:
                continue
            air_rows.append(
                {
                    "variable": variable,
                    "value": float(value),
                    "unit": units.get(variable, AIR_VARIABLES[variable]),
                    "observed_at": timestamp,
                    "granularity": "hourly",
                    "source": "open-meteo-air-quality",
                    "dataset": "cams_global",
                    "data_type": "modelled",
                    "latitude": lat,
                    "longitude": lon,
                }
            )
    air_count = store_rows(engine, air_rows)
    register_dataset(engine, "cams_global", air_count, lat, lon)
    LOG.info("Air quality: stored %d hourly observations (%s to %s)",
             air_count, times[0] if times else "-", times[-1] if times else "-")

    weather = fetch_temperature(lon, lat, args.days)
    daily = weather.get("daily", {})
    dates = daily.get("time", [])
    temp_rows = []
    for variable in ("temperature_2m_mean", "temperature_2m_max", "temperature_2m_min"):
        for date_value, value in zip(dates, daily.get(variable, [])):
            if value is None:
                continue
            temp_rows.append(
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
            )
    temp_count = store_rows(engine, temp_rows)
    register_dataset(engine, "open_meteo_weather", temp_count, lat, lon)
    LOG.info("Temperature: stored %d daily values (%d days)", temp_count, len(dates))

    with engine.connect() as conn:
        total = conn.execute(text("SELECT count(*) FROM environmental_observations")).scalar()
    LOG.info("Total environmental observations in database: %s", total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
