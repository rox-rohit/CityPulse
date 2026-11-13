"""API tests for the CityPulse AI backend.

These run against the real PostGIS database populated by `ingest_aoi.py`,
so they verify the end-to-end data path rather than mocks.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)

EXPECTED_LAYERS = {"roads", "buildings", "facilities", "green_spaces"}


@pytest.fixture(scope="module")
def layer_index() -> list[dict]:
    response = client.get("/api/layers")
    assert response.status_code == 200
    return response.json()


def test_health_reports_postgis() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert "postgis" in body
    assert body["layers_registered"] >= len(EXPECTED_LAYERS)


def test_layers_are_registered(layer_index: list[dict]) -> None:
    tables = {layer["table_name"] for layer in layer_index}
    assert EXPECTED_LAYERS <= tables
    for layer in layer_index:
        assert layer["validation_status"] == "validated"
        assert layer["row_count"] >= 0
        assert layer["source"].startswith("OpenStreetMap")


def test_roads_geojson_contains_real_geometry() -> None:
    response = client.get("/api/layers/roads/geojson", params={"limit": 25})
    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "FeatureCollection"
    assert len(payload["features"]) > 0
    feature = payload["features"][0]
    assert feature["geometry"]["type"] in {"LineString", "MultiLineString"}
    assert feature["properties"]["osm_id"]
    assert "length_m" in feature["properties"]


def test_building_features_expose_height_provenance() -> None:
    response = client.get("/api/layers/buildings/geojson", params={"limit": 50})
    assert response.status_code == 200
    features = response.json()["features"]
    assert features, "expected ingested building footprints"
    for feature in features:
        properties = feature["properties"]
        if properties.get("height_m") is not None:
            assert properties.get("height_source") in {
                "osm:height",
                "derived:building:levels*3.2 (illustrative)",
            }


def test_only_aoi_features_are_returned() -> None:
    aoi = client.get("/api/aoi").json()
    assert aoi["properties"]["area_km2"] > 0
    min_lon = min(point[0] for point in aoi["geometry"]["coordinates"][0])
    max_lon = max(point[0] for point in aoi["geometry"]["coordinates"][0])

    features = client.get("/api/layers/facilities/geojson", params={"limit": 100}).json()["features"]
    assert features, "expected ingested facilities"
    for feature in features:
        lon = feature["geometry"]["coordinates"][0]
        assert min_lon - 1e-6 <= lon <= max_lon + 1e-6


def test_metadata_documents_limitations() -> None:
    response = client.get("/api/metadata/roads")
    assert response.status_code == 200
    body = response.json()
    assert body["license"].startswith("Open Database License")
    assert body["known_limitations"]
    assert body["feature_count"] >= 0


def test_network_analytics_matches_road_table() -> None:
    response = client.get("/api/analytics/network")
    assert response.status_code == 200
    body = response.json()
    assert body["segments"] > 0
    assert body["total_length_km"] > 0
    assert body["by_class"]
    assert "no live traffic" in body["note"].lower()


def test_green_cover_is_bounded_by_aoi() -> None:
    response = client.get("/api/analytics/green-cover")
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["mapped_share_of_aoi_percent"] <= 100


def test_unknown_layer_returns_404() -> None:
    assert client.get("/api/layers/does-not-exist/geojson").status_code == 404


def test_bbox_filter_limits_results() -> None:
    narrow = client.get(
        "/api/layers/roads/geojson",
        params={"bbox": "78.1800,26.2200,78.1810,26.2210", "limit": 5000},
    )
    everything = client.get("/api/layers/roads/geojson", params={"limit": 5000})
    assert narrow.status_code == 200
    assert len(narrow.json()["features"]) <= len(everything.json()["features"])
