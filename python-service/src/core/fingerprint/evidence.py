from dataclasses import asdict, dataclass
from typing import Literal


EvidenceStrength = Literal["weak", "medium", "strong", "explicit"]
ProfileStatus = Literal["high", "medium", "unknown"]


@dataclass(frozen=True)
class ProfileEvidence:
    source: str
    group: str
    field: str
    value: str
    strength: EvidenceStrength
    observed_at: str

    def to_dict(self) -> dict:
        return asdict(self)


__all__ = ["EvidenceStrength", "ProfileEvidence", "ProfileStatus"]
