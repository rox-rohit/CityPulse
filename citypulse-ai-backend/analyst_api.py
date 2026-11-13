"""Grounded AI Analyst.

A deterministic question router over the project's own datasets. It does not
generate free text from a language model and never estimates a number: every
figure in a response is read from PostGIS or from the stored environmental
observations, and each answer carries the dataset, its date and its limits.

If a question cannot be answered from available data, the endpoint says so and
lists what it can answer instead.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text

from db_config import get_engine

router = APIRouter(prefix="/api/analyst", tags=["analyst"])
engine = get_engine()

CATEGORY_LABELS = {
    "pothole": "potholes",
    "garbage": "garbage",
    "drainage": "drainage",
    "streetlight": "streetlights",
    "water_supply": "water supply",
    "road_damage": "road damage",
}

INTENTS = {
    "civic": ("civic", "issue", "pothole", "garbage", "drain", "streetlight", "water supply", "complaint", "report"),
    "traffic": ("traffic", "road", "network", "congestion", "highway", "street", "lane", "junction"),
    "air": ("air", "pm2.5", "pm25", "pm10", "pollution", "aqi", "no2", "nitrogen", "ozone", "quality"),
    "temperature": ("temperature", "heat", "hot", "warm", "weather", "celsius", "cooling"),
    "green": ("green", "park", "vegetation", "tree", "canopy", "ndvi", "cover", "garden"),
    "buildings": ("building", "footprint", "height", "floor", "storey", "extrusion"),
    "provenance": ("data", "source", "availability", "limitation", "methodology", "uncertainty", "reliable", "accuracy"),
}


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)


def classify(question: str) -> list[str]:
    lowered = question.lower()
    scored: list[tuple[int, str]] = []
    for intent, keywords in INTENTS.items():
        score = sum(1 for keyword in keywords if re.search(re.escape(keyword), lowered))
        if score:
            scored.append((score, intent))
    scored.sort(reverse=True)
    if not scored:
        return []
    best = scored[0][0]
    return [intent for score, intent in scored if score == best]


def _civic() -> dict[str, Any]:
    with engine.connect() as conn:
        total = conn.execute(text("SELECT count(*) FROM civic_issues")).scalar() or 0
        demo = conn.execute(text("SELECT count(*) FROM civic_issues WHERE is_demo")).scalar() or 0
        by_category = conn.execute(
            text("SELECT category, count(*) FROM civic_issues GROUP BY category ORDER BY count(*) DESC")
        ).all()
        by_status = conn.execute(
            text("SELECT status, count(*) FROM civic_issues GROUP BY status")
        ).all()
        latest = conn.execute(
            text("SELECT max(created_at) FROM civic_issues")
        ).scalar()
        hotspots = conn.execute(
            text(
                """
                WITH clustered AS (
                    SELECT id, ST_ClusterDBSCAN(ST_Transform(geometry, 3857),
                                                eps := 250, minpoints := 2) OVER () AS cluster_id
                    FROM civic_issues
                    WHERE status NOT IN ('resolved','rejected')
                )
                SELECT count(*) AS n, count(DISTINCT cluster_id) AS clusters
                FROM clustered WHERE cluster_id IS NOT NULL
                """
            )
        ).mappings().first()

    if total == 0:
        return {
            "answer": (
                "No civic issues have been reported yet, so there is nothing to summarise. "
                "The reporting form on the Civic Issues page writes directly to the database."
            ),
            "facts": [{"label": "Reports stored", "value": 0}],
            "sources": [
                {
                    "dataset": "citypulse.civic_issues",
                    "type": "citizen-reported",
                    "collected": None,
                    "note": "Table is empty",
                }
            ],
            "limitations": [
                "Citizen reports are self-selected and are not a complete municipal work register.",
            ],
        }

    category_text = ", ".join(
        f"{CATEGORY_LABELS.get(row[0], row[0])}: {row[1]}" for row in by_category
    )
    status_text = ", ".join(f"{row[0]}: {row[1]}" for row in by_status)
    return {
        "answer": (
            f"{total} civic issue report(s) are stored ({total - demo} submitted through the app, "
            f"{demo} flagged as demonstrations). By category — {category_text}. "
            f"By status — {status_text}. "
            + (
                f"{hotspots['n']} open reports fall into {hotspots['clusters']} spatial cluster(s) "
                "at a 250 m / 2-report threshold."
                if hotspots and hotspots["n"]
                else "No open reports currently cluster spatially."
            )
        ),
        "facts": [
            {"label": "Total reports", "value": total},
            {"label": "Real submissions", "value": total - demo},
            {"label": "Demo rows (excluded from analysis)", "value": demo},
            {"label": "Latest report", "value": str(latest) if latest else None},
        ],
        "sources": [
            {
                "dataset": "citypulse.civic_issues",
                "type": "citizen-reported",
                "collected": str(latest) if latest else None,
                "note": "Reporter-submitted records with coordinates and moderation status",
            }
        ],
        "limitations": [
            "Reports reflect who chose to submit them, not the true distribution of defects.",
            "Hotspots use DBSCAN on reported coordinates (250 m, min 2 reports).",
        ],
    }


def _network() -> dict[str, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT count(*), round((sum(length_m)/1000.0)::numeric, 2), "
                "count(*) FILTER (WHERE name IS NOT NULL) FROM roads"
            )
        ).first()
        by_class = conn.execute(
            text(
                "SELECT COALESCE(highway,'unclassified'), count(*), "
                "round((sum(length_m)/1000.0)::numeric, 1) FROM roads "
                "GROUP BY 1 ORDER BY 3 DESC LIMIT 5"
            )
        ).all()
    class_text = ", ".join(f"{row[0]} ({row[1]} segments, {row[2]} km)" for row in by_class)
    return {
        "answer": (
            f"The ingested OSM road network inside the AOI has {row[0]} segments totalling "
            f"{row[1]} km, of which {row[2]} are named. Largest classes: {class_text}. "
            "No traffic volumes, speeds or congestion measurements exist for this network."
        ),
        "facts": [
            {"label": "Segments", "value": row[0]},
            {"label": "Total length (km)", "value": float(row[1] or 0)},
            {"label": "Named segments", "value": row[2]},
        ],
        "sources": [
            {
                "dataset": "citypulse.roads",
                "type": "open geodata",
                "collected": "2026-11-13 (ingestion run)",
                "note": "OpenStreetMap PBF extract, © OpenStreetMap contributors (ODbL)",
            }
        ],
        "limitations": [
            "Static OSM geometry: no live traffic counts, speeds or congestion classes.",
            "OSM attribute completeness (lanes, maxspeed, surface) is partial.",
        ],
    }


def _air() -> dict[str, Any]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT variable, max(unit), max(data_type), max(observed_at), "
                "(array_agg(value ORDER BY observed_at DESC))[1], "
                "avg(value) FILTER (WHERE observed_at > now() - interval '24 hours') "
                "FROM environmental_observations WHERE granularity='hourly' "
                "AND variable IN ('pm2_5','pm10') GROUP BY variable"
            )
        ).all()
        fetched = conn.execute(
            text("SELECT max(fetched_at) FROM environmental_observations WHERE granularity='hourly'")
        ).scalar()
    if not rows:
        return {
            "answer": "No air-quality observations are stored. Run environment_ingest.py to fetch them.",
            "facts": [],
            "sources": [],
            "limitations": ["Environmental ingestion has not run."],
        }
    parts = []
    facts = []
    for variable, unit, data_type, latest_time, latest, mean_24h in rows:
        label = "PM2.5" if variable == "pm2_5" else "PM10"
        parts.append(
            f"{label} latest {round(latest, 1)} {unit} (24 h mean {round(mean_24h, 1) if mean_24h is not None else 'n/a'} {unit})"
        )
        facts.append({"label": f"{label} latest ({unit})", "value": round(latest, 1)})
    return {
        "answer": (
            f"{'; '.join(parts)}. These are CAMS modelled values for the grid cell containing the AOI "
            f"centroid, sampled {latest_time}. They are not readings from a Gwalior monitoring station."
        ),
        "facts": facts,
        "sources": [
            {
                "dataset": "Open-Meteo Air Quality / CAMS global",
                "type": "modelled",
                "collected": str(latest_time),
                "note": f"Fetched {fetched}; ~40 km grid, bilinear interpolation",
            }
        ],
        "limitations": [
            "Model output, not a local instrument measurement.",
            "Street-level concentrations can differ substantially from a 40 km grid cell.",
            "No CPCB/GPCB station feed is connected.",
        ],
    }


def _temperature() -> dict[str, Any]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT observed_at::date, "
                "max(value) FILTER (WHERE variable='temperature_2m_max'), "
                "min(value) FILTER (WHERE variable='temperature_2m_min'), "
                "max(value) FILTER (WHERE variable='temperature_2m_mean') "
                "FROM environmental_observations WHERE granularity='daily' "
                "AND observed_at > now() - interval '10 days' "
                "GROUP BY 1 ORDER BY 1 DESC LIMIT 1"
            )
        ).first()
        span = conn.execute(
            text(
                "SELECT round(avg(value) FILTER (WHERE variable='temperature_2m_max')::numeric,1), "
                "round(avg(value) FILTER (WHERE variable='temperature_2m_min')::numeric,1), "
                "count(DISTINCT observed_at::date) "
                "FROM environmental_observations WHERE granularity='daily' "
                "AND observed_at > now() - interval '8 days'"
            )
        ).first()
    if not rows:
        return {
            "answer": "No temperature series is stored. Run environment_ingest.py to fetch it.",
            "facts": [],
            "sources": [],
            "limitations": ["Environmental ingestion has not run."],
        }
    return {
        "answer": (
            f"On {rows[0]} the modelled 2 m air temperature ranged from {round(rows[1],1)} °C to "
            f"{round(rows[2],1)} °C (mean {round(rows[0 + 3],1)} °C). Over the last {span[2]} days the "
            f"average daily maximum was {span[0]} °C and average daily minimum {span[1]} °C. "
            "This is an air-temperature reanalysis value, not a surface-temperature or "
            "urban-heat-island measurement."
        ),
        "facts": [
            {"label": "Latest day", "value": str(rows[0])},
            {"label": "Daily max (°C)", "value": round(rows[1], 1)},
            {"label": "Daily min (°C)", "value": round(rows[2], 1)},
            {"label": "Average max over period (°C)", "value": float(span[0] or 0)},
        ],
        "sources": [
            {
                "dataset": "Open-Meteo temperature (ERA5/IFS blend)",
                "type": "modelled",
                "collected": str(rows[0]),
                "note": "~9-11 km reanalysis grid interpolated to the AOI centroid",
            }
        ],
        "limitations": [
            "No land-surface temperature or NDVI product is configured.",
            "Urban heat island intensity inside dense built-up areas is not resolved.",
        ],
    }


def _green() -> dict[str, Any]:
    with engine.connect() as conn:
        mapped = conn.execute(text("SELECT COALESCE(sum(area_m2),0) FROM green_spaces")).scalar() or 0
        count = conn.execute(text("SELECT count(*) FROM green_spaces")).scalar() or 0
        aoi = conn.execute(text("SELECT area_km2::float FROM aoi_boundary LIMIT 1")).scalar() or 0
        largest = conn.execute(
            text(
                "SELECT coalesce(name,'unnamed'), round((area_m2/10000.0)::numeric,2) "
                "FROM green_spaces ORDER BY area_m2 DESC NULLS LAST LIMIT 3"
            )
        ).all()
    share = round(float(mapped) / (aoi * 1_000_000) * 100, 2) if aoi else None
    names = ", ".join(f"{row[0]} ({row[1]} ha)" for row in largest)
    return {
        "answer": (
            f"{count} mapped green-space polygons cover {round(float(mapped)/10000, 2)} ha, "
            f"{share}% of the {aoi} km² AOI. Largest: {names}. "
            "Because only explicitly mapped OSM polygons are counted, this is a lower bound on "
            "vegetation cover and not a canopy measurement."
        ),
        "facts": [
            {"label": "Mapped green area (ha)", "value": round(float(mapped) / 10000, 2)},
            {"label": "Share of AOI (%)", "value": share},
            {"label": "Polygons", "value": count},
        ],
        "sources": [
            {
                "dataset": "citypulse.green_spaces",
                "type": "open geodata (derived)",
                "collected": "2026-11-13 (ingestion run)",
                "note": "OSM leisure/landuse/natural polygons clipped to the AOI",
            }
        ],
        "limitations": [
            "Street trees and unmapped vegetation are excluded — this understates green cover.",
            "No NDVI or canopy-cover product is configured.",
        ],
    }


def _buildings() -> dict[str, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT count(*), count(*) FILTER (WHERE height_m IS NOT NULL), "
                "count(*) FILTER (WHERE levels IS NOT NULL) FROM buildings"
            )
        ).first()
    return {
        "answer": (
            f"{row[0]} building footprints are stored. {row[1]} carry an OSM height and {row[2]} "
            "carry a storey count; the remainder have neither, so their 3D extrusion is illustrative."
        ),
        "facts": [
            {"label": "Footprints", "value": row[0]},
            {"label": "With OSM height", "value": row[1]},
            {"label": "With levels", "value": row[2]},
        ],
        "sources": [
            {
                "dataset": "citypulse.buildings",
                "type": "open geodata",
                "collected": "2026-11-13 (ingestion run)",
                "note": "OSM building footprints clipped to the AOI",
            }
        ],
        "limitations": [
            "OSM building coverage in Gwalior is incomplete; absence is not evidence of no building.",
            "Illustrative extrusion uses 3.2 m per storey.",
        ],
    }


def _provenance() -> dict[str, Any]:
    with engine.connect() as conn:
        layers = conn.execute(
            text("SELECT name, row_count, data_freshness, source FROM geographic_layers ORDER BY name")
        ).all()
        datasets = conn.execute(
            text("SELECT name, data_type, last_fetched, known_limitations FROM environment_datasets ORDER BY name")
        ).all()
        civic = conn.execute(text("SELECT count(*) FROM civic_issues")).scalar() or 0
    sources = [
        {
            "dataset": row[0],
            "type": "open geodata",
            "collected": str(row[2]),
            "note": f"{row[1]} features; {row[3]}",
        }
        for row in layers
    ] + [
        {
            "dataset": row[0],
            "type": row[1],
            "collected": str(row[2]),
            "note": row[3],
        }
        for row in datasets
    ] + [
        {
            "dataset": "citypulse.civic_issues",
            "type": "citizen-reported",
            "collected": "live",
            "note": f"{civic} stored reports",
        }
    ]
    return {
        "answer": (
            "Available datasets: "
            + "; ".join(f"{row[0]} ({row[1]} features)" for row in layers)
            + "; modelled CAMS air quality and ERA5/IFS temperature at the AOI centroid; and "
            f"{civic} citizen-reported civic issues. Nothing in this project is a live sensor feed, "
            "and there are no trained predictive models."
        ),
        "facts": [{"label": "Geographic layers", "value": len(layers)}],
        "sources": sources,
        "limitations": [
            "All environmental values are modelled, not observed at a station.",
            "OSM coverage is incomplete; counts are lower bounds.",
            "No ML model is trained and no measured traffic data exists.",
        ],
    }


HANDLERS = {
    "civic": _civic,
    "traffic": _network,
    "air": _air,
    "temperature": _temperature,
    "green": _green,
    "buildings": _buildings,
    "provenance": _provenance,
}


@router.post("/ask", summary="Answer a question from ingested data only")
def ask(payload: Question) -> dict[str, Any]:
    intents = classify(payload.question)
    if not intents:
        return {
            "question": payload.question,
            "intent": None,
            "answer": (
                "I cannot answer that from the data this project holds. I only report ingested "
                "OpenStreetMap geometry, modelled CAMS air quality, modelled ERA5/IFS temperature, "
                "and citizen-submitted civic issues. I will not estimate a figure that is not in "
                "the database."
            ),
            "facts": [],
            "sources": [],
            "limitations": ["No matching dataset for this question."],
            "suggestions": [
                "How many potholes have been reported?",
                "What is the total road length in the AOI?",
                "What are the latest PM2.5 values?",
                "How much green space is mapped?",
            ],
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    result = HANDLERS[intents[0]]()
    return {
        "question": payload.question,
        "intent": intents[0],
        "matched_intents": intents,
        **result,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@router.get("/capabilities", summary="What the analyst can answer from")
def capabilities() -> dict[str, Any]:
    return {
        "categories": sorted(HANDLERS),
        "examples": [
            "How many civic issues are open, and which category dominates?",
            "What is the road network length by class?",
            "What are the latest modelled PM2.5 and PM10 values?",
            "What was the temperature range this week?",
            "How much green space is mapped in the AOI?",
            "How many buildings have real height data?",
            "Which datasets exist and what are their limitations?",
        ],
        "policy": (
            "Answers are computed from the database. The analyst refuses questions it cannot "
            "answer from stored data and never fabricates statistics."
        ),
    }
