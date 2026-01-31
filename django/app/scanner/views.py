from django.utils import timezone
from django.conf import settings
from django.utils.dateparse import parse_datetime
from datetime import timezone as dt_timezone

from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle

from .models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings
from .serializers import (
    ScannerConfigSerializer,
    ScannerUniverseTickerSerializer,
    ScannerTriggerEventSerializer,
    UserScannerSettingsSerializer,
)
from .permissions import IsScannerAdminOrReadOnly, is_scanner_admin
from .services.realtime import publish_hotlist_to_users, publish_trigger_event_to_users


class ScannerConfigViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerConfigSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"

    def get_object(self):
        obj, _ = ScannerConfig.objects.get_or_create(id=1)
        return obj


class ScannerUniverseTickerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerUniverseTickerSerializer
    queryset = ScannerUniverseTicker.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"


class ScannerTriggerEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Global trigger feed visible to all authenticated users,
    but filtered per-user by their cleared_until timestamp.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ScannerTriggerEventSerializer
    queryset = ScannerTriggerEvent.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_triggers"

    def get_queryset(self):
        qs = super().get_queryset()

        settings_obj, _ = UserScannerSettings.objects.get_or_create(user=self.request.user)
        if settings_obj.cleared_until:
            qs = qs.filter(triggered_at__gt=settings_obj.cleared_until)

        symbol = self.request.query_params.get("symbol")
        if symbol:
            qs = qs.filter(symbol__iexact=symbol)

        return qs

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """
        Clear the trigger list for the current user (does NOT delete global events).
        Sets UserScannerSettings.cleared_until = now.
        """
        settings_obj, _ = UserScannerSettings.objects.get_or_create(user=request.user)
        settings_obj.cleared_until = timezone.now()
        settings_obj.save(update_fields=["cleared_until", "updated_at"])
        return Response(
            {"detail": "cleared", "cleared_until": settings_obj.cleared_until},
            status=status.HTTP_200_OK,
        )


class UserScannerSettingsViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Multi-user note:
    - This viewset is *per-user*, not per-row.
    - Legacy endpoints like /preferences/1/ are tolerated but ignored (treated as "me").
    - Preferred endpoint: /preferences/me/ (GET + PATCH).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = UserScannerSettingsSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"

    def get_object(self):
        obj, _ = UserScannerSettings.objects.get_or_create(user=self.request.user)
        return obj

    @action(detail=False, methods=["get", "patch"], url_path="me")
    def me(self, request):
        """
        GET/PATCH current user's scanner preferences.
        """
        obj = self.get_object()

        if request.method.lower() == "get":
            ser = self.get_serializer(obj)
            return Response(ser.data, status=status.HTTP_200_OK)

        # PATCH
        ser = self.get_serializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_200_OK)


class ScannerAdminViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_write"

    def _require_admin(self, request):
        if not is_scanner_admin(request.user):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        return None

    @action(detail=False, methods=["get"])
    def status(self, request):
        """
        Health/status endpoint for "Make it visibly alive" (Phase 1.3a).

        GET /api/scanner/admin/status/

        Returns:
        - db_ok: can we query DB?
        - redis_ok: can we PING Redis?
        - channels_ok: can we exercise Channels layer (group_add/discard)?
        - ingestor heartbeat + age (from Redis key scanner:ingestor:heartbeat)
        """
        denied = self._require_admin(request)
        if denied:
            return denied

        now = timezone.now()

        # ---- DB check ----
        db_ok = True
        db_err = None
        scanner_enabled = None
        try:
            cfg, _ = ScannerConfig.objects.get_or_create(id=1)
            scanner_enabled = bool(cfg.enabled)
            # cheap query to ensure ORM + connection is healthy
            ScannerUniverseTicker.objects.order_by("id").values_list("id", flat=True).exists()
        except Exception as e:
            db_ok = False
            db_err = repr(e)

        # ---- Redis check ----
        redis_ok = True
        redis_err = None
        redis_url = getattr(settings, "REDIS_URL", None) or "redis://redis:6379/0"

        def _mask_redis_url(u: str) -> str:
            # avoid leaking passwords in responses
            try:
                # very light masking: redis://:pass@host:port/db -> redis://:***@host:port/db
                if "@" in u and "://" in u:
                    scheme, rest = u.split("://", 1)
                    if ":" in rest and "@" in rest:
                        creds, hostpart = rest.split("@", 1)
                        if ":" in creds:
                            userpass = creds.split(":", 1)
                            return f"{scheme}://{userpass[0]}:***@{hostpart}"
                return u
            except Exception:
                return "redis://***"

        try:
            import redis as redis_lib
            r = redis_lib.Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=1)
            r.ping()
        except Exception as e:
            redis_ok = False
            redis_err = repr(e)

        # ---- Channels check ----
        channels_ok = True
        channels_err = None
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            import uuid

            layer = get_channel_layer()
            if layer is None:
                channels_ok = False
                channels_err = "channel_layer is None"
            else:
                group = "__healthcheck__"
                channel_name = f"healthcheck.{uuid.uuid4().hex}"  # valid-ish, short, unique
                async_to_sync(layer.group_add)(group, channel_name)
                async_to_sync(layer.group_discard)(group, channel_name)
        except Exception as e:
            channels_ok = False
            channels_err = repr(e)

        # ---- Ingestor heartbeat (Redis key) ----
        heartbeat_key = "scanner:ingestor:heartbeat"
        hb_raw = None
        hb_ts = None
        age_seconds = None
        hb_err = None

        if redis_ok:
            try:
                import redis as redis_lib
                r = redis_lib.Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=1)
                hb_raw = r.get(heartbeat_key)
                if hb_raw:
                    dt = parse_datetime(hb_raw)
                    if dt is None:
                        # sometimes stored without timezone; assume UTC if naive
                        try:
                            dt = parse_datetime(hb_raw.replace("Z", "+00:00"))
                        except Exception:
                            dt = None
                    if dt is not None:
                        if timezone.is_naive(dt):
                            dt = timezone.make_aware(dt, timezone=dt_timezone.utc)
                        hb_ts = dt
                        age_seconds = max(0, int((now - hb_ts).total_seconds()))
            except Exception as e:
                hb_err = repr(e)

        payload = {
            "now": now.isoformat(),
            "scanner_enabled": scanner_enabled,
            "db_ok": db_ok,
            "redis_ok": redis_ok,
            "channels_ok": channels_ok,
            "redis_url": _mask_redis_url(str(redis_url)),
            "errors": {
                "db": db_err,
                "redis": redis_err,
                "channels": channels_err,
                "heartbeat": hb_err,
            },
            "ingestor": {
                "heartbeat_key": heartbeat_key,
                "heartbeat_raw": hb_raw,
                "heartbeat_ts": hb_ts.isoformat() if hb_ts else None,
                "age_seconds": age_seconds,
            },
        }

        # overall "ok" is conservative: all three green + heartbeat not too old (if present)
        ok = bool(db_ok and redis_ok and channels_ok)
        payload["ok"] = ok

        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def emit_test_event(self, request):
        denied = self._require_admin(request)
        if denied:
            return denied

        symbol = (request.data.get("symbol") or "TEST").upper().strip()
        ev = ScannerTriggerEvent.objects.create(
            symbol=symbol,
            triggered_at=timezone.now(),
            reason_tags=["TEST_EVENT"],
            score=0,
            config_snapshot={"test": True},
        )

        payload = ScannerTriggerEventSerializer(ev).data

        follower_ids = list(
            UserScannerSettings.objects.filter(follow_alerts=True).values_list("user_id", flat=True)
        )
        publish_trigger_event_to_users(follower_ids, payload)

        # Also notify via Pushover (async)
        try:
            from scanner.tasks import scanner_notify_pushover_trigger
            scanner_notify_pushover_trigger.delay(ev.id)
        except Exception:
            pass

        return Response(payload, status=201)

    @action(detail=False, methods=["post"])
    def emit_test_hot5(self, request):
        """
        Emit a synthetic HOT5 payload over the websocket.

        Purpose: allow testing WS + frontend heatmap even when markets are closed
        and no 1-minute bars are flowing into Redis.
        """
        denied = self._require_admin(request)
        if denied:
            return denied

        # Only send to requesting admin user by default (safe during testing).
        # You can switch this to live_feed_enabled users later if you want.
        target_user_ids = [int(request.user.id)]

        # Allow overriding symbols from request (optional)
        raw_symbols = request.data.get("symbols")
        if isinstance(raw_symbols, list) and raw_symbols:
            symbols = [str(s).upper().strip() for s in raw_symbols if str(s).strip()]
        else:
            symbols = ["AAPL", "TSLA", "NVDA", "AMD", "META"]

        # Build plausible synthetic rows. Frontend only needs these fields.
        # Keep values realistic so the UI looks correct.
        base_px = 10.0
        items = []
        for i, sym in enumerate(symbols[:5]):
            px = base_px + i * 7.25
            hod = px * 1.03
            pct1 = 0.8 + i * 0.6
            pct5 = 2.0 + i * 1.0
            r1 = 0.9 + i * 0.8
            v1 = 15_000 + i * 22_000

            last_price = round(px, 4)
            hod_val = round(hod, 4)
            hod_dist = None
            try:
                if abs(last_price) >= 1e-9:
                    hod_dist = (hod_val - last_price) / last_price * 100.0
            except Exception:
                hod_dist = None

            items.append(
                {
                    "symbol": sym,
                    "score": round(50 + i * 17.5, 2),
                    "last_price": last_price,
                    "pct_change_1m": round(pct1, 2),
                    "pct_change_5m": round(pct5, 2),
                    "rvol_1m": round(r1, 2),
                    "rvol_5m": round(max(1.0, r1 * 0.95), 2),
                    "vol_1m": float(v1),
                    "vol_5m": float(v1 * 4.2),
                    "hod": hod_val,
                    "hod_distance_pct": hod_dist,
                    "broke_hod": bool(i == 0),  # first row flagged as HOD for visuals
                    "bar_ts": timezone.now().isoformat(),
                    "reason_tags": ["TEST_HOT5"],
                }
            )

        publish_hotlist_to_users(target_user_ids, items)

        return Response(
            {"detail": "ok", "sent_to_user_ids": target_user_ids, "items": items},
            status=status.HTTP_200_OK,
        )