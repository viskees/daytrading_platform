import time
from typing import Any, Dict, Iterable, List

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _send_to_user_group(user_id: int, payload: Dict[str, Any]) -> None:
    """
    Internal helper: send a payload to a per-user group.
    Uses the same consumer handler (trigger_event) for all scanner WS payloads,
    while the payload itself contains a 'type' field the frontend can switch on.
    """
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    async_to_sync(channel_layer.group_send)(
        f"user_{user_id}",
        {
            "type": "trigger_event",  # maps to consumer.trigger_event()
            "payload": payload,
        },
    )


def publish_trigger_event(user_id: int, payload: Dict[str, Any]) -> None:
    """
    Push a trigger event to exactly one user (multi-user safe).

    payload should be JSON-serializable and typically match ScannerTriggerEventSerializer(ev).data.
    """
    enriched = {
        "type": "trigger",   # client-side switch
        "ts": time.time(),   # unix seconds
        **payload,           # your custom fields
    }
    _send_to_user_group(int(user_id), enriched)


def publish_trigger_event_to_users(user_ids: Iterable[int], payload: Dict[str, Any]) -> int:
    """
    Convenience helper to publish the same trigger payload to multiple users.
    Returns number of attempted publishes.
    """
    n = 0
    for uid in user_ids:
        try:
            publish_trigger_event(int(uid), payload)
            n += 1
        except Exception:
            # Best-effort: do not crash engine/admin action if realtime layer fails
            continue
    return n


def publish_hotlist(user_id: int, items: List[Dict[str, Any]]) -> None:
    """
    Push a "hot list" (top N scored tickers) to one user.

    items should be JSON-serializable and lean (frontend table rows).
    """
    enriched = {
        "type": "hot5",      # client-side switch
        "ts": time.time(),   # unix seconds
        "items": items,
    }
    _send_to_user_group(int(user_id), enriched)


def publish_hotlist_to_users(user_ids: Iterable[int], items: List[Dict[str, Any]]) -> int:
    """
    Publish the same hotlist items to multiple users.
    """
    n = 0
    for uid in user_ids:
        try:
            publish_hotlist(int(uid), items)
            n += 1
        except Exception:
            continue
    return n