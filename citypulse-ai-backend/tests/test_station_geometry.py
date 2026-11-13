"""Regression tests for station ↔ AOI geometry.

The AOI is the documented rectangle: longitude 78.170–78.190, latitude
26.210–26.230. These tests pin the meaning of the distance shown for each
station: 0 km when the station is inside or on the AOI, otherwise the distance
to the nearest AOI boundary (not to the centroid).
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import app
from db_config import get_engine
from station_geo import station_aoi_distances

client = TestClient(app)
engine = get_engine()

# Documented AOI rectangle, asserted against the stored geometry below.
AOI_WEST, AOI_EAST = 78.170, 78.190
AOI_SOUTH, AOI_NORTH = 26.210, 26.230

INSIDE = {"station_id": "test-inside", "latitude": 26.2105, "longitude": 78.1710}
OUTSIDE = {"station_id": "test-outside", "latitude": 26.2034, "longitude": 78.1933}
ON_BOUNDARY = {"station_id": "test-boundary", "latitude": 26.2200, "longitude": 78.1700}


def _aoi_bounds():
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT ST_SRID(geometry), ST_XMin(Box2D(geometry)), ST_YMin(Box2D(geometry)), "
                "ST_XMax(Box2D(geometry)), ST_YMax(Box2D(geometry)) FROM aoi_boundary LIMIT 1"
            )
        ).first()


def test_aoi_geometry_is_the_documented_rectangle_in_wgs84():
    row = _aoi_bounds()
    assert row is not None, "no AOI geometry stored"
    srid, xmin, ymin, xmax, ymax = row
    assert srid == 4326
    assert (xmin, ymin, xmax, ymax) == pytest.approx(
        (AOI_WEST, AOI_SOUTH, AOI_EAST, AOI_NORTH), abs=1e-9
    )


def test_station_inside_aoi_has_zero_distance():
    geo = station_aoi_distances(engine, [INSIDE])["test-inside"]
    assert geo["inside_aoi"] is True
    assert geo["distance_km_to_aoi_boundary"] == 0.0
    # The centroid metric is still reported for transparency, and is non-zero.
    assert geo["distance_km_from_aoi_centroid"] > 0


def test_station_on_aoi_boundary_is_inside_with_zero_distance():
    geo = station_aoi_distances(engine, [ON_BOUNDARY])["test-boundary"]
    assert geo["inside_aoi"] is True, "ST_Covers includes the boundary"
    assert geo["distance_km_to_aoi_boundary"] == 0.0


def test_station_outside_aoi_measures_to_nearest_boundary():
    geo = station_aoi_distances(engine, [OUTSIDE])["test-outside"]
    assert geo["inside_aoi"] is False
    # Nearest boundary point is the (78.190, 26.210) corner: dx ~329 m, dy ~734 m.
    lat_m = (AOI_SOUTH - OUTSIDE["latitude"]) * 111_320
    lon_m = (OUTSIDE["longitude"] - AOI_EAST) * 111_320 * math.cos(math.radians(OUTSIDE["latitude"]))
    expected_km = math.hypot(lat_m, lon_m) / 1000.0
    assert geo["distance_km_to_aoi_boundary"] == pytest.approx(expected_km, abs=0.05)
    # It must not be the centroid distance, which is what the old code reported.
    assert geo["distance_km_to_aoi_boundary"] < geo["distance_km_from_aoi_centroid"]


def test_stations_endpoint_reports_containment_and_corrected_distance():
    response = client.get("/api/environment/stations")
    assert response.status_code == 200, response.text
    stations = {s["station_id"]: s for s in response.json()}
    assert stations, "no Gwalior stations registered"

    for station in stations.values():
        assert station["aoi_srid"] == 4326
        assert "inside_aoi" in station
        # Backwards-compatible alias must agree with the boundary metric.
        assert station["distance_km_from_AOI"] == station["distance_km_to_aoi_boundary"]
        if station["inside_aoi"]:
            assert station["distance_km_from_AOI"] == 0.0
        else:
            assert station["distance_km_from_AOI"] > 0

    phool_bagh = stations.get("5275")
    if phool_bagh:
        # 26.2105, 78.1710 lies inside the rectangle.
        assert phool_bagh["inside_aoi"] is True
        assert phool_bagh["distance_km_from_AOI"] == 0.0

    city_center = stations.get("5273")
    if city_center:
        # 26.2034, 78.1933 lies just south-east of the rectangle.
        assert city_center["inside_aoi"] is False
        assert city_center["distance_km_from_AOI"] == pytest.approx(0.8, abs=0.1)
