from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Bar1m:
    ts: datetime
    o: float
    h: float
    l: float
    c: float
    v: float