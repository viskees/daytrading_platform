from django.db import models

class StrategyTag(models.Model):
    name = models.CharField(max_length=64, unique=True)

    def __str__(self):
        return self.name

class JournalDay(models.Model):
    date = models.DateField(unique=True)
    day_start_equity = models.DecimalField(max_digits=14, decimal_places=2)
    day_end_equity = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    max_daily_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, default=4.00)  # e.g. 4%
    max_trades = models.PositiveIntegerField(default=10)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date"]

    @property
    def realized_pnl(self):
        agg = sum(t.realized_pnl for t in self.trades.all())
        return round(agg, 2)

    @property
    def breach_daily_loss(self):
        if self.day_start_equity is None:
            return False
        loss_limit = float(self.day_start_equity) * float(self.max_daily_loss_pct) / 100.0
        return self.realized_pnl <= -loss_limit

    def __str__(self):
        return f"{self.date}"

class Trade(models.Model):
    SIDE_CHOICES = [
        ("LONG", "Long"),
        ("SHORT", "Short"),
    ]

    journal_day = models.ForeignKey(JournalDay, related_name="trades", on_delete=models.CASCADE)
    ticker = models.CharField(max_length=16)
    side = models.CharField(max_length=5, choices=SIDE_CHOICES)
    entry_time = models.DateTimeField()
    exit_time = models.DateTimeField(null=True, blank=True)
    entry_price = models.DecimalField(max_digits=12, decimal_places=4)
    exit_price = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    quantity = models.IntegerField()
    fees = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    risk_per_share = models.DecimalField(max_digits=12, decimal_places=4, default=0)  # your "R" basis
    strategy_tags = models.ManyToManyField(StrategyTag, blank=True)
    comment = models.TextField(blank=True)

    class Meta:
        ordering = ["-entry_time"]

    @property
    def realized_pnl(self):
        if self.exit_price is None:
            return 0
        gross = (float(self.exit_price) - float(self.entry_price)) * (self.quantity if self.side == "LONG" else -self.quantity)
        return round(gross - float(self.fees), 2)

    @property
    def r_multiple(self):
        if self.risk_per_share and self.exit_price is not None:
            per_share = (float(self.exit_price) - float(self.entry_price)) * (1 if self.side == "LONG" else -1)
            return round(per_share / float(self.risk_per_share), 2)
        return 0.0

    def __str__(self):
        return f"{self.ticker} {self.side} x{self.quantity}"

class Attachment(models.Model):
    trade = models.ForeignKey(Trade, related_name="attachments", on_delete=models.CASCADE)
    image = models.ImageField(upload_to="journal_attachments/")
    caption = models.CharField(max_length=128, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
