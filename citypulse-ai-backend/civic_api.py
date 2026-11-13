"""Civic issue reporting and analysis.

Real, user-submitted reports stored in PostGIS. No demonstration records are
inserted by any seed script; rows marked `is_demo` are only created when a
client explicitly asks for them, and are always surfaced separately.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from db_config import get_engine
from setup_db import ensure_schema

router = APIRouter(prefix="/api/civic-issues", tags=["civic"])
engine = get_engine()

Category = Literal["pothole", "garbage", "drainage", "streetlight", "water_supply", "road_damage"]
Severity = Literal["low", "medium", "high"]
Status = Literal["reported", "verified", "in_progress", "resolved", "rejected"]

CATEGORY_LABELS = {
    "pothole": "Pothole",
    "garbage": "Garbage",
    "drainage": "Drainage",
    "streetlight": "Streetlight",
    "water_supply": "Water supply",
    "road_damage": "Road damage",
}

# Moderation workflow: only these transitions are accepted.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "reported": {"verified", "rejected"},
    "verified": {"in_progress", "rejected"},
    "in_progress": {"resolved"},
    "resolved": set(),
    "rejected": set(),
}

DUPLICATE_RADIUS_M = 60
DUPLICATE_WINDOW_DAYS = 30


class IssueCreate(BaseModel):
    category: Category
    description: str = Field(min_length=10, max_length=2000)
    severity: Severity = "medium"
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    reporter_name: str | None = Field(default=None, max_length=120)
    reporter_contact: str | None = Field(default=None, max_length=200)
    is_demo: bool = False


class StatusUpdate(BaseModel):
    status: Status
    moderation_note: str | None = Field(default=None, max_length=500)


def _reference() -> str:
    return f"CP-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"


def _serialize(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "reference": row["reference"],
        "category": row["category"],
        "category_label": CATEGORY_LABELS.get(row["category"], row["category"]),
        "description": row["description"],
        "severity": row["severity"],
        "status": row["status"],
        "is_demo": row["is_demo"],
        "duplicate_of": row["duplicate_of"],
        "moderation_note": row["moderation_note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "verified_at": row["verified_at"],
        "resolved_at": row["resolved_at"],
        "longitude": row["longitude"],
        "latitude": row["latitude"],
        "reporter_name": row["reporter_name"],
        "geometry": {"type": "Point", "coordinates": [row["longitude"], row["latitude"]]},
    }


SELECT_ISSUE = """
    SELECT id, reference, category, description, severity, status, is_demo,
           duplicate_of, moderation_note, created_at, updated_at, verified_at,
           resolved_at, reporter_name,
           ST_X(geometry) AS longitude, ST_Y(geometry) AS latitude
    FROM civic_issues
"""


@router.post("", status_code=201, summary="Submit a civic issue report")
def create_issue(payload: IssueCreate) -> dict[str, Any]:
    ensure_schema(engine)
    with engine.begin() as conn:
        duplicate = conn.execute(
            text(
                """
                SELECT id, reference, status,
                       round(ST_Distance(geometry::geography,
                             ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)::numeric, 1)
                             AS distance_m
                FROM civic_issues
                WHERE category = :category
                  AND status <> 'rejected'
                  AND created_at > now() - (:days || ' days')::interval
                  AND ST_DWithin(geometry::geography,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {
                "lon": payload.longitude,
                "lat": payload.latitude,
                "category": payload.category,
                "days": DUPLICATE_WINDOW_DAYS,
                "radius": DUPLICATE_RADIUS_M,
            },
        ).mappings().first()

        for _ in range(5):
            reference = _reference()
            exists = conn.execute(
                text("SELECT 1 FROM civic_issues WHERE reference = :reference"),
                {"reference": reference},
            ).first()
            if not exists:
                break
        else:
            raise HTTPException(status_code=500, detail="Could not allocate a unique reference")

        row = conn.execute(
            text(
                """
                INSERT INTO civic_issues
                    (reference, category, description, severity, status, reporter_name,
                     reporter_contact, is_demo, duplicate_of, geometry)
                VALUES
                    (:reference, :category, :description, :severity, 'reported', :reporter_name,
                     :reporter_contact, :is_demo, :duplicate_of,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                RETURNING id
                """
            ),
            {
                "reference": reference,
                "category": payload.category,
                "description": payload.description.strip(),
                "severity": payload.severity,
                "reporter_name": (payload.reporter_name or "").strip() or None,
                "reporter_contact": (payload.reporter_contact or "").strip() or None,
                "is_demo": payload.is_demo,
                "duplicate_of": duplicate["id"] if duplicate else None,
                "lon": payload.longitude,
                "lat": payload.latitude,
            },
        ).mappings().first()

        created = conn.execute(
            text(SELECT_ISSUE + " WHERE id = :id"), {"id": row["id"]}
        ).mappings().first()

    result = _serialize(created)
    if duplicate:
        result["duplicate_warning"] = (
            f"A similar {payload.category} report already exists within "
            f"{duplicate['distance_m']} m ({duplicate['reference']}, status {duplicate['status']}). "
            "This submission was recorded and linked to it."
        )
    return result


