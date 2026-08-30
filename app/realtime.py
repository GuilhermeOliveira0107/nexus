from __future__ import annotations

import json
from dataclasses import dataclass, field

from fastapi import WebSocket


def user_public(user) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_color": user.avatar_color,
    }


@dataclass
class VoiceState:
    channel_id: int
    muted: bool = False
    deafened: bool = False
    sharing: bool = False


@dataclass
class Hub:
    sockets: dict[int, set[WebSocket]] = field(default_factory=dict)
    voice: dict[int, VoiceState] = field(default_factory=dict)

    def online_ids(self) -> set[int]:
        return set(self.sockets)

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        self.sockets.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: int, ws: WebSocket) -> bool:
        group = self.sockets.get(user_id)
        if not group:
            return True
        group.discard(ws)
        if not group:
            self.sockets.pop(user_id, None)
            self.voice.pop(user_id, None)
            return True
        return False

    async def send_user(self, user_id: int, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.sockets.get(user_id, ())):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def send_users(self, user_ids: set[int] | list[int], payload: dict) -> None:
        for uid in set(user_ids):
            await self.send_user(uid, payload)

    async def broadcast_online(self, user_ids: set[int], user_id: int, online: bool) -> None:
        await self.send_users(
            user_ids,
            {"type": "presence", "user_id": user_id, "online": online},
        )

    def peers_in_channel(self, channel_id: int, except_user: int | None = None) -> list[int]:
        return [
            uid
            for uid, state in self.voice.items()
            if state.channel_id == channel_id and uid != except_user
        ]

    def voice_snapshot(self) -> dict[str, dict]:
        return {
            str(uid): {
                "channel_id": state.channel_id,
                "muted": state.muted,
                "deafened": state.deafened,
                "sharing": state.sharing,
            }
            for uid, state in self.voice.items()
        }

    def occupants(self, db, channel_id: int) -> list[dict]:
        from app.models import User

        people = []
        for uid, state in self.voice.items():
            if state.channel_id != channel_id:
                continue
            user = db.get(User, uid)
            if user:
                people.append({
                    **user_public(user),
                    "muted": state.muted,
                    "deafened": state.deafened,
                    "sharing": state.sharing,
                })
        return people


hub = Hub()
