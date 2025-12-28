from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

Handler = Callable[[str, dict, Optional[Any]], None]

_registry: Dict[str, List[Handler]] = {}


def register(event_name: str, handler: Handler) -> None:
    _registry.setdefault(event_name, []).append(handler)


def emit(event_name: str, payload: dict, request=None) -> None:
    """
    Fire-and-forget dispatcher.
    Handlers must not raise (we isolate failures per handler).
    """
    for handler in _registry.get(event_name, []):
        try:
            handler(event_name, payload, request)
        except Exception:
            # intentionally swallow exceptions so we never break user flows
            pass