@router.get("", summary="List civic issues with filters")
def list_issues(
    status: str | None = Query(None, description="reported|verified|in_progress|resolved|rejected"),
    category: str | None = Query(None),
    include_demo: bool = Query(True),
    bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    ensure_schema(engine)
    clauses = ["1 = 1"]
    params: dict[str, Any] = {"limit": limit}
    if status:
        clauses.append("status = :status")
        params["status"] = status
    if category:
        clauses.append("category = :category")
        params["category"] = category
    if not include_demo:
        clauses.append("is_demo = false")
    if bbox:
        try:
            min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bbox must be minLon,minLat,maxLon,maxLat") from exc
        clauses.append(
            "ST_Intersects(geometry, ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326))"
        )
        params.update({"min_lon": min_lon, "min_lat": min_lat, "max_lon": max_lon, "max_lat": max_lat})

    sql = SELECT_ISSUE + " WHERE " + " AND ".join(clauses) + " ORDER BY created_at DESC LIMIT :limit"
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
        counts = conn.execute(
            text(
                "SELECT status, count(*) FROM civic_issues GROUP BY status ORDER BY status"
            )
        ).all()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [row["longitude"], row["latitude"]]},
                "properties": _serialize(row),
            }
            for row in rows
        ],
        "counts": {row[0]: row[1] for row in counts},
        "total": sum(row[1] for row in counts),
        "categories": CATEGORY_LABELS,
        "duplicate_policy": {
            "radius_m": DUPLICATE_RADIUS_M,
            "window_days": DUPLICATE_WINDOW_DAYS,
        },
    }


@router.get("/stats", summary="Aggregate civic issue statistics")
def stats() -> dict[str, Any]:
    ensure_schema(engine)
    with engine.connect() as conn:
        by_status = conn.execute(
            text("SELECT status, count(*) FROM civic_issues GROUP BY status ORDER BY status")
        ).all()
        by_category = conn.execute(
            text("SELECT category, count(*) FROM civic_issues GROUP BY category ORDER BY count(*) DESC")
        ).all()
        by_severity = conn.execute(
            text("SELECT severity, count(*) FROM civic_issues GROUP BY severity")
        ).all()
        total = conn.execute(text("SELECT count(*) FROM civic_issues")).scalar() or 0
        demo = conn.execute(text("SELECT count(*) FROM civic_issues WHERE is_demo")).scalar() or 0
        duplicates = conn.execute(
            text("SELECT count(*) FROM civic_issues WHERE duplicate_of IS NOT NULL")
        ).scalar() or 0
        resolved_30d = conn.execute(
            text(
                "SELECT count(*) FROM civic_issues WHERE status = 'resolved' "
                "AND resolved_at > now() - interval '30 days'"
            )
        ).scalar() or 0
    return {
        "total": total,
        "real_reports": total - demo,
        "demo_reports": demo,
        "duplicates": duplicates,
        "resolved_last_30_days": resolved_30d,
        "by_status": {row[0]: row[1] for row in by_status},
        "by_category": {row[0]: row[1] for row in by_category},
        "by_severity": {row[0]: row[1] for row in by_severity},
    }


