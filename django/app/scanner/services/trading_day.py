# scanner/services/trading_day.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

# Exchange/session timezone for US equities
TRADING_TZ = ZoneInfo("America/New_York")

# Your chosen boundary: 04:00 ET
DAY_START_HOUR = 4  # 04:00
DAY_START_MINUTE = 0


@dataclass(frozen=True)
class TradingDay:
    """
    Represents a "scanner trading day" defined by a day-start boundary in ET.
    day_id: YYYYMMDD in America/New_York calendar date of the trading day start.
    start_utc/end_utc: boundaries in UTC.
    """
    day_id: str
    start_utc: datetime
    end_utc: datetime


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def trading_day_for_utc(ts_utc: datetime) -> TradingDay:
    """
    Given a UTC timestamp, compute the scanner trading day using:
      - timezone America/New_York
      - boundary at 04:00 ET

    Rule:
      If local time in ET is >= 04:00, trading day is that local date.
      If local time in ET is <  04:00, trading day is previous local date.
    """
    ts_utc = _ensure_utc(ts_utc)
    ts_et = ts_utc.astimezone(TRADING_TZ)

    boundary_t = time(DAY_START_HOUR, DAY_START_MINUTE, tzinfo=TRADING_TZ)
    boundary_dt = datetime.combine(ts_et.date(), boundary_t)

    if ts_et < boundary_dt:
        day_date = ts_et.date() - timedelta(days=1)
    else:
        day_date = ts_et.date()

    start_et = datetime.combine(day_date, boundary_t)
    end_et = start_et + timedelta(days=1)

    start_utc = start_et.astimezone(timezone.utc)
    end_utc = end_et.astimezone(timezone.utc)

    day_id = day_date.strftime("%Y%m%d")
    return TradingDay(day_id=day_id, start_utc=start_utc, end_utc=end_utc)


def trading_day_id(ts_utc: datetime) -> str:
    return trading_day_for_utc(ts_utc).day_id


def current_trading_day_id(now_utc: datetime | None = None) -> str:
    now_utc = _ensure_utc(now_utc or datetime.now(timezone.utc))
    return trading_day_id(now_utc)