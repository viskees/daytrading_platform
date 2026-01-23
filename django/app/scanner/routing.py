from django.urls import path
from . import consumers

websocket_urlpatterns = [
    path("ws/scanner/triggers/", consumers.TriggerConsumer.as_asgi()),
]