@router.get("/hotspots", summary="Spatial clusters of open issues")
def hotspots(
    radius_m: int = Query(200, ge=25, le=2000),
    min_issues: int = Query(2, ge=2, le=50),
    include_resolved: bool = Query(False),
) -> dict[str, Any]:
    ensure_schema(engine)
    status_filter = "" if include_resolved else "AND status NOT IN ('resolved','rejected')"
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                WITH clustered AS (
                    SELECT id, category, severity,
                           ST_ClusterDBSCAN(ST_Transform(geometry, 3857),
                                            eps := :radius, minpoints := :min_issues)
                               OVER () AS cluster_id
                    FROM civic_issues
                    WHERE 1 = 1 {status_filter}
                ),
                grouped AS (
                    SELECT c.cluster_id,
                           count(*) AS issue_count,
                           mode() WITHIN GROUP (ORDER BY c.category) AS dominant_category,
                           count(*) FILTER (WHERE c.severity = 'high') AS high_severity,
                           ST_Collect(ST_Transform(ci.geometry, 3857)) AS geoms
                    FROM clustered c
                    JOIN civic_issues ci ON ci.id = c.id
                    WHERE c.cluster_id IS NOT NULL
                    GROUP BY c.cluster_id
                ),
                centred AS (
                    SELECT cluster_id, issue_count, dominant_category, high_severity,
                           ST_Centroid(geoms) AS centroid
                    FROM grouped
                )
                SELECT ce.cluster_id, ce.issue_count, ce.dominant_category, ce.high_severity,
                       round(max(ST_Distance(ce.centroid,
                             ST_Transform(ci.geometry, 3857)))::numeric) AS approximate_radius_m,
                       ST_X(ST_Transform(ce.centroid, 4326)) AS lon,
                       ST_Y(ST_Transform(ce.centroid, 4326)) AS lat
                FROM centred ce
                JOIN clustered cl ON cl.cluster_id = ce.cluster_id
                JOIN civic_issues ci ON ci.id = cl.id
                GROUP BY ce.cluster_id, ce.issue_count, ce.dominant_category,
                         ce.high_severity, ce.centroid
                ORDER BY ce.issue_count DESC
                """
            ),
            {"radius": radius_m, "min_issues": min_issues},
        ).mappings().all()

        clusters = [
            {
                "cluster_id": int(row["cluster_id"]),
                "issue_count": row["issue_count"],
                "dominant_category": row["dominant_category"],
                "high_severity": row["high_severity"],
                "approximate_radius_m": round(float(row["approximate_radius_m"] or 0)),
                "center": {"longitude": row["lon"], "latitude": row["lat"]},
            }
            for row in rows
        ]

    return {
        "radius_m": radius_m,
        "min_issues": min_issues,
        "include_resolved": include_resolved,
        "method": (
            "ST_ClusterDBSCAN over EPSG:3857 coordinates; clusters need at least "
            f"{min_issues} reports within {radius_m} m of each other."
        ),
        "clusters": clusters,
    }


@router.get("/{issue_id}", summary="Fetch one civic issue")
def get_issue(issue_id: int) -> dict[str, Any]:
    ensure_schema(engine)
    with engine.connect() as conn:
        row = conn.execute(text(SELECT_ISSUE + " WHERE id = :id"), {"id": issue_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Issue not found")
    return _serialize(row)


@router.patch("/{issue_id}/status", summary="Moderate an issue through its workflow")
def update_status(issue_id: int, payload: StatusUpdate) -> dict[str, Any]:
    ensure_schema(engine)
    with engine.begin() as conn:
        current = conn.execute(
            text("SELECT status FROM civic_issues WHERE id = :id"), {"id": issue_id}
        ).mappings().first()
        if not current:
            raise HTTPException(status_code=404, detail="Issue not found")

        current_status = current["status"]
        if payload.status != current_status and payload.status not in ALLOWED_TRANSITIONS[current_status]:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot move from '{current_status}' to '{payload.status}'. "
                    f"Allowed: {sorted(ALLOWED_TRANSITIONS[current_status]) or 'none (terminal state)'}"
                ),
            )

        conn.execute(
            text(
                """
                UPDATE civic_issues
                SET status = :status,
                    moderation_note = COALESCE(:note, moderation_note),
                    updated_at = now(),
                    verified_at = CASE WHEN :status = 'verified' THEN now() ELSE verified_at END,
                    resolved_at = CASE WHEN :status = 'resolved' THEN now() ELSE resolved_at END
                WHERE id = :id
                """
            ),
            {"status": payload.status, "note": payload.moderation_note, "id": issue_id},
        )
        row = conn.execute(text(SELECT_ISSUE + " WHERE id = :id"), {"id": issue_id}).mappings().first()
    return _serialize(row)
