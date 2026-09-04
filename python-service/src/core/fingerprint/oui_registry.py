"""
Versioned local OUI registry lookup.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Mapping, Optional


_DATA_PATH = Path(__file__).resolve().with_name("data").joinpath("oui_registry.json")
_HEX_RE = re.compile(r"^[0-9A-F]{12}$")


@dataclass(frozen=True, slots=True)
class OUIRecord:
    organization: str
    assignment: str
    prefix_bits: int


def _normalize_hex(value: str) -> Optional[str]:
    if not value:
        return None
    normalized = re.sub(r"[^0-9A-Fa-f]", "", value).upper()
    if not _HEX_RE.fullmatch(normalized):
        return None
    return normalized


def _normalize_assignment(value: str) -> Optional[str]:
    if not value:
        return None
    normalized = re.sub(r"[^0-9A-Fa-f]", "", value).upper()
    if not normalized or not re.fullmatch(r"[0-9A-F]+", normalized):
        return None
    return normalized


def _is_locally_administered(normalized_mac: str) -> bool:
    try:
        return bool(int(normalized_mac[:2], 16) & 0x02)
    except (TypeError, ValueError):
        return False


class OUIRegistry:
    def __init__(self, assignments: Dict[int, Dict[str, str]]):
        self._assignments = {
            int(bits): dict(sorted(entries.items()))
            for bits, entries in assignments.items()
        }

    @classmethod
    def from_mapping(cls, data: Mapping[str, Mapping[str, str]]) -> "OUIRegistry":
        assignments: Dict[int, Dict[str, str]] = {}
        for bits, entries in data.items():
            try:
                prefix_bits = int(bits)
            except (TypeError, ValueError):
                continue

            normalized_entries: Dict[str, str] = {}
            for prefix, organization in entries.items():
                normalized_prefix = _normalize_assignment(prefix)
                normalized_organization = (organization or "").strip()
                if normalized_prefix and normalized_organization:
                    normalized_entries[normalized_prefix] = normalized_organization

            assignments[prefix_bits] = dict(sorted(normalized_entries.items()))
        return cls(assignments)

    @classmethod
    def from_file(cls, path: Path) -> "OUIRegistry":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls.from_mapping(payload.get("assignments", {}))

    def lookup(self, mac: str) -> Optional[OUIRecord]:
        normalized_mac = _normalize_hex(mac)
        if not normalized_mac:
            return None
        if _is_locally_administered(normalized_mac):
            return None

        for bits, digits in ((36, 9), (28, 7), (24, 6)):
            assignment = normalized_mac[:digits]
            organization = self._assignments.get(bits, {}).get(assignment)
            if organization:
                return OUIRecord(
                    organization=organization,
                    assignment=assignment,
                    prefix_bits=bits,
                )
        return None


@lru_cache(maxsize=1)
def _load_oui_registry() -> OUIRegistry:
    if not _DATA_PATH.exists():
        return OUIRegistry({})
    return OUIRegistry.from_file(_DATA_PATH)


def get_oui_record(mac: str) -> Optional[OUIRecord]:
    return _load_oui_registry().lookup(mac)

