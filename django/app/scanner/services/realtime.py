import time
from typing import Any, Dict, Iterable

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def publish_trigger_event(user_id: int, payload: Dict[str, Any]) -> None:
    """
    Push a trigger event to exactly one user (multi-user safe).

    payload should be JSON-serializable and typically match ScannerTriggerEventSerializer(ev).data.
    """
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    enriched = {
        "type": "trigger",   # client-side switch
        "ts": time.time(),   # unix seconds
        **payload,           # your custom fields
    }

    async_to_sync(channel_layer.group_send)(
        f"user_{user_id}",
        {
            "type": "trigger_event",  # maps to consumer.trigger_event()
            "payload": enriched,
        },
    )


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