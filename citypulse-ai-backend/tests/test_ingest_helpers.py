"""Unit tests for ingestion helper functions (no database required)."""

from __future__ import annotations

import pandas as pd
import pytest

from ingest_aoi import (
    osm_identifier,
    parse_height_m,
    parse_levels,
    parse_other_tags,
    scalar,
)


def test_parse_other_tags_extracts_all_pairs() -> None:
    raw = '"amenity"=>"hospital","addr:street"=>"Jayendraganj","level"=>"2"'
    assert parse_other_tags(raw) == {
        "amenity": "hospital",
        "addr:street": "Jayendraganj",
        "level": "2",
    }


def test_parse_other_tags_handles_empty_values() -> None:
    assert parse_other_tags(None) == {}
    assert parse_other_tags("") == {}
    assert parse_other_tags(float("nan")) == {}


def test_parse_height_handles_units_and_garbage() -> None:
    assert parse_height_m("12") == 12.0
    assert parse_height_m("12.5 m") == 12.5
    assert parse_height_m("40'") == pytest.approx(12.19, abs=0.01)
    assert parse_height_m("tall") is None
    assert parse_height_m("0.2") is None
    assert parse_height_m(None) is None


def test_parse_levels_bounds() -> None:
    assert parse_levels("3") == 3
    assert parse_levels("3.0") == 3
    assert parse_levels("0") is None
    assert parse_levels("unknown") is None


def test_osm_identifier_prefers_way_id_for_multipolygons() -> None:
    row = pd.Series({"osm_id": float("nan"), "osm_way_id": 383740261.0})
    assert osm_identifier(row) == "383740261"
    assert osm_identifier(pd.Series({"osm_id": 12345, "osm_way_id": None})) == "12345"
    assert osm_identifier(pd.Series({"osm_id": None, "osm_way_id": None})) is None


def test_scalar_normalises_nan_and_numpy() -> None:
    assert scalar(float("nan")) is None
    assert scalar(pd.NA) is None
    assert scalar("text") == "text"

