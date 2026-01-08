from django.db import models
from django.conf import settings
from decimal import Decimal, ROUND_HALF_UP
from django.utils import timezone

class Emotion(models.TextChoices):
    NEUTRAL = "NEUTRAL", "Neutral"
    BIASED  = "BIASED",  "Biased"

class UserSettings(models.Model):
    COMMISSION_PCT = "PCT"
    COMMISSION_FIXED = "FIXED"
    COMMISSION_PER_SHARE = "PER_SHARE"
    COMMISSION_MODE_CHOICES = [
        (COMMISSION_PCT, "Percentage"),
        (COMMISSION_FIXED, "Fixed amount"),
        (COMMISSION_PER_SHARE, "Per share (IBKR fixed-style)"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="settings")
    entry_time = models.DateTimeField(auto_now_add=True)
    dark_mode = models.BooleanField(default=False)
    max_risk_per_trade_pct = models.DecimalField(max_digits=5, decimal_places=2, default=2.00)
    max_daily_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, default=4.00)
    max_trades_per_day = models.PositiveIntegerField(default=10)

    # Commission policy (applied per side: entry + exit)
    commission_mode = models.CharField(
        max_length=16,
        choices=COMMISSION_MODE_CHOICES,
        default=COMMISSION_FIXED,
    )
    # If mode=PCT => percent (e.g. 0.25 means 0.25%)
    # If mode=FIXED => money amount per side
    commission_value = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal("0"))

    # --- NEW: Per-share commission (IBKR fixed-style) ---
    # Applied per side (entry OR exit)
    commission_per_share = models.DecimalField(max_digits=12, decimal_places=6, default=Decimal("0"))
    commission_min_per_side = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    # Optional cap (0 = no cap). Cap is expressed as % of notional.
    commission_cap_pct_of_notional = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0"))


    def commission_for_notional(self, notional: Decimal) -> Decimal:
        """
        Commission amount for ONE side (entry OR exit).
        - PCT: notional * (commission_value/100)
        - FIXED: commission_value
        Returned as money rounded to cents.
        """
        try:
            notional_d = Decimal(str(notional or 0))
            val = Decimal(str(self.commission_value or 0))
            if val <= 0:
                return Decimal("0.00")
            if self.commission_mode == self.COMMISSION_PCT:
                fee = notional_d * (val / Decimal("100"))
            else:
                fee = val
            return fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except Exception:
            return Decimal("0.00")

    def commission_for_side(self, price: Decimal, quantity: int) -> Decimal:
        """
        Commission amount for ONE side (entry OR exit).
        Supports:
          - PCT  => % of notional
          - FIXED => flat money amount per side
          - PER_SHARE => qty * per_share, with optional min + cap(%notional)
        Returned as money rounded to cents.
        """
        try:
            px = Decimal(str(price or 0))
            qty = int(quantity or 0)
            if px <= 0 or qty <= 0:
                return Decimal("0.00")

            notional = px * Decimal(qty)

            if self.commission_mode in (self.COMMISSION_PCT, self.COMMISSION_FIXED):
                return self.commission_for_notional(notional)

            if self.commission_mode == self.COMMISSION_PER_SHARE:
                per_share = Decimal(str(self.commission_per_share or 0))
                if per_share <= 0:
                    return Decimal("0.00")

                fee = per_share * Decimal(qty)

                min_fee = Decimal(str(self.commission_min_per_side or 0))
                if min_fee > 0:
                    fee = max(fee, min_fee)

                cap_pct = Decimal(str(self.commission_cap_pct_of_notional or 0))
                if cap_pct > 0:
                    cap = notional * (cap_pct / Decimal("100"))
                    fee = min(fee, cap)

                return fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            return Decimal("0.00")
        except Exception:
            return Decimal("0.00")

    def __str__(self):
        return f"Settings({self.user})"

