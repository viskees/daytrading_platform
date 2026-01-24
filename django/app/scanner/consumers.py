import json
from channels.generic.websocket import AsyncWebsocketConsumer


class TriggerConsumer(AsyncWebsocketConsumer):
    """
    Per-user trigger stream.
    AuthMiddlewareStack gives us scope["user"] from session/cookies.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or user.is_anonymous:
            await self.close(code=4401)  # Unauthorized
            return

        self.user_group = f"user_{user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        await self.accept()

        # Optional: tell client it's connected
        await self.send_json({"type": "hello", "user_id": user.id})

    async def disconnect(self, code):
        if hasattr(self, "user_group"):
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

    async def send_json(self, payload: dict):
        await self.send(text_data=json.dumps(payload))

    # This handler name must match the "type" we send via group_send below
    async def trigger_event(self, event):
        # event = {"type": "trigger_event", "payload": {...}}
        await self.send_json(event["payload"])