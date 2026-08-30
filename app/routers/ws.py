import json
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import joinedload

from app.auth import user_from_token
from app.database import SessionLocal
from app.models import Channel, Message, User
from app.realtime import hub, user_public
from app.services import can_use_channel, serialize_message, server_member_ids

router = APIRouter()


async def _related_user_ids(db, user_id: int) -> set[int]:
    from app.models import ChannelMember, Friendship, ServerMember
    from sqlalchemy import or_

    ids: set[int] = set()
    server_ids = [row[0] for row in db.query(ServerMember.server_id).filter(ServerMember.user_id == user_id)]
    if server_ids:
        for row in db.query(ServerMember.user_id).filter(ServerMember.server_id.in_(server_ids)):
            ids.add(row[0])
    friends = (
        db.query(Friendship)
        .filter(
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
            Friendship.status == "accepted",
        )
        .all()
    )
    for friend in friends:
        ids.add(friend.addressee_id if friend.requester_id == user_id else friend.requester_id)
    dm_ids = [row[0] for row in db.query(ChannelMember.channel_id).filter(ChannelMember.user_id == user_id)]
    if dm_ids:
        for row in db.query(ChannelMember.user_id).filter(ChannelMember.channel_id.in_(dm_ids)):
            ids.add(row[0])
    ids.discard(user_id)
    return ids


def _audience_for_channel(db, channel: Channel) -> set[int]:
    if channel.type == "dm":
        from app.models import ChannelMember

        return {row[0] for row in db.query(ChannelMember.user_id).filter(ChannelMember.channel_id == channel.id)}
    if channel.server_id:
        return server_member_ids(db, channel.server_id)
    return set()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str | None = None):
    await ws.accept()
    db = SessionLocal()
    user = user_from_token(db, token)
    if not user:
        await ws.send_text(json.dumps({"type": "error", "message": "Sessão inválida."}))
        await ws.close(code=4401)
        db.close()
        return

    user_id = user.id
    await hub.connect(user_id, ws)
    related = await _related_user_ids(db, user_id)
    await ws.send_text(
        json.dumps(
            {
                "type": "hello",
                "user": user_public(user),
                "online": list(hub.online_ids()),
                "voice": hub.voice_snapshot(),
            }
        )
    )
    await hub.broadcast_online(related, user_id, True)
    db.close()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if data.get("type") == "ping":
                await hub.send_user(user_id, {"type": "pong"})
                continue
            await _handle(user_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        left_voice = hub.voice.get(user_id)
        last_socket = hub.disconnect(user_id, ws)
        db = SessionLocal()
        try:
            if last_socket:
                if left_voice:
                    channel = db.get(Channel, left_voice.channel_id)
                    if channel:
                        await hub.send_users(
                            _audience_for_channel(db, channel),
                            {"type": "voice_leave", "user_id": user_id, "channel_id": left_voice.channel_id},
                        )
                related = await _related_user_ids(db, user_id)
                await hub.broadcast_online(related, user_id, False)
        finally:
            db.close()


async def _handle(user_id: int, data: dict) -> None:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return
        kind = data.get("type")
        if kind == "message":
            await _on_message(db, user, data)
        elif kind == "typing":
            await _on_typing(db, user, data)
        elif kind == "voice_join":
            await _on_voice_join(db, user, data)
        elif kind == "voice_leave":
            await _on_voice_leave(db, user)
        elif kind == "voice_state":
            await _on_voice_state(db, user, data)
        elif kind in {"webrtc_offer", "webrtc_answer", "webrtc_ice"}:
            target_id = data.get("target_id")
            if not target_id:
                return
            payload = {**data, "from_id": user.id}
            payload.pop("target_id", None)
            await hub.send_user(int(target_id), payload)
    except Exception:
        db.rollback()
    finally:
        db.close()


async def _on_message(db, user: User, data: dict) -> None:
    channel_id = data.get("channel_id")
    content = (data.get("content") or "").strip()
    if not channel_id or not content or len(content) > 2000:
        return
    channel = db.get(Channel, int(channel_id))
    if not channel or channel.type == "voice" or not can_use_channel(db, channel, user.id):
        return
    message = Message(channel_id=channel.id, user_id=user.id, content=content, created_at=datetime.utcnow())
    db.add(message)
    db.commit()
    db.refresh(message)
    message = db.query(Message).options(joinedload(Message.user)).filter(Message.id == message.id).one()
    await hub.send_users(
        _audience_for_channel(db, channel),
        {"type": "message", **serialize_message(message)},
    )


async def _on_typing(db, user: User, data: dict) -> None:
    channel_id = data.get("channel_id")
    if not channel_id:
        return
    channel = db.get(Channel, int(channel_id))
    if not channel or not can_use_channel(db, channel, user.id):
        return
    targets = _audience_for_channel(db, channel)
    targets.discard(user.id)
    await hub.send_users(
        targets,
        {"type": "typing", "channel_id": channel.id, "user": user_public(user)},
    )


async def _on_voice_join(db, user: User, data: dict) -> None:
    channel_id = data.get("channel_id")
    if not channel_id:
        return
    channel = db.get(Channel, int(channel_id))
    if not channel or channel.type != "voice" or not can_use_channel(db, channel, user.id):
        return

    previous = hub.voice.get(user.id)
    if previous and previous.channel_id != channel.id:
        old = db.get(Channel, previous.channel_id)
        if old:
            await hub.send_users(
                _audience_for_channel(db, old),
                {"type": "voice_leave", "user_id": user.id, "channel_id": old.id},
            )

    from app.realtime import VoiceState

    hub.voice[user.id] = VoiceState(channel_id=channel.id)
    peers = []
    for peer_id in hub.peers_in_channel(channel.id, except_user=user.id):
        peer = db.get(User, peer_id)
        state = hub.voice[peer_id]
        if peer:
            peers.append({
                **user_public(peer),
                "muted": state.muted,
                "deafened": state.deafened,
                "sharing": state.sharing,
            })

    await hub.send_user(
        user.id,
        {"type": "voice_peers", "channel_id": channel.id, "peers": peers},
    )
    await hub.send_users(
        _audience_for_channel(db, channel),
        {
            "type": "voice_join",
            "channel_id": channel.id,
            "user": user_public(user),
            "muted": False,
            "deafened": False,
            "sharing": False,
        },
    )


async def _on_voice_leave(db, user: User) -> None:
    state = hub.voice.pop(user.id, None)
    if not state:
        return
    channel = db.get(Channel, state.channel_id)
    if not channel:
        return
    await hub.send_users(
        _audience_for_channel(db, channel),
        {"type": "voice_leave", "user_id": user.id, "channel_id": channel.id},
    )


async def _on_voice_state(db, user: User, data: dict) -> None:
    state = hub.voice.get(user.id)
    if not state:
        return
    state.muted = bool(data.get("muted"))
    state.deafened = bool(data.get("deafened"))
    if "sharing" in data:
        state.sharing = bool(data.get("sharing"))
    channel = db.get(Channel, state.channel_id)
    if not channel:
        return
    await hub.send_users(
        _audience_for_channel(db, channel),
        {
            "type": "voice_state",
            "user_id": user.id,
            "channel_id": channel.id,
            "muted": state.muted,
            "deafened": state.deafened,
            "sharing": state.sharing,
        },
    )
