# django/app/journal/templatetags/vite.py
import json
from pathlib import Path
from django.conf import settings
from django import template
from django.utils.safestring import mark_safe

register = template.Library()

def _load_manifest():
    # Try both locations (Vite sometimes places it under .vite/)
    root = Path(settings.STATIC_ROOT) / "frontend"
    candidates = [root / "manifest.json", root / ".vite" / "manifest.json"]
    for p in candidates:
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return {}
    return {}

@register.simple_tag
def vite(entry: str = "index.html"):
    """
    Usage: {% load vite %}{% vite 'index.html' %}
    Injects <link> and <script> tags based on the Vite manifest.
    Works whether manifest is at frontend/manifest.json or frontend/.vite/manifest.json.
    """
    m = _load_manifest()
    if not m:
        return mark_safe("<!-- vite manifest missing (looked in frontend/manifest.json and frontend/.vite/manifest.json) -->")

    key = entry if entry in m else next(iter(m.keys()), None)
    if not key:
        return mark_safe("<!-- vite manifest empty -->")

    item = m[key]
    tags = []

    # CSS for the entry
    for css in item.get("css", []):
        tags.append(f'<link rel="stylesheet" href="/static/frontend/{css}"/>')

    # Main JS for the entry
    file = item.get("file")
    if file:
        tags.append(f'<script type="module" src="/static/frontend/{file}"></script>')

    # CSS for imported chunks
    for child in item.get("imports", []):
        imp = m.get(child)
        if imp:
            for css in imp.get("css", []):
                tags.append(f'<link rel="stylesheet" href="/static/frontend/{css}"/>')

    return mark_safe("\n".join(tags))
