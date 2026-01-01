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
    COMMISSION_MODE_CHOICES = [
        (COMMISSION_PCT, "Percentage"),
        (COMMISSION_FIXED, "Fixed amount"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="settings")
    entry_time = models.DateTimeField(auto_now_add=True)
    dark_mode = models.BooleanField(default=False)
    max_risk_per_trade_pct = models.DecimalField(max_digits=5, decimal_places=2, default=2.00)
    max_daily_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, default=4.00)
    max_trades_per_day = models.PositiveIntegerField(default=10)

    # Commission policy (applied per side: entry + exit)
    commission_mode = models.CharField(
        max_length=8,
        choices=COMMISSION_MODE_CHOICES,
        default=COMMISSION_FIXED,
    )
    # If mode=PCT => percent (e.g. 0.25 means 0.25%)
    # If mode=FIXED => money amount per side
    commission_value = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal("0"))

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


    @property
    def risk_per_share(self):
        """Absolute (entry - stop). None if not computable."""
        try:
            if self.stop_price is None or self.entry_price is None:
                return None
            rps = abs(float(self.entry_price) - float(self.stop_price))
            return rps if rps > 0 else None
        except Exception:
            return None

    @property
    def r_multiple(self):
        """Signed R = (exit-entry)/risk_per_share, SHORT inverts the sign."""
        try:
            rps = self.risk_per_share
            if rps in (None, 0):
                return None
            if self.exit_price is None or self.entry_price is None:
                return None
            move = float(self.exit_price) - float(self.entry_price)
            if self.side == "SHORT":
                move = -move
            return round(move / float(rps), 2)
        except Exception:
            return None
        
    @property
    def gross_pnl(self) -> Decimal:
        """Gross P/L before commissions (money)."""
        try:
            if self.exit_price is None or self.entry_price is None or self.quantity in (None, 0):
                return Decimal("0.00")
            move = Decimal(str(self.exit_price)) - Decimal(str(self.entry_price))
            if self.side == "SHORT":
                move = -move
            return (move * Decimal(str(self.quantity))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except Exception:
            return Decimal("0.00")

    @property
    def realized_pnl(self):
        """NET P/L (gross - commissions). Returns float for API compatibility."""
        try:
            gross = self.gross_pnl
            fee_e = Decimal(str(self.commission_entry or 0))
            fee_x = Decimal(str(self.commission_exit or 0))
            net = (gross - fee_e - fee_x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return float(net)
        except Exception:
            return 0.0

    def __str__(self):
        return f"{self.ticker} {self.side} x{self.quantity}"

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

