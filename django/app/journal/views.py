from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework import viewsets, mixins, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.serializers import ValidationError
from django_filters.rest_framework import DjangoFilterBackend

from django.utils import timezone

from django.utils.timezone import now
from datetime import datetime
from decimal import Decimal
from django.db import transaction

from django.db.models import (
    Q,
    F,
    Sum,
    Avg,
    Max,
    Min,
    Count,
    Case,
    When,
    IntegerField,
    FloatField,
    ExpressionWrapper,
)
from django.db.models.functions import TruncDate

from .models import (
    JournalDay,
    Trade,
    TradeFill,
    StrategyTag,
    Attachment,
    UserSettings,
    AccountAdjustment,
)
from .serializers import (
    UserSettingsSerializer,
    JournalDaySerializer,
    TradeSerializer,
    TradeScaleSerializer,
    StrategyTagSerializer,
    AttachmentSerializer,
    AccountAdjustmentSerializer,
)

from .services import get_or_create_journal_day_with_carry


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Conflict"
    default_code = "conflict"


# --- Object-level permission to ensure only the owner can access a Trade object ---
class IsOwnerOfTrade(permissions.BasePermission):
    """
    Allows access only to the owner of the Trade.
    Works with DRF's object-permission flow (retrieve/update/destroy).
    """

    def has_object_permission(self, request, view, obj):
        try:
            return obj.user_id == request.user.id
        except Exception:
            return False


