from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Channel, Message, Server, ServerMember, User
from app.realtime import user_public
from app.schemas import ChannelIn, JoinServerIn, ServerIn
from app.services import (
    can_use_channel,
    create_server_with_channels,
    is_server_member,
    serialize_channel,
    serialize_message,
    serialize_server,
)

router = APIRouter(prefix="/api", tags=["servers"])


@router.get("/servers")
def list_servers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = (
        db.query(ServerMember)
        .options(joinedload(ServerMember.server))
        .filter(ServerMember.user_id == user.id)
        .all()
    )
    result = []
    for membership in memberships:
        count = db.query(ServerMember).filter(ServerMember.server_id == membership.server_id).count()
        result.append(serialize_server(membership.server, count))
    return result


@router.post("/servers")
def create_server(payload: ServerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    server = create_server_with_channels(db, user, payload.name)
    count = db.query(ServerMember).filter(ServerMember.server_id == server.id).count()
    return serialize_server(server, count)


@router.post("/servers/join")
def join_server(payload: JoinServerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    code = payload.invite_code.strip().upper().replace("-", "").replace(" ", "")
    server = db.query(Server).filter(Server.invite_code == code).first()
    if not server:
        raise HTTPException(404, "Convite inválido ou expirado.")
    if not is_server_member(db, server.id, user.id):
        db.add(ServerMember(server_id=server.id, user_id=user.id))
        db.commit()
    count = db.query(ServerMember).filter(ServerMember.server_id == server.id).count()
    return serialize_server(server, count)


@router.get("/invites/{code}")
def preview_invite(code: str, db: Session = Depends(get_db)):
    clean = code.strip().upper().replace("-", "").replace(" ", "")
    server = db.query(Server).filter(Server.invite_code == clean).first()
    if not server:
        raise HTTPException(404, "Convite inválido.")
    count = db.query(ServerMember).filter(ServerMember.server_id == server.id).count()
    return {"name": server.name, "icon_color": server.icon_color, "member_count": count, "invite_code": server.invite_code}


@router.get("/servers/{server_id}")
def get_server(server_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.get(Server, server_id)
    if not server or not is_server_member(db, server_id, user.id):
        raise HTTPException(404, "Servidor não encontrado.")
    count = db.query(ServerMember).filter(ServerMember.server_id == server_id).count()
    return serialize_server(server, count)


@router.get("/servers/{server_id}/channels")
def list_channels(server_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not is_server_member(db, server_id, user.id):
        raise HTTPException(403, "Você não está nesse servidor.")
    channels = (
        db.query(Channel)
        .filter(Channel.server_id == server_id)
        .order_by(Channel.position, Channel.id)
        .all()
    )
    return [serialize_channel(channel) for channel in channels]


@router.post("/servers/{server_id}/channels")
def create_channel(
    server_id: int,
    payload: ChannelIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    server = db.get(Server, server_id)
    if not server or server.owner_id != user.id:
        raise HTTPException(403, "Só o dono do servidor cria canais.")
    last = (
        db.query(Channel)
        .filter(Channel.server_id == server_id)
        .order_by(Channel.position.desc())
        .first()
    )
    channel = Channel(
        server_id=server_id,
        name=payload.name.strip().replace(" ", "-").lower() if payload.type == "text" else payload.name.strip(),
        type=payload.type,
        position=(last.position + 1) if last else 0,
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return serialize_channel(channel)


@router.get("/servers/{server_id}/members")
def list_members(server_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not is_server_member(db, server_id, user.id):
        raise HTTPException(403, "Você não está nesse servidor.")
    memberships = (
        db.query(ServerMember)
        .options(joinedload(ServerMember.user))
        .filter(ServerMember.server_id == server_id)
        .all()
    )
    return [user_public(membership.user) for membership in memberships]


@router.get("/channels/{channel_id}/messages")
def list_messages(
    channel_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    channel = db.get(Channel, channel_id)
    if not channel or channel.type == "voice" or not can_use_channel(db, channel, user.id):
        raise HTTPException(404, "Canal não encontrado.")
    messages = (
        db.query(Message)
        .options(joinedload(Message.user))
        .filter(Message.channel_id == channel_id)
        .order_by(Message.id.desc())
        .limit(120)
        .all()
    )
    return [serialize_message(message) for message in reversed(messages)]
