
import json
from pathlib import Path
from django.conf import settings
from django import template
from django.utils.safestring import mark_safe
import os

register = template.Library()

def _manifest_candidates():
    # 1) STATIC_ROOT/frontend/manifest.json
    if getattr(settings, "STATIC_ROOT", None):
        yield Path(settings.STATIC_ROOT) / "frontend" / "manifest.json"
        yield Path(settings.STATIC_ROOT) / "frontend" / ".vite" / "manifest.json"
    # 2) BASE_DIR/static/frontend/manifest.json
    yield Path(getattr(settings, "BASE_DIR")) / "static" / "frontend" / "manifest.json"
    yield Path(getattr(settings, "BASE_DIR")) / "staticfiles" / "frontend" / "manifest.json"
    # 3) app static dir
    yield Path(getattr(settings, "BASE_DIR")) / "static" / "manifest.json"

def _load_manifest():



    for p in _manifest_candidates():
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
    return None

@register.simple_tag
def vite(entry: str = "index.html"):
    # Dev mode: optional Vite dev server
    dev_server = getattr(settings, "VITE_DEV_SERVER", None)
    if getattr(settings, "DEBUG", False) and dev_server:
        tags = [
            f'<script type="module" src="{dev_server.rstrip("/")}/@vite/client"></script>',
            f'<script type="module" src="{dev_server.rstrip("/")}/src/main.tsx"></script>',
        ]
        return mark_safe("\n".join(tags))

    # Prod: use manifest
    m = _load_manifest()
    if not m:
        return mark_safe("<!-- vite manifest not found -->")

    item = m.get(entry) or m.get("index.html")
    if not item:
        return mark_safe("<!-- vite entry not found in manifest -->")


    tags = []

    # CSS first (from entry)
    for css in item.get("css", []):
        tags.append(f'<link rel="stylesheet" href="/static/frontend/{css}"/>')

    # JS main file
    file = item.get("file")
    if file:
        tags.append(f'<script type="module" src="/static/frontend/{file}"></script>')

    # Child imports CSS
    for child in item.get("imports", []):
        imp = m.get(child)
        if imp:
            for css in imp.get("css", []):
                tags.append(f'<link rel="stylesheet" href="/static/frontend/{css}"/>')

    return mark_safe("\n".join(tags))