class UserSettingsViewSet(viewsets.ViewSet):
    """
    Per-user risk & UI settings.
    Always scoped to request.user via get_or_create(user=request.user).
    """

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
    """
    JournalDay is strictly per-user:
      - Queries are filtered by user=request.user
      - Creation forces user=request.user
    """

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
        instance = self.get_object()  # already scoped to request.user via get_queryset
        if instance.user_id != request.user.id:
            raise PermissionDenied("Forbidden")

        # Lock past days to keep audit story clean
        if instance.date != timezone.localdate():
            return Response(
                {
                    "code": "LOCKED_DAY",
                    "detail": "You can edit day_start_equity only for today.",
                },
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
        """
        Idempotent creation: for a given date, return/create the JournalDay
        for the current user, and auto-carry forward equity from the previous day.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        date = serializer.validated_data["date"]

        # Create-or-return the day row (with carry-forward equity if created)
        obj, created = get_or_create_journal_day_with_carry(request.user, date)

        ser = self.get_serializer(obj)
        data = ser.data | {"existing": (not created)}
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(data, status=code)


class TradeViewSet(viewsets.ModelViewSet):
    """
    Trades are strictly per-user:
      - get_queryset() filters by user
      - create/update/close enforce ownership on the associated JournalDay
      - object-level permission double-checks on retrieve/update/destroy
    """

    permission_classes = [permissions.IsAuthenticated, IsOwnerOfTrade]
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
    ordering = ["-entry_time"]  # default when no ?ordering=… is provided
    search_fields = ["ticker", "notes"]

    def get_queryset(self):
        qs = Trade.objects.filter(user=self.request.user).prefetch_related("strategy_tags")
        params = self.request.query_params

        # existing filters
        day_id = params.get("journal_day")
        status_f = params.get("status")
        if day_id:
            qs = qs.filter(journal_day_id=day_id)
        if status_f:
            qs = qs.filter(status=status_f)

        # ---- compatibility aliases for date filtering ----
        # Support ?date=YYYY-MM-DD
        exact_date = params.get("date")
        if exact_date:
            qs = qs.filter(journal_day__date=exact_date)

        # Support ?date_from=&date_to= (mapped to gte/lte on journal_day__date)
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from:
            qs = qs.filter(journal_day__date__gte=date_from)
        if date_to:
            qs = qs.filter(journal_day__date__lte=date_to)

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
        stop = serializer.validated_data.get("stop_price")

        # Per-trade risk % (only if inputs are present and equity > 0)
        try:
            effective_equity = float(day.effective_equity or 0.0)
            if (
                effective_equity > 0
                and entry is not None
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
                            "detail": (
                                f"Per-trade risk {per_trade_risk_pct:.2f}% exceeds "
                                f"max {float(policy.max_risk_per_trade_pct):.2f}%."
                            ),
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
            try:
                realized += float(t.realized_pnl or 0.0)
            except Exception:
                continue

        eff_eq_for_loss = float(day.effective_equity or 0.0)
        if eff_eq_for_loss > 0 and policy.max_daily_loss_pct is not None:
            daily_loss_pct = (max(0.0, -float(realized)) / eff_eq_for_loss) * 100.0
            if float(daily_loss_pct) >= float(policy.max_daily_loss_pct):
                detail = {
                    "code": "RISK_VIOLATION_DAILY_LOSS",
                    "detail": (
                        f"Daily loss {daily_loss_pct:.2f}% reached limit "
                        f"{float(policy.max_daily_loss_pct):.2f}%."
                    ),
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

    # ---------------------------
    # Scaling / fills helpers
    # ---------------------------
    def _ensure_aware_dt(self, dt):
        if dt is None:
            return timezone.now()
        if timezone.is_naive(dt):
            return timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    def _ensure_bootstrap_entry_fill(self, trade: Trade):
        """
        If a legacy trade has no fills yet, create an initial entry fill from legacy entry fields.
        Safe to call repeatedly.
        """
        if not hasattr(trade, "fills"):
            return
        if trade.fills.exists():
            return
        if trade.quantity and trade.entry_price and trade.entry_time:
            bootstrap_action = TradeFill.ACTION_BUY if trade.side == "LONG" else TradeFill.ACTION_SELL
            TradeFill.objects.create(
                trade=trade,
                timestamp=trade.entry_time,
                action=bootstrap_action,
                quantity=int(trade.quantity),
                price=Decimal(str(trade.entry_price)),
                commission=Decimal(str(trade.commission_entry or 0)).quantize(Decimal("0.01")),
                note="(bootstrap from legacy entry)",
            )

    def _reattach_to_exit_day(self, trade: Trade, user, exit_time):
        exit_time = self._ensure_aware_dt(exit_time)
        exit_date = timezone.localdate(exit_time)
        jd, _ = get_or_create_journal_day_with_carry(user, exit_date)
        trade.journal_day = jd

    def _sync_legacy_fields_from_fills(self, trade: Trade, fallback_exit_price=None):
        """
        Keep legacy fields consistent for older UI/reporting after scaling/fills.
        """
        vwap_entry = trade.vwap_entry
        vwap_exit = trade.vwap_exit
        max_qty = trade.max_position_qty

        if vwap_entry is not None:
            trade.entry_price = Decimal(str(vwap_entry))

        if vwap_exit is not None:
            trade.exit_price = Decimal(str(vwap_exit))
        elif fallback_exit_price is not None:
            trade.exit_price = Decimal(str(fallback_exit_price))

        if max_qty and int(max_qty) > 0:
            trade.quantity = int(max_qty)

        # Commission compatibility: store entry/exit totals from fills
        try:
            trade.commission_entry = Decimal(str(trade.commission_entry_total or 0)).quantize(Decimal("0.01"))
            trade.commission_exit = Decimal(str(trade.commission_exit_total or 0)).quantize(Decimal("0.01"))
        except Exception:
            pass

    def _close_trade_with_fills(
        self,
        *,
        trade: Trade,
        user,
        exit_time,
        exit_price,
        note="(close remaining position)",
        commission_override=None,
    ):
        """
        Canonical close path for trades that may have fills (scaling).

        - Ensures bootstrap fill exists for legacy trades
        - If remaining position > 0, creates the final exit fill for the remaining qty
        - Reattaches the trade to the JournalDay of local exit date
        - Sets CLOSED + exit_time
        - Syncs legacy fields (entry/exit VWAP, max size, commission totals)
        """
        exit_time = self._ensure_aware_dt(exit_time)
        exit_price = Decimal(str(exit_price))

        policy, _ = UserSettings.objects.get_or_create(user=user)

        # If fills are in play, make sure we have an entry fill
        if hasattr(trade, "fills"):
            self._ensure_bootstrap_entry_fill(trade)

        # Remaining position at time of close (computed from fills if present)
        remaining = int(trade.position_qty or 0)

        # Create final exit fill for remaining qty (only if needed)
        if remaining > 0 and hasattr(trade, "fills"):
            exit_action = TradeFill.ACTION_SELL if trade.side == "LONG" else TradeFill.ACTION_BUY

            if commission_override is not None:
                fill_commission = Decimal(str(commission_override or 0)).quantize(Decimal("0.01"))
            else:
                fill_commission = policy.commission_for_side(price=exit_price, quantity=remaining)

            TradeFill.objects.create(
                trade=trade,
                timestamp=exit_time,
                action=exit_action,
                quantity=remaining,
                price=exit_price,
                commission=Decimal(str(fill_commission or 0)).quantize(Decimal("0.01")),
                note=note,
            )

        # Refresh computed properties (position_qty, VWAPs, totals, etc.)
        trade.refresh_from_db()

        # Close + reattach
        trade.status = "CLOSED"
        trade.exit_time = exit_time
        self._reattach_to_exit_day(trade, user, exit_time)

        # Keep legacy fields consistent with fills
        if hasattr(trade, "fills") and trade.fills.exists():
            self._sync_legacy_fields_from_fills(trade, fallback_exit_price=exit_price)
        else:
            # Non-fill trade: just set last known exit
            trade.exit_price = exit_price

        trade.save(
            update_fields=[
                "journal_day",
                "status",
                "exit_time",
                "entry_price",
                "exit_price",
                "quantity",
                "commission_entry",
                "commission_exit",
            ]
        )


    def perform_update(self, serializer):
        day = serializer.validated_data.get("journal_day", serializer.instance.journal_day)
        if day.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")

        trade = serializer.save(user=self.request.user)
        # If client sets status CLOSED but didn't send exit_time, set it now
        if trade.status == "CLOSED" and not trade.exit_time:
            trade.close(exit_price=trade.exit_price)  # will set exit_time=now()
    
    @action(detail=True, methods=["post"])
    def scale(self, request, pk=None):
        """
        POST /api/journal/trades/{id}/scale/
        Body:
          {
            direction: "IN" | "OUT",
            quantity: int (>0),
            price: decimal (>0),
            timestamp?: datetime (defaults to now),
            note?: str,
            commission?: decimal (optional override)
          }

        Behavior:
        - Bootstraps initial TradeFill for legacy trades (no fills yet) using entry fields.
        - Creates a new TradeFill for the requested scale.
        - Validates ownership + OPEN status + scale-out <= remaining position.
        - Enforces no "flip" by disallowing scale-out beyond remaining.
        - On flat (remaining qty == 0): auto-close trade, set exit_time, exit_price, status,
          and reattach trade to JournalDay of the local exit date (overnight-safe).
        """
        trade: Trade = self.get_object()  # object perms apply (IsOwnerOfTrade)
        if trade.user_id != request.user.id:
            raise PermissionDenied("Forbidden")

        if trade.status != "OPEN":
            return Response(
                {"code": "TRADE_NOT_OPEN", "detail": "Only OPEN trades can be scaled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        in_ser = TradeScaleSerializer(data=request.data, context={"request": request})
        in_ser.is_valid(raise_exception=True)
        direction = in_ser.validated_data["direction"]
        qty = int(in_ser.validated_data["quantity"])
        price = Decimal(str(in_ser.validated_data["price"]))
        ts = in_ser.validated_data.get("timestamp") or timezone.now()
        note = in_ser.validated_data.get("note", "") or ""
        commission_override = in_ser.validated_data.get("commission", None)

        # Ensure tz-aware timestamp (DRF typically gives aware if USE_TZ=True)
        if timezone.is_naive(ts):
            ts = timezone.make_aware(ts, timezone.get_current_timezone())

        # Decide BUY/SELL action based on trade.side and direction.
        # LONG: IN=BUY, OUT=SELL
        # SHORT: IN=SELL, OUT=BUY
        if trade.side == "LONG":
            action = TradeFill.ACTION_BUY if direction == TradeScaleSerializer.DIRECTION_IN else TradeFill.ACTION_SELL
        else:
            action = TradeFill.ACTION_SELL if direction == TradeScaleSerializer.DIRECTION_IN else TradeFill.ACTION_BUY

        # Commission per fill: default compute from user policy unless override provided.
        policy, _ = UserSettings.objects.get_or_create(user=request.user)
        if commission_override is not None:
            fill_commission = Decimal(str(commission_override or 0)).quantize(Decimal("0.01"))
        else:
            fill_commission = policy.commission_for_side(price=price, quantity=qty)

        with transaction.atomic():
            # --- Bootstrap: if no fills exist, create initial entry fill from legacy fields ---
            self._ensure_bootstrap_entry_fill(trade)

            # Current remaining position (after bootstrap)
            remaining = int(trade.position_qty or 0)

            # Validate scale-out does not exceed remaining
            if direction == TradeScaleSerializer.DIRECTION_OUT:
                if remaining <= 0:
                    return Response(
                        {"code": "NO_POSITION", "detail": "Cannot scale out: position is already flat."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if qty > remaining:
                    return Response(
                        {
                            "code": "SCALE_OUT_TOO_LARGE",
                            "detail": f"Cannot scale out {qty}; remaining position is {remaining}.",
                            "data": {"remaining_qty": remaining, "requested_qty": qty},
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

            # Risk check on scale-in (mirrors create logic; does not block scale-out / closes)
            if direction == TradeScaleSerializer.DIRECTION_IN:
                try:
                    day = trade.journal_day
                    effective_equity = float(day.effective_equity or 0.0)
                    stop = trade.stop_price
                    if (
                        effective_equity > 0
                        and stop is not None
                        and policy.max_risk_per_trade_pct is not None
                    ):
                        new_qty = remaining + qty
                        rps = abs(float(price) - float(stop))  # use this fill's price as incremental entry reference
                        # More conservative: use trade.avg_entry_price if available after fill; but we check pre-fill.
                        if rps > 0:
                            per_trade_risk = rps * float(new_qty)
                            per_trade_risk_pct = (per_trade_risk / effective_equity) * 100.0
                            if float(per_trade_risk_pct) > float(policy.max_risk_per_trade_pct):
                                detail = {
                                    "code": "RISK_VIOLATION_PER_TRADE",
                                    "detail": (
                                        f"Per-trade risk {per_trade_risk_pct:.2f}% exceeds "
                                        f"max {float(policy.max_risk_per_trade_pct):.2f}%."
                                    ),
                                    "data": {
                                        "per_trade_risk_pct": round(per_trade_risk_pct, 4),
                                        "max_risk_per_trade_pct": float(policy.max_risk_per_trade_pct),
                                        "new_quantity": int(new_qty),
                                        "price": float(price),
                                        "stop_price": float(stop),
                                        "effective_equity": effective_equity,
                                    },
                                }
                                raise Conflict(detail)
                except Conflict:
                    raise
                except Exception:
                    # never hard-fail on numeric weirdness
                    pass

            # Create the scale fill
            TradeFill.objects.create(
                trade=trade,
                timestamp=ts,
                action=action,
                quantity=qty,
                price=price,
                commission=fill_commission,
                note=note,
            )

            # Refresh trade computations (properties read from DB)
            trade.refresh_from_db()

            # Auto-close if flat after scaling
            if int(trade.position_qty or 0) == 0:
                # Position already flat; no extra exit fill needed here.
                # We still need to reattach to the correct day + sync legacy fields.
                self._close_trade_with_fills(
                    trade=trade,
                    user=request.user,
                    exit_time=ts,
                    exit_price=price,
                    note="(auto-close on flat after scale)",
                    commission_override=None,
                )

        return Response(self.get_serializer(trade).data, status=status.HTTP_200_OK)


    @action(detail=False, methods=["get"], url_path="status/today")
    def status_today(self, request):
        """
        Dashboard widget: risk usage + session stats for the current JournalDay.
        Returns: {trades, win_rate, avg_r, best_r, worst_r, daily_loss_pct, used_daily_risk_pct}
        """
        today = timezone.localdate()
        day = JournalDay.objects.filter(user=request.user, date=today).first()
        if not day:
            return Response(
                {
                    "trades": 0,
                    "win_rate": 0.0,
                    "avg_r": 0.0,
                    "best_r": 0.0,
                    "worst_r": 0.0,
                    "daily_loss_pct": 0.0,
                    "used_daily_risk_pct": 0.0,
                    "effective_equity": 0.0,
                    "adjustments_total": 0.0,
                }
            )

        trades = day.trades.all()
        closed = trades.filter(status="CLOSED")
        r_list = []
        realized_pnl = 0.0
        for t in closed:
            r = t.r_multiple
            if r is not None:
                r_list.append(r)
            try:
                realized_pnl += float(t.realized_pnl or 0.0)
            except Exception:
                continue

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

        # --- Max Drawdown (intraday, based on realized P/L sequence) ---
        start_eq = float(day.day_start_equity or 0.0) + float(day.adjustments_total or 0.0)

        running_eq = start_eq
        peak_eq = running_eq
        max_dd = 0.0

        # Closed trades ordered by exit_time represent the realized equity curve for the day
        closed_for_curve = (
            day.trades.filter(status="CLOSED")
            .exclude(exit_time__isnull=True)
            .order_by("exit_time", "id")
        )

        for t in closed_for_curve:
            try:
                running_eq += float(t.realized_pnl or 0.0)
            except Exception:
                continue
            
            if running_eq > peak_eq:
                peak_eq = running_eq

            dd = peak_eq - running_eq
            if dd > max_dd:
                max_dd = dd

        max_dd_pct = (max_dd / peak_eq * 100.0) if peak_eq > 0 else 0.0

        return Response(
            {
                "trades": trades.count(),
                "win_rate": win_rate,
                "avg_r": avg_r,
                "best_r": best_r,
                "worst_r": worst_r,
                "max_dd_pct": max_dd_pct,
                "daily_loss_pct": daily_loss_pct,
                "used_daily_risk_pct": used_daily_risk_pct,
                "effective_equity": eff_eq,
                "adjustments_total": float(day.adjustments_total),
            }
        )

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
        today = timezone.localdate()
        day = JournalDay.objects.filter(user=user, date=today).first()

        # Realized P/L today = sum over CLOSED trades for today's JournalDay
        pl_today = 0.0
        if day:
            for t in day.trades.filter(status="CLOSED"):
                try:
                    pl_today += float(t.realized_pnl or 0.0)
                except Exception:
                    continue

        # Total realized P/L across all closed trades for this user
        pl_total = 0.0
        for t in Trade.objects.filter(user=user, status="CLOSED"):
            try:
                pl_total += float(t.realized_pnl or 0.0)
            except Exception:
                continue

        equity_today = float(day.effective_equity or 0.0) if day else 0.0
        # naive last-close equity: yesterday's day_start_equity if present
        prev_day = (
            JournalDay.objects.filter(user=user, date__lt=today).order_by("-date").first()
        )
        equity_last_close = float(prev_day.day_start_equity or 0.0) if prev_day else None

        return Response(
            {
                "pl_today": round(pl_today, 2),
                "pl_total": round(pl_total, 2),
                "equity_today": round(equity_today, 2),
                "equity_last_close": (
                    round(equity_last_close, 2) if equity_last_close is not None else None
                ),
            }
        )

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """
        Close a trade, enforcing ownership and re-attaching it to the correct JournalDay
        based on exit_time.
        """
        trade = self.get_object()
        if trade.user_id != request.user.id:
            raise PermissionDenied("Forbidden")

        # We keep this endpoint as the canonical way to close a trade.
        # It accepts optional fields (notes, strategy_tag_ids, exit_emotion, exit_time, ...)
        # and re-attaches the trade to the JournalDay of the local exit date.

        if request.data.get("exit_price", None) in (None, ""):
            return Response(
                {"code": "VALIDATION_ERROR", "detail": "exit_price is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = request.data.copy()
        data["status"] = "CLOSED"

        # If caller didn't provide exit_time, inject "now" so this endpoint is a complete close.
        # (Avoids legacy close() behavior elsewhere that doesn't create fills/commissions.)
        if not data.get("exit_time"):
            data["exit_time"] = timezone.now().isoformat()

        serializer = self.get_serializer(trade, data=data, partial=True)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            trade = serializer.save()

            # If scaling/fills exist, create the final close fill for remaining position (if any),
            # then sync legacy commission fields so the journal displays correctly.
            if hasattr(trade, "fills") and trade.fills.exists():
                self._close_trade_with_fills(
                    trade=trade,
                    user=request.user,
                    exit_time=trade.exit_time or timezone.now(),
                    exit_price=trade.exit_price,
                    note="(close via close endpoint)",
                    commission_override=None,
                )
            else:
                # Non-fill trade: still reattach to correct exit day (overnight safe)
                self._reattach_to_exit_day(trade, request.user, trade.exit_time or timezone.now())
                trade.save(update_fields=["journal_day"])

        return Response(self.get_serializer(trade).data)


class StrategyTagViewSet(viewsets.ModelViewSet):
    """
    NOTE: This currently exposes all StrategyTag objects.
    This assumes tags are global/shared across users.
    If you want per-user tags, we can later add a user FK and filter by request.user.
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StrategyTagSerializer

    def get_queryset(self):
        return StrategyTag.objects.all()


class AttachmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    Attachments are scoped to trades owned by the current user.
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = Attachment.objects.filter(trade__user=self.request.user)
        trade_id = self.request.query_params.get("trade")
        if trade_id:
            qs = qs.filter(trade_id=trade_id)
        return qs

    def perform_create(self, serializer):
        trade = serializer.validated_data.get("trade")
        if trade.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
        serializer.save()


class AccountAdjustmentViewSet(
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    Manage deposits / withdrawals / fees / corrections for a given JournalDay.
    Strictly per-user.
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


class PnLViewSet(viewsets.ViewSet):
    """
    PnL reporting is always computed only over the current user's trades.
    """

    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="daily")
    def daily(self, request):
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        if not start or not end:
            return Response(
                {"detail": "start and end (YYYY-MM-DD) are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            return Response({"detail": "Invalid date format."}, status=400)

        # NOTE: With scaling (TradeFill), SQL expressions over entry/exit fields become incorrect.
        # We compute per-trade NET P/L using the model property `realized_pnl` (supports fills),
        # then aggregate per day in Python for correctness.

        out = []
        cursor = start_date
        while cursor <= end_date:
            day_trades = Trade.objects.filter(
                user=request.user,
                status="CLOSED",
                journal_day__date=cursor,
            )

            trades_count = day_trades.count()
            pl_val = 0.0
            r_list = []
            wins = 0

            for t in day_trades:
                try:
                    pl_val += float(t.realized_pnl or 0.0)
                except Exception:
                    pass

                r_val = getattr(t, "r", None)
                if r_val is None:
                    r_val = getattr(t, "r_multiple", None)
                try:
                    r_f = float(r_val) if r_val is not None else 0.0
                except Exception:
                    r_f = 0.0
                r_list.append(r_f)
                if r_f > 0:
                    wins += 1

            if r_list:
                avg_r = sum(r_list) / len(r_list)
                best_r = max(r_list)
                worst_r = min(r_list)
            else:
                avg_r = 0.0
                best_r = 0.0
                worst_r = 0.0

            win_rate = (wins / trades_count * 100.0) if trades_count else 0.0

            out.append(
                {
                    "date": cursor.isoformat(),
                    "pl": round(pl_val, 2),
                    "trades": trades_count,
                    "win_rate": round(win_rate, 2),
                    "avg_r": round(avg_r, 4),
                    "best_r": round(best_r, 4),
                    "worst_loss_r": round(worst_r, 4),  # typically negative
                    "max_dd_pct": 0.0,  # placeholder; can be computed from equity path
                }
            )
            from datetime import timedelta
            cursor = cursor + timedelta(days=1)

        return Response(out)