class StrategyTag(models.Model):
    name = models.CharField(max_length=64, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

class JournalDay(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="journal_days")
    date = models.DateField()
    day_start_equity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    day_end_equity = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)


    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ("user", "date")
        ordering = ["-date"]

    @property
    def adjustments_total(self) -> Decimal:
        # Sum of all adjustments linked to this JournalDay (nullable until model exists)
        total = Decimal("0")
        if hasattr(self, "adjustments"):
            for a in self.adjustments.all():
                total += a.amount
        return total

    @property
    def effective_equity(self) -> Decimal:
        """
        Effective equity used by risk checks:
        day_start_equity + realized P/L from CLOSED trades (NET) + Σ adjustments_today
        """
        start = Decimal(str(self.day_start_equity or 0))
        realized = Decimal("0")
        for t in self.trades.filter(status="CLOSED"):
            # Use trade.realized_pnl which is NET of commissions (float)
            try:
                realized += Decimal(str(t.realized_pnl or 0))
            except Exception:
                continue
        return start + realized + self.adjustments_total

    @property
    def realized_pnl(self):
        """Realized P/L for the day from CLOSED trades only (NET)."""
        total = 0.0
        for t in self.trades.filter(status="CLOSED"):
            try:
                total += float(t.realized_pnl or 0.0)
            except Exception:
                continue
        return round(total, 2)

    @property
    def max_daily_loss_pct(self):
        # convenience mirror from settings at time of viewing (UI uses this)
        try:
            return float(self.user.settings.max_daily_loss_pct)
        except Exception:
            return 0.0

    @property
    def max_trades(self):
        try:
            return int(self.user.settings.max_trades_per_day)
        except Exception:
            return 0

    @property
    def breach_daily_loss(self):
        try:
            start = float(self.day_start_equity or 0)
            end = float(self.day_end_equity if self.day_end_equity is not None else start + self.realized_pnl)
            if start <= 0:
                return False
            loss_pct = ((start - end) / start) * 100.0
            return loss_pct >= float(self.user.settings.max_daily_loss_pct)
        except Exception:
            return False



    def __str__(self):
        return f"{self.user} {self.date}"

