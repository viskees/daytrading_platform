from django.db import models
from django.conf import settings

class UserSettings(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="settings")
    entry_time = models.DateTimeField(auto_now_add=True)
    dark_mode = models.BooleanField(default=False)
    max_risk_per_trade_pct = models.DecimalField(max_digits=5, decimal_places=2, default=2.00)
    max_daily_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, default=4.00)
    max_trades_per_day = models.PositiveIntegerField(default=10)

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
    def realized_pnl(self):
        total = 0.0
        for t in self.trades.all():
            total += (float(t.exit_price or 0) - float(t.entry_price)) * (1 if t.side == "LONG" else -1) * t.quantity
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
    status = models.CharField(max_length=6, choices=STATUS_CHOICES, default="OPEN")
    notes = models.TextField(blank=True)




    strategy_tags = models.ManyToManyField(StrategyTag, related_name="trades", blank=True)


    class Meta:
        ordering = ["-entry_time"]

    @property
    def risk_per_share(self):
        if self.stop_price is not None:

            return round(abs(float(self.entry_price) - float(self.stop_price)), 4)
        return 0.0

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
