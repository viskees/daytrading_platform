# app/core/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.shortcuts import render

def spa(request):
    return render(request, "index.html")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/journal/", include("journal.urls")),
    # Serve the SPA for everything else that's not /admin or /api
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa, name="spa"),
]
