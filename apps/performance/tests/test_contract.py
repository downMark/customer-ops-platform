from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_schema_has_closed_privacy_allowlists() -> None:
    schema = json.loads(
        (ROOT / "schema/performance-event-v1.schema.json").read_text()
    )
    assert schema["additionalProperties"] is False
    assert schema["properties"]["measurements"]["additionalProperties"] is False
    assert schema["properties"]["attributes"]["additionalProperties"] is False
    serialized = json.dumps(schema).lower()
    for forbidden in (
        "prompt",
        "responsebody",
        "requestbody",
        "userid",
        "orderid",
        "authorization",
        "cookie",
    ):
        assert forbidden not in serialized


def test_all_sdk_packages_exist() -> None:
    assert (ROOT / "sdk/typescript/package.json").is_file()
    assert (ROOT / "sdk/rust/Cargo.toml").is_file()
    assert (ROOT / "sdk/python/pyproject.toml").is_file()
