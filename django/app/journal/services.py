
from __future__ import annotations

from decimal import Decimal
from typing import Tuple

from .models import JournalDay


def get_or_create_journal_day_with_carry(user, date) -> Tuple[JournalDay, bool]:
    """Create/return JournalDay for (user, date) and carry forward equity if created.

    This centralizes the carry-forward logic so ALL code paths (including
    overnight trade closure) create consistent JournalDays.
    """

    obj, created = JournalDay.objects.get_or_create(user=user, date=date)

    if created:
        prev = (
            JournalDay.objects.filter(user=user, date__lt=date)
            .order_by("-date")
            .first()
        )

        # Only auto-carry if the new day has no meaningful start equity yet.
        try:
            current_start = Decimal(str(obj.day_start_equity or 0))
        except Exception:
            current_start = Decimal("0")

        if prev and current_start == Decimal("0"):
            if prev.day_end_equity is not None:
                carry = Decimal(str(prev.day_end_equity))
            else:
                # Prefer effective_equity (start + realized P/L + adjustments)
                try:
                    carry = Decimal(str(prev.effective_equity))
                except Exception:
                    carry = Decimal(str(prev.day_start_equity or 0))

            obj.day_start_equity = carry
            obj.save(update_fields=["day_start_equity"])

    return obj, created