class Trade(models.Model):
    SIDE_CHOICES = [
        ("LONG", "Long"),
        ("SHORT", "Short"),
    ]
    STATUS_CHOICES = [
        ("OPEN", "Open"),
        ("CLOSED", "Closed"),
    ]

    # Single Meta (combine ordering + indexes so indexes aren't lost)
    class Meta:
        ordering = ["-entry_time"]
        indexes = [
            models.Index(fields=["user", "status", "exit_time"]),
        ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trades")
    journal_day = models.ForeignKey(JournalDay, related_name="trades", on_delete=models.CASCADE)
    ticker = models.CharField(max_length=16)
    side = models.CharField(max_length=5, choices=SIDE_CHOICES, default="LONG")
    quantity = models.PositiveIntegerField(default=0)
    entry_price = models.DecimalField(max_digits=10, decimal_places=4)
    stop_price = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    exit_price = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    target_price = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    entry_time = models.DateTimeField()
    exit_time = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=6, choices=STATUS_CHOICES, default="OPEN")
    notes = models.TextField(blank=True)
    entry_emotion = models.CharField(
        max_length=16, choices=Emotion.choices, default=Emotion.NEUTRAL, blank=True
    )
    entry_emotion_note = models.TextField(blank=True, default="")
    exit_emotion = models.CharField(
        max_length=16, choices=Emotion.choices, blank=True, null=True
    )
    exit_emotion_note = models.TextField(blank=True, default="")
    strategy_tags = models.ManyToManyField(StrategyTag, related_name="trades", blank=True)
    # Commission amounts stored per side (money)
    commission_entry = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    commission_exit = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))

    # ----------------------------
    # Scaling support via TradeFill
    # ----------------------------
    def _has_fills(self) -> bool:
        try:
            return hasattr(self, "fills") and self.fills.exists()
        except Exception:
            return False

    def _fills_ordered(self):
        """
        Deterministic ordering for P/L computations.
        Order by timestamp then id to stabilize equal timestamps.
        """
        return self.fills.all().order_by("timestamp", "id")
    
    def _entry_action(self) -> str:
        # "Entry side" action depends on trade side
        # LONG: BUY opens/increases, SHORT: SELL opens/increases
        return TradeFill.ACTION_BUY if self.side == "LONG" else TradeFill.ACTION_SELL

    def _exit_action(self) -> str:
        # "Exit side" action depends on trade side
        return TradeFill.ACTION_SELL if self.side == "LONG" else TradeFill.ACTION_BUY

    def _fills_summary(self):
        """
        Single pass summary for trader-friendly stats.
        Assumptions:
          - No flips (or rare). If flips happen, VWAP entry/exit still reflects side actions,
            but realized P/L uses average-cost logic separately.
        Returns dict of Decimals/ints.
        """
        entry_action = self._entry_action()
        exit_action = self._exit_action()

        entry_qty = 0
        exit_qty = 0
        entry_notional = Decimal("0")
        exit_notional = Decimal("0")

        comm_total = Decimal("0")
        comm_entry = Decimal("0")
        comm_exit = Decimal("0")

        # position tracking for max size
        pos = 0  # signed (BUY +, SELL -)
        max_abs_pos = 0

        for f in self._fills_ordered():
            try:
                qty = int(f.quantity or 0)
                if qty <= 0:
                    continue
                px = Decimal(str(f.price or 0))
                if px <= 0:
                    continue
            except Exception:
                continue

            # commissions
            c = Decimal(str(f.commission or 0))
            if c:
                comm_total += c

            # entry/exit buckets based on trade side
            if f.action == entry_action:
                entry_qty += qty
                entry_notional += (px * Decimal(qty))
                if c:
                    comm_entry += c
            elif f.action == exit_action:
                exit_qty += qty
                exit_notional += (px * Decimal(qty))
                if c:
                    comm_exit += c

            # position tracking (BUY +, SELL - always)
            if f.action == TradeFill.ACTION_BUY:
                pos += qty
            elif f.action == TradeFill.ACTION_SELL:
                pos -= qty
            if abs(pos) > max_abs_pos:
                max_abs_pos = abs(pos)

        return {
            "entry_qty": entry_qty,
            "exit_qty": exit_qty,
            "entry_notional": entry_notional,
            "exit_notional": exit_notional,
            "comm_total": comm_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "comm_entry": comm_entry.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "comm_exit": comm_exit.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "max_abs_pos": int(max_abs_pos),
        }

    @property
    def position_qty_signed(self) -> int:
        """
        Signed remaining position quantity computed from fills.
        LONG: +qty is long, SHORT: -qty is short.
        If no fills exist, falls back to legacy Trade.quantity (signed by side).
        """
        try:
            if not self._has_fills():
                base = int(self.quantity or 0)
                return base if self.side == "LONG" else -base

            pos = 0
            for f in self._fills_ordered():
                qty = int(f.quantity or 0)
                if qty <= 0:
                    continue

                if f.action == TradeFill.ACTION_BUY:
                    pos += qty
                elif f.action == TradeFill.ACTION_SELL:
                    pos -= qty

            # For short trades, we still represent short as negative.
            # The fill stream should already reflect the correct direction
            # (SELL to open => negative pos). We keep it as-is.
            return int(pos)
        except Exception:
            base = int(self.quantity or 0)
            return base if self.side == "LONG" else -base

    @property
    def position_qty(self) -> int:
        """Absolute remaining position size (shares/contracts)."""
        try:
            return abs(int(self.position_qty_signed))
        except Exception:
            return int(self.quantity or 0)

    @property
    def avg_entry_price(self):
        """
        Average open cost of the remaining position computed from fills (float),
        using average-cost method. Returns None if flat.

        Backward-compatible fallback: returns legacy entry_price if no fills exist.
        """
        try:
            if not self._has_fills():
                return float(self.entry_price) if self.entry_price is not None else None

            pos = Decimal("0")  # signed position
            avg_cost = None     # Decimal

            for f in self._fills_ordered():
                qty = int(f.quantity or 0)
                if qty <= 0:
                    continue
                price = Decimal(str(f.price or 0))
                if price <= 0:
                    continue

                # BUY increases pos; SELL decreases pos (signed).
                if f.action == TradeFill.ACTION_BUY:
                    new_pos = pos + Decimal(qty)
                    if pos == 0:
                        avg_cost = price
                    else:
                        # If adding in same direction (pos >= 0), average; if crossing, keep simple.
                        # Crossing behavior will be disallowed/validated in Phase 2.
                        if pos > 0 and new_pos > 0:
                            avg_cost = ((avg_cost * pos) + (price * Decimal(qty))) / new_pos
                        elif pos < 0:
                            # Buying reduces a short; avg_cost unchanged while reducing.
                            pass
                        else:
                            # Crossing through zero: reset avg_cost to the fill price for new direction.
                            avg_cost = price
                    pos = new_pos

                elif f.action == TradeFill.ACTION_SELL:
                    new_pos = pos - Decimal(qty)
                    if pos == 0:
                        avg_cost = price
                    else:
                        if pos < 0 and new_pos < 0:
                            # Adding to a short (more negative): average short "entry" price.
                            avg_cost = ((avg_cost * abs(pos)) + (price * Decimal(qty))) / abs(new_pos)
                        elif pos > 0:
                            # Selling reduces a long; avg_cost unchanged while reducing.
                            pass
                        else:
                            # Crossing through zero: reset avg_cost to the fill price for new direction.
                            avg_cost = price
                    pos = new_pos

            if pos == 0 or avg_cost is None:
                return None

            # Quantize to 4dp for UI consistency with entry_price field
            return float(avg_cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
        except Exception:
            try:
                return float(self.entry_price) if self.entry_price is not None else None
            except Exception:
                return None
    @property
    def vwap_entry(self):
        """
        VWAP of ALL entry-side fills (scale-ins), regardless of current position.
        This is the 'true' average entry a trader expects to see after scaling.
        """
        try:
            if not self._has_fills():
                return float(self.entry_price) if self.entry_price is not None else None
            s = self._fills_summary()
            if s["entry_qty"] <= 0:
                return None
            v = (s["entry_notional"] / Decimal(s["entry_qty"])).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
            return float(v)
        except Exception:
            return None

    @property
    def vwap_exit(self):
        """
        VWAP of ALL exit-side fills (scale-outs).
        On a fully closed trade, this is the 'true' average exit.
        """
        try:
            if not self._has_fills():
                return float(self.exit_price) if self.exit_price is not None else None
            s = self._fills_summary()
            if s["exit_qty"] <= 0:
                return None
            v = (s["exit_notional"] / Decimal(s["exit_qty"])).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
            return float(v)
        except Exception:
            return None

    @property
    def total_entry_qty(self) -> int:
        try:
            if not self._has_fills():
                return int(self.quantity or 0)
            return int(self._fills_summary()["entry_qty"])
        except Exception:
            return int(self.quantity or 0)

    @property
    def total_exit_qty(self) -> int:
        try:
            if not self._has_fills():
                return int(self.quantity or 0) if self.status == "CLOSED" else 0
            return int(self._fills_summary()["exit_qty"])
        except Exception:
            return 0

    @property
    def max_position_qty(self) -> int:
        """Maximum absolute position size reached during the trade (shares/contracts)."""
        try:
            if not self._has_fills():
                return int(self.quantity or 0)
            return int(self._fills_summary()["max_abs_pos"])
        except Exception:
            return int(self.quantity or 0)

    @property
    def commission_total(self) -> float:
        """Total commissions across all fills (NET fees)."""
        try:
            if not self._has_fills():
                fee_e = Decimal(str(self.commission_entry or 0))
                fee_x = Decimal(str(self.commission_exit or 0))
                return float((fee_e + fee_x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            s = self._fills_summary()
            return float(s["comm_total"])
        except Exception:
            return 0.0

    @property
    def commission_entry_total(self) -> float:
        """Entry-side commissions summed from fills (LONG: BUY, SHORT: SELL)."""
        try:
            if not self._has_fills():
                return float(Decimal(str(self.commission_entry or 0)))
            return float(self._fills_summary()["comm_entry"])
        except Exception:
            return 0.0

    @property
    def commission_exit_total(self) -> float:
        """Exit-side commissions summed from fills (LONG: SELL, SHORT: BUY)."""
        try:
            if not self._has_fills():
                return float(Decimal(str(self.commission_exit or 0)))
            return float(self._fills_summary()["comm_exit"])
        except Exception:
            return 0.0

    @property
    def risk_per_share(self):
        """Absolute (entry - stop). None if not computable."""
        try:
            if self.stop_price is None:
                return None
            # Prefer fill-aware entry anchor for risk-per-share
            entry_anchor = self.vwap_entry if self._has_fills() else (float(self.entry_price) if self.entry_price is not None else None)
            if entry_anchor is None:
                return None
            rps = abs(float(entry_anchor) - float(self.stop_price))
            return rps if rps > 0 else None
        except Exception:
            return None

    @property
    def r_multiple(self):
        """
        Per-share R multiple (price-move / risk-per-share), fill-aware.
        This is the 'classic' R that ignores size and commissions.
        """
        try:
            rps = self.risk_per_share
            if rps in (None, 0):
                return None
            # Prefer fill-aware anchors when available
            entry_anchor = self.vwap_entry if self._has_fills() else (float(self.entry_price) if self.entry_price is not None else None)
            exit_anchor = self.vwap_exit if self._has_fills() else (float(self.exit_price) if self.exit_price is not None else None)
            if exit_anchor is None or entry_anchor is None:
                return None
            move = float(exit_anchor) - float(entry_anchor)
            if self.side == "SHORT":
                move = -move
            return round(move / float(rps), 2)
        except Exception:
            return None
        
    @property
    def risk_dollars(self):
        """
        Risk in dollars based on:
          abs(vwap_entry - stop) * max_position_qty
        This matches trader intuition for scaled positions.
        """
        try:
            rps = self.risk_per_share
            if rps in (None, 0):
                return None
            qty = self.max_position_qty
            if qty <= 0:
                return None
            val = Decimal(str(rps)) * Decimal(qty)
            return float(val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        except Exception:
            return None

    @property
    def realized_gross(self) -> float:
        """Realized gross P/L from fills (or legacy), as float."""
        try:
            if self._has_fills():
                realized_gross, _comm = self._realized_gross_and_commission_from_fills()
                return float(realized_gross)
            return float(self.gross_pnl)
        except Exception:
            return 0.0

    @property
    def r_multiple_gross_dollars(self):
        """Gross $R = gross_realized / risk_dollars."""
        try:
            rd = self.risk_dollars
            if rd in (None, 0):
                return None
            return round(float(self.realized_gross) / float(rd), 2)
        except Exception:
            return None

    @property
    def r_multiple_net_dollars(self):
        """Net $R = realized_pnl (net) / risk_dollars."""
        try:
            rd = self.risk_dollars
            if rd in (None, 0):
                return None
            return round(float(self.realized_pnl or 0.0) / float(rd), 2)
        except Exception:
            return None
        
    @property
    def gross_pnl(self) -> Decimal:
        """Gross P/L before commissions (money)."""
        try:
            # If fills exist, compute realized gross based on fills (average-cost method).
            if self._has_fills():
                realized_gross, _comm = self._realized_gross_and_commission_from_fills()
                return realized_gross

            # Legacy path
            if self.exit_price is None or self.entry_price is None or self.quantity in (None, 0):
                return Decimal("0.00")
            move = Decimal(str(self.exit_price)) - Decimal(str(self.entry_price))
            if self.side == "SHORT":
                move = -move
            return (move * Decimal(str(self.quantity))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except Exception:
            return Decimal("0.00")
        
    def _realized_gross_and_commission_from_fills(self):
        """
        Compute realized gross P/L and total commissions from fills using average-cost.
        This returns only REALIZED P/L (from reducing position).

        Notes:
        - Scale validation (e.g., no flips) will be enforced in Phase 2 API layer.
        - This function is defensive and will ignore nonsensical fills (qty<=0, price<=0).
        """
        realized = Decimal("0")
        total_comm = Decimal("0")

        pos = Decimal("0")      # signed position (BUY +, SELL -)
        avg_cost = None         # Decimal average cost for current open position

        for f in self._fills_ordered():
            qty_i = int(f.quantity or 0)
            if qty_i <= 0:
                continue
            qty = Decimal(qty_i)

            price = Decimal(str(f.price or 0))
            if price <= 0:
                continue

            comm = Decimal(str(f.commission or 0))
            if comm:
                total_comm += comm

            if f.action == TradeFill.ACTION_BUY:
                # BUY: increases pos; if pos < 0 it reduces short (realizes P/L)
                if pos < 0 and avg_cost is not None:
                    closing = min(qty, abs(pos))
                    # Short profit: (avg_cost - buy_price) * closing
                    realized += (avg_cost - price) * closing
                    qty_left = qty - closing
                    pos = pos + closing  # pos is negative; adding closing moves towards zero
                    if pos == 0:
                        avg_cost = None
                    # If qty_left flips to long, treat remaining as new position at this price.
                    if qty_left > 0:
                        pos = pos + qty_left  # now positive
                        avg_cost = price
                else:
                    # Adding/increasing long
                    new_pos = pos + qty
                    if pos == 0 or avg_cost is None:
                        avg_cost = price
                    else:
                        # average cost only when adding in same direction
                        if pos > 0 and new_pos > 0:
                            avg_cost = ((avg_cost * pos) + (price * qty)) / new_pos
                        elif pos < 0:
                            # Buying reduces short without realizing (handled above). Defensive.
                            pass
                        else:
                            avg_cost = price
                    pos = new_pos

            elif f.action == TradeFill.ACTION_SELL:
                # SELL: decreases pos; if pos > 0 it reduces long (realizes P/L)
                if pos > 0 and avg_cost is not None:
                    closing = min(qty, pos)
                    # Long profit: (sell_price - avg_cost) * closing
                    realized += (price - avg_cost) * closing
                    qty_left = qty - closing
                    pos = pos - closing
                    if pos == 0:
                        avg_cost = None
                    # If qty_left flips to short, treat remaining as new short position at this price.
                    if qty_left > 0:
                        pos = pos - qty_left  # now negative
                        avg_cost = price
                else:
                    # Adding/increasing short
                    new_pos = pos - qty
                    if pos == 0 or avg_cost is None:
                        avg_cost = price
                    else:
                        if pos < 0 and new_pos < 0:
                            avg_cost = ((avg_cost * abs(pos)) + (price * qty)) / abs(new_pos)
                        elif pos > 0:
                            # Selling reduces long without realizing (handled above). Defensive.
                            pass
                        else:
                            avg_cost = price
                    pos = new_pos

        realized = realized.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_comm = total_comm.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return realized, total_comm


    @property
    def realized_pnl(self):
        """NET P/L (gross - commissions). Returns float for API compatibility."""
        try:
            # If fills exist, compute net realized from fills (realized gross - sum(fill commissions))
            if self._has_fills():
                realized_gross, total_comm = self._realized_gross_and_commission_from_fills()
                net = (realized_gross - total_comm).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                return float(net)

            # Legacy path
            gross = self.gross_pnl
            fee_e = Decimal(str(self.commission_entry or 0))
            fee_x = Decimal(str(self.commission_exit or 0))
            net = (gross - fee_e - fee_x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return float(net)
        except Exception:
            return 0.0

    def __str__(self):
        qty = self.position_qty if self._has_fills() else (self.quantity or 0)
        return f"{self.ticker} {self.side} x{qty}"

    def close(self, *, exit_price=None, exit_time=None):
        """Helper for consistent close semantics."""
        from django.utils import timezone
        if self.status == "CLOSED":
            return
        if exit_price is not None:
            self.exit_price = exit_price
        if not self.exit_time:
            self.exit_time = exit_time or timezone.now()
        self.status = "CLOSED"
        self.save(update_fields=["exit_price", "exit_time", "status"])

class TradeFill(models.Model):
    """
    Per-execution fill for scaling in/out.
    Store entries/exits as BUY/SELL actions (regardless of Trade.side),
    and compute position + realized P/L from the fill stream.
    """
    ACTION_BUY = "BUY"
    ACTION_SELL = "SELL"
    ACTION_CHOICES = [
        (ACTION_BUY, "Buy"),
        (ACTION_SELL, "Sell"),
    ]

    trade = models.ForeignKey(Trade, related_name="fills", on_delete=models.CASCADE)
    timestamp = models.DateTimeField(db_index=True)
    action = models.CharField(max_length=4, choices=ACTION_CHOICES)
    quantity = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=10, decimal_places=4)
    commission = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["timestamp", "id"]
        indexes = [
            models.Index(fields=["trade", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.trade.ticker} {self.action} {self.quantity} @ {self.price}"


class Attachment(models.Model):
    trade = models.ForeignKey(Trade, related_name="attachments", on_delete=models.CASCADE)
    image = models.ImageField(upload_to="journal_attachments/")
    caption = models.CharField(max_length=128, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

class AccountAdjustment(models.Model):
    REASON_DEPOSIT = "DEPOSIT"
    REASON_WITHDRAWAL = "WITHDRAWAL"
    REASON_FEE = "FEE"
    REASON_CORRECTION = "CORRECTION"
    REASON_CHOICES = [
        (REASON_DEPOSIT, "Deposit"),
        (REASON_WITHDRAWAL, "Withdrawal"),
        (REASON_FEE, "Fee"),
        (REASON_CORRECTION, "Correction"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="account_adjustments",
    )
    journal_day = models.ForeignKey(
        JournalDay,
        on_delete=models.CASCADE,
        related_name="adjustments",
    )
    # Keep precision consistent with your day_start_equity/day_end_equity (12,2)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=24, choices=REASON_CHOICES)
    note = models.CharField(max_length=256, blank=True)
    at_time = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-at_time", "-id")

    def __str__(self):
        sign = "+" if self.amount is not None and self.amount >= 0 else ""
        jd = getattr(self.journal_day, "date", "?")
        return f"{jd} {self.reason} {sign}{self.amount}"

