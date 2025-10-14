from rest_framework.exceptions import APIException
from rest_framework import viewsets, mixins, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.utils.timezone import now
from .models import JournalDay, Trade, StrategyTag, Attachment, UserSettings, AccountAdjustment
from .serializers import UserSettingsSerializer, JournalDaySerializer, TradeSerializer, StrategyTagSerializer, AttachmentSerializer, AccountAdjustmentSerializer
from django_filters.rest_framework import DjangoFilterBackend
from django.db import IntegrityError
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.serializers import ValidationError
from django.db.models import Q
from decimal import Decimal


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Conflict"
    default_code = "conflict"

class UserSettingsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        return Response(UserSettingsSerializer(obj).data)

    @action(detail=False, methods=["patch"])
    def me(self, request):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def update(self, request, pk=None):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

     # PATCH /api/journal/settings/{id}/
    def partial_update(self, request, pk=None):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

class JournalDayViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = JournalDaySerializer

    def get_queryset(self):
        qs = JournalDay.objects.filter(user=self.request.user)
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start and end:
            qs = qs.filter(date__gte=start, date__lte=end)
        elif start:
            qs = qs.filter(date__gte=start)
        elif end:
            qs = qs.filter(date__lte=end)

        # existing single-date filter kept for backwards compatibility
        single_date = self.request.query_params.get("date")
        if single_date:
            qs = qs.filter(date=single_date)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def partial_update(self, request, *args, **kwargs):
        """
        Allow updating day_start_equity only for TODAY and only by owner.
        """
        instance = self.get_object()
        if instance.user_id != request.user.id:
            raise PermissionDenied("Forbidden")
        # Lock past days to keep audit story clean
        if instance.date != now().date():
            return Response(
                {"code": "LOCKED_DAY", "detail": "You can edit day_start_equity only for today."},
                status=status.HTTP_403_FORBIDDEN,
            )
        data = {}
        if "day_start_equity" in request.data:
            try:
                val = float(request.data["day_start_equity"])
            except Exception:
                raise ValidationError({"day_start_equity": "Must be numeric."})
            if val < 0:
                raise ValidationError({"day_start_equity": "Must be >= 0."})
            data["day_start_equity"] = val
        ser = self.get_serializer(instance, data=data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(self.get_serializer(instance).data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        date = serializer.validated_data["date"]
        obj, created = JournalDay.objects.get_or_create(user=request.user, date=date)
        ser = self.get_serializer(obj)
        data = ser.data | {"existing": (not created)}
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(data, status=code)

class TradeViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TradeSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    # richer filters so the Journal tab can do date ranges, ticker search, etc.
    filterset_fields = {
        "status": ["exact"],
        "journal_day": ["exact"],
        "journal_day__date": ["exact", "gte", "lte"],
        "ticker": ["iexact", "icontains"],
        "side": ["exact"],
    }
    ordering_fields = ["entry_time", "exit_time", "ticker", "id"]
    # default when no ?ordering=… is provided
    ordering = ["-entry_time"]
    search_fields = ["ticker", "notes"]

    def get_queryset(self):
        qs = (Trade.objects.filter(user=self.request.user)
              .prefetch_related("strategy_tags"))
        day_id = self.request.query_params.get("journal_day")
        status_f = self.request.query_params.get("status")
        if day_id:
            qs = qs.filter(journal_day_id=day_id)
        if status_f:
            qs = qs.filter(status=status_f)
        return qs

    def perform_create(self, serializer):
        day = serializer.validated_data.get("journal_day")
        if day.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
         # --- Risk checks (entry only; never block closes) ---
        # Always have a policy row; prevents hard-failing with "not configured"
        policy, _ = UserSettings.objects.get_or_create(user=self.request.user)

        qty = serializer.validated_data.get("quantity") or 0
        entry = serializer.validated_data.get("entry_price")
        stop  = serializer.validated_data.get("stop_price")

        # Per-trade risk % (only if inputs are present and equity > 0)
        try:
            effective_equity = float(day.effective_equity or 0.0)
            if effective_equity > 0 and (
                entry is not None
                and stop is not None
                and qty not in (None, 0)
                and policy.max_risk_per_trade_pct is not None
            ):
                rps = abs(float(entry) - float(stop))
                if rps > 0:
                    per_trade_risk = rps * float(qty)
                    per_trade_risk_pct = (per_trade_risk / effective_equity) * 100.0
                    if float(per_trade_risk_pct) > float(policy.max_risk_per_trade_pct):
                        detail = {
                            "code": "RISK_VIOLATION_PER_TRADE",
                            "detail": f"Per-trade risk {per_trade_risk_pct:.2f}% exceeds max {float(policy.max_risk_per_trade_pct):.2f}%.",
                            "data": {
                                "per_trade_risk_pct": round(per_trade_risk_pct, 4),
                                "max_risk_per_trade_pct": float(policy.max_risk_per_trade_pct),
                                "quantity": float(qty),
                                "entry_price": float(entry),
                                "stop_price": float(stop),
                                "effective_equity": effective_equity,
                            },
                        }
                        raise Conflict(detail)
        except Exception:
            # Any numeric conversion hiccup -> don't block creation
            pass

        # Daily loss guard (uses effective equity)
        # realized PnL today from CLOSED trades
        todays_closed = day.trades.filter(status="CLOSED")
        realized = 0.0
        for t in todays_closed:
            if t.exit_price is None or t.stop_price is None:
                continue
            move = float(t.exit_price - t.entry_price)
            if t.side == "SHORT":
                move = -move
            realized += move * float(t.quantity)
        eff_eq_for_loss = float(day.effective_equity or 0.0)
        if eff_eq_for_loss > 0 and policy.max_daily_loss_pct is not None:
            daily_loss_pct = (max(0.0, -float(realized)) / eff_eq_for_loss) * 100.0
            if float(daily_loss_pct) >= float(policy.max_daily_loss_pct):
                detail = {
                    "code": "RISK_VIOLATION_DAILY_LOSS",
                    "detail": f"Daily loss {daily_loss_pct:.2f}% reached limit {float(policy.max_daily_loss_pct):.2f}%.",
                    "data": {
                        "daily_loss_pct": round(daily_loss_pct, 4),
                        "max_daily_loss_pct": float(policy.max_daily_loss_pct),
                        "effective_equity": eff_eq_for_loss,
                        "realized_pnl_today": round(float(realized), 2),
                    },
                }
                raise Conflict(detail)

        # Trades-per-day guard
        if policy.max_trades_per_day:
            open_or_closed_today = day.trades.count()
            if open_or_closed_today >= int(policy.max_trades_per_day):
                detail = {
                    "code": "RISK_VIOLATION_MAX_TRADES",
                    "detail": f"Max trades per day ({int(policy.max_trades_per_day)}) reached.",
                    "data": {"trades_today": open_or_closed_today},
                }
                raise Conflict(detail)

        serializer.save(user=self.request.user, entry_time=timezone.now())

    def perform_update(self, serializer):
        day = serializer.validated_data.get("journal_day", serializer.instance.journal_day)
        if day.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
        trade = serializer.save(user=self.request.user)
        # If client sets status CLOSED but didn't send exit_time, set it now
        if trade.status == "CLOSED" and not trade.exit_time:
            trade.close(exit_price=trade.exit_price)  # will set exit_time=now()

    @action(detail=False, methods=["get"], url_path="status/today")
    def status_today(self, request):
        """
        Dashboard widget: risk usage + session stats for the current JournalDay.
        Returns: {trades, win_rate, avg_r, best_r, worst_r, daily_loss_pct, used_daily_risk_pct}
        """
        from django.utils.timezone import now
        today = now().date()
        day = JournalDay.objects.filter(user=request.user, date=today).first()
        if not day:
            return Response({
                "trades": 0, "win_rate": 0.0, "avg_r": 0.0,
                "best_r": 0.0, "worst_r": 0.0,
                "daily_loss_pct": 0.0, "used_daily_risk_pct": 0.0,
                "effective_equity": 0.0,
                "adjustments_total": 0.0,
            })

        trades = day.trades.all()
        closed = trades.filter(status="CLOSED")
        r_list = []
        realized_pnl = 0.0
        for t in closed:
            r = t.r_multiple
            if r is not None:
                r_list.append(r)
            if t.exit_price is not None:
                move = float(t.exit_price - t.entry_price)
                if t.side == "SHORT":
                    move = -move
                realized_pnl += move * float(t.quantity)
        wins = sum(1 for r in r_list if r > 0)
        total = len(r_list)
        win_rate = (wins / total * 100.0) if total else 0.0
        avg_r = (sum(r_list) / total) if total else 0.0
        best_r = max(r_list) if r_list else 0.0
        worst_r = min(r_list) if r_list else 0.0
        daily_loss_pct = 0.0
        used_daily_risk_pct = 0.0
        eff_eq = float(day.effective_equity or 0.0)
        if eff_eq > 0:
            daily_loss_pct = max(0.0, -realized_pnl) / eff_eq * 100.0
            used_daily_risk_pct = daily_loss_pct  # same concept for the bar
        return Response({
            "trades": trades.count(),
            "win_rate": win_rate,
            "avg_r": avg_r,
            "best_r": best_r,
            "worst_r": worst_r,
            "daily_loss_pct": daily_loss_pct,
            "used_daily_risk_pct": used_daily_risk_pct,
            "effective_equity": eff_eq,
            "adjustments_total": float(day.adjustments_total),
        })

    @action(detail=False, methods=["get"], url_path="account/summary")
    def account_summary(self, request):
        """
        Simple account summary used by the dashboard:
        {
          pl_today: number,
          pl_total: number,
          equity_today: number,
          equity_last_close: number|null
        }
        """
        user = request.user
        today = now().date()
        day = JournalDay.objects.filter(user=user, date=today).first()

        # Realized P/L today = sum over CLOSED trades for today's JournalDay
        pl_today = 0.0
        if day:
            for t in day.trades.filter(status="CLOSED"):
                if t.exit_price is None:
                    continue
                move = float(t.exit_price - t.entry_price)
                if t.side == "SHORT":
                    move = -move
                pl_today += move * float(t.quantity)

        # Total realized P/L across all closed trades for this user
        pl_total = 0.0
        for t in Trade.objects.filter(user=user, status="CLOSED"):
            if t.exit_price is None:
                continue
            move = float(t.exit_price - t.entry_price)
            if t.side == "SHORT":
                move = -move
            pl_total += move * float(t.quantity)

        equity_today = float(day.effective_equity or 0.0) if day else 0.0
        # naive last-close equity: yesterday's day_start_equity if present
        prev_day = JournalDay.objects.filter(user=user, date__lt=today).order_by("-date").first()
        equity_last_close = float(prev_day.day_start_equity or 0.0) if prev_day else None

        return Response({
            "pl_today": round(pl_today, 2),
            "pl_total": round(pl_total, 2),
            "equity_today": round(equity_today, 2),
            "equity_last_close": round(equity_last_close, 2) if equity_last_close is not None else None,
        })

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        trade = self.get_object()
        if trade.user_id != request.user.id:
            raise PermissionDenied("Forbidden")
        exit_price = request.data.get("exit_price")
        if exit_price is None:
            return Response({
                "code": "VALIDATION_ERROR",
                "detail": "exit_price is required"
        }, status=status.HTTP_400_BAD_REQUEST)
        trade.exit_price = exit_price
        if not trade.exit_time:
            trade.exit_time = timezone.now()
            trade.status = "CLOSED"
            trade.save(update_fields=["exit_price", "exit_time", "status"])
        return Response(TradeSerializer(trade).data)

class StrategyTagViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StrategyTagSerializer
    def get_queryset(self):
        return StrategyTag.objects.all()

class AttachmentViewSet(mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]  # <-- add this line

    def get_queryset(self):
        return Attachment.objects.filter(trade__user=self.request.user)

    def perform_create(self, serializer):
        trade = serializer.validated_data.get('trade')
        if trade.user_id != self.request.user.id:
            raise PermissionDenied('Forbidden')
        serializer.save()

class AccountAdjustmentViewSet(mixins.CreateModelMixin,
                               mixins.DestroyModelMixin,
                               mixins.ListModelMixin,
                               viewsets.GenericViewSet):
    """
    Manage deposits / withdrawals / fees / corrections for a given JournalDay.
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AccountAdjustmentSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = {"journal_day": ["exact"]}
    ordering = ["-at_time", "-id"]

    def get_queryset(self):
        return AccountAdjustment.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        jd = serializer.validated_data.get("journal_day")
        if jd.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
        amt = serializer.validated_data.get("amount")
        try:
            if float(amt) == 0.0:
                raise ValidationError({"amount": "Amount cannot be zero."})
        except Exception:
            raise ValidationError({"amount": "Invalid amount."})
        serializer.save(user=self.request.user)
