"""End-to-end tests for the milestone-2 endpoints (environment, civic, analyst).

These exercise the real PostGIS database, because the value of the endpoints is
that they read stored data rather than returning fixtures. Test fixtures are
always written with `is_demo=True` and deleted afterwards so a test run can
never leave records that look like citizen submissions.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app import app
from db_config import get_engine
from sqlalchemy import text

client = TestClient(app)
engine = get_engine()

MILESTONE2_PREFIX = "PYTEST-DEMO"


@pytest.fixture(scope="module", autouse=True)
def cleanup_demo_rows():
    yield
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM civic_issues WHERE description LIKE :prefix"),
            {"prefix": f"{MILESTONE2_PREFIX}%"},
        )


def _create_issue(**overrides):
    payload = {
        "category": "pothole",
        "description": f"{MILESTONE2_PREFIX} a pothole used by the test suite",
        "severity": "high",
        "latitude": 26.2185,
        "longitude": 78.1785,
        "is_demo": True,
    }
    payload.update(overrides)
    response = client.post("/api/civic-issues", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# --- environment -----------------------------------------------------------


def test_environment_overview_reports_provenance():
    response = client.get("/api/environment/overview")
    assert response.status_code == 200, response.text
    body = response.json()

    assert "air_quality" in body and "temperature" in body and "green_cover" in body
    assert isinstance(body["unavailable"], list)
    assert body["unavailable"], "gaps must be stated explicitly"

    for pollutant in body["air_quality"]["pollutants"]:
        # Every value must say how it was obtained and where it came from.
        assert pollutant["data_type"] in {"modelled", "observed", "estimated", "derived"}
        assert pollutant["dataset"]
        assert pollutant["source"]
        assert pollutant["unit"]
        if pollutant["latest"] is not None:
            assert pollutant["latest_time"]

    if body["temperature"]["days"]:
        day = body["temperature"]["days"][-1]
        assert {"date", "min", "max"} <= set(day)
        assert body["temperature"]["data_type"] == "modelled"


def test_environment_sources_have_attribution_and_limits():
    response = client.get("/api/environment/sources")
    assert response.status_code == 200
    sources = response.json()
    if not sources:
        pytest.skip("no environmental ingestion has run in this database")

    for source in sources:
        assert source["source_url"].startswith("http")
        assert source["attribution"]
        assert source["known_limitations"]
        assert source["data_type"] in {"modelled", "observed", "estimated", "derived"}


def test_green_cover_is_bounded_by_aoi():
    response = client.get("/api/environment/overview")
    green = response.json()["green_cover"]
    if green["mapped_green_area_ha"] <= 0:
        pytest.skip("no green space polygons ingested")
    assert green["mapped_share_of_aoi_percent"] is not None
    assert 0 < green["mapped_share_of_aoi_percent"] <= 100


# --- civic issues ----------------------------------------------------------


def test_civic_report_lifecycle_and_duplicate_detection():
    first = _create_issue(latitude=26.3001, longitude=78.2001)
    assert first["status"] == "reported"
    assert first["is_demo"] is True
    assert first["reference"].startswith("CP-")
    assert first["geometry"]["type"] == "Point"

    # 25 m away, same category, inside the 30-day window -> linked, not rejected.
    second = _create_issue(latitude=26.30025, longitude=78.20025)
    assert second["duplicate_of"] == first["id"]
    assert "duplicate_warning" in second

    # A different category at the same place is not a duplicate.
    third = _create_issue(category="streetlight", latitude=26.30025, longitude=78.20025)
    assert third["duplicate_of"] is None

    verified = client.patch(
        f"/api/civic-issues/{first['id']}/status",
        json={"status": "verified", "moderation_note": "confirmed during tests"},
    )
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    assert verified.json()["verified_at"]

    # verified -> resolved is not an allowed transition
    invalid = client.patch(f"/api/civic-issues/{first['id']}/status", json={"status": "resolved"})
    assert invalid.status_code == 409

    for status in ("in_progress", "resolved"):
        step = client.patch(f"/api/civic-issues/{first['id']}/status", json={"status": status})
        assert step.status_code == 200, step.text
    assert client.patch(
        f"/api/civic-issues/{first['id']}/status", json={"status": "verified"}
    ).status_code == 409


def test_civic_validation_rejects_bad_input():
    too_short = client.post(
        "/api/civic-issues",
        json={
            "category": "pothole",
            "description": "short",
            "latitude": 26.2,
            "longitude": 78.1,
        },
    )
    assert too_short.status_code == 422

    bad_category = client.post(
        "/api/civic-issues",
        json={
            "category": "aliens",
            "description": f"{MILESTONE2_PREFIX} invalid category",
            "latitude": 26.2,
            "longitude": 78.1,
        },
    )
    assert bad_category.status_code == 422

    bad_latitude = client.post(
        "/api/civic-issues",
        json={
            "category": "pothole",
            "description": f"{MILESTONE2_PREFIX} invalid latitude",
            "latitude": 126.2,
            "longitude": 78.1,
        },
    )
    assert bad_latitude.status_code == 422


def test_civic_filters_and_stats_exclude_demo_when_asked():
    opened = _create_issue(category="garbage", latitude=26.3101, longitude=78.2101)

    only_real = client.get("/api/civic-issues", params={"include_demo": "false"}).json()
    assert all(not feature["properties"]["is_demo"] for feature in only_real["features"])

    filtered = client.get(
        "/api/civic-issues", params={"category": "garbage", "status": "reported"}
    ).json()
    assert all(feature["properties"]["category"] == "garbage" for feature in filtered["features"])

    stats = client.get("/api/civic-issues/stats").json()
    assert stats["total"] == stats["real_reports"] + stats["demo_reports"]
    assert stats["total"] >= 1

    client.patch(f"/api/civic-issues/{opened['id']}/status", json={"status": "rejected"})


def test_hotspots_cluster_nearby_open_reports():
    base = {"category": "drainage", "severity": "medium"}
    created = [
        _create_issue(latitude=26.3200 + offset / 10000, longitude=78.2200 + offset / 10000, **base)
        for offset in (0, 1, 2)
    ]

    response = client.get("/api/civic-issues/hotspots", params={"radius_m": 200, "min_issues": 3})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["radius_m"] == 200
    assert "ST_ClusterDBSCAN" in body["method"]

    matching = [cluster for cluster in body["clusters"] if cluster["issue_count"] >= 3]
    assert matching, body
    cluster = matching[0]
    assert cluster["dominant_category"] == "drainage"
    assert 26.31 < cluster["center"]["latitude"] < 26.33
    assert 78.21 < cluster["center"]["longitude"] < 78.23
    assert cluster["approximate_radius_m"] >= 0

    for issue in created:
        client.patch(f"/api/civic-issues/{issue['id']}/status", json={"status": "rejected"})


# --- analyst ---------------------------------------------------------------


def test_analyst_cites_sources_for_answerable_questions():
    response = client.post(
        "/api/analyst/ask", json={"question": "What is the total road length in the AOI?"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "traffic"
    assert body["sources"] and body["sources"][0]["dataset"]
    assert body["limitations"]
    assert any(fact["label"] == "Total length (km)" for fact in body["facts"])
    assert "862" in body["answer"] or "km" in body["answer"]


def test_analyst_refuses_questions_without_data():
    response = client.post(
        "/api/analyst/ask", json={"question": "What will the population be in 2035?"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] is None
    assert body["facts"] == []
    assert "cannot answer that from the data" in body["answer"].lower()


def test_analyst_air_quality_states_it_is_modelled():
    response = client.post(
        "/api/analyst/ask", json={"question": "What are the latest PM2.5 and PM10 values?"}
    )
    body = response.json()
    if body["intent"] is None or not body["sources"]:
        pytest.skip("no air-quality observations stored")
    assert body["intent"] == "air"
    assert body["sources"][0]["type"] == "modelled"
    assert "not" in body["answer"].lower()


def test_analyst_capabilities_list_examples():
    response = client.get("/api/analyst/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["examples"] and body["policy"]
    assert "civic" in body["categories"]


def test_analyst_rejects_empty_question():
    assert client.post("/api/analyst/ask", json={"question": "a"}).status_code == 422
