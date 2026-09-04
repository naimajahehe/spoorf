"""
Update the bundled local IEEE OUI registry artifact.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCES = {
    24: "https://standards-oui.ieee.org/oui/oui.csv",
    28: "https://standards-oui.ieee.org/oui28/mam.csv",
    36: "https://standards-oui.ieee.org/oui36/oui36.csv",
}

EXPECTED_REGISTRY = {
    24: "MA-L",
    28: "MA-M",
    36: "MA-S",
}

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "src" / "core" / "fingerprint" / "data" / "oui_registry.json"
HEX_RE = re.compile(r"^[0-9A-F]+$")


def _normalize_assignment(value: str) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"[^0-9A-Fa-f]", "", value).upper()
    if not normalized or not HEX_RE.fullmatch(normalized):
        return None
    return normalized


def _fetch_registry_rows(url: str) -> list[dict[str, str]]:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept": "text/csv,application/csv,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://standards-oui.ieee.org/",
            "Connection": "keep-alive",
        },
    )
    with urlopen(request, timeout=60) as response:
        payload = response.read().decode("utf-8-sig")
    return list(csv.DictReader(payload.splitlines()))


def build_registry() -> dict[str, object]:
    assignments: dict[str, dict[str, str]] = {"24": {}, "28": {}, "36": {}}

    for bits, url in SOURCES.items():
        expected_registry = EXPECTED_REGISTRY[bits]
        for row in _fetch_registry_rows(url):
            if row.get("Registry", "").strip() != expected_registry:
                continue
            assignment = _normalize_assignment(row.get("Assignment", ""))
            organization = (row.get("Organization Name") or "").strip()
            if not assignment or not organization:
                continue
            assignments[str(bits)][assignment] = organization

        assignments[str(bits)] = dict(sorted(assignments[str(bits)].items()))

    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sources": {
            "24": SOURCES[24],
            "28": SOURCES[28],
            "36": SOURCES[36],
        },
        "assignments": assignments,
    }


def write_registry(payload: dict[str, object]) -> Path:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = OUTPUT_PATH.with_name(OUTPUT_PATH.name + ".tmp")

    try:
        with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        temp_path.replace(OUTPUT_PATH)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    return OUTPUT_PATH


def main() -> int:
    payload = build_registry()
    path = write_registry(payload)
    counts = {bits: len(entries) for bits, entries in payload["assignments"].items()}
    print(f"Wrote {path} with {counts['24']} MA-L, {counts['28']} MA-M, {counts['36']} MA-S entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
