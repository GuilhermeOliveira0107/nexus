import secrets
import string

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models import Channel, ChannelMember, Friendship, Server, ServerMember, User
from app.realtime import user_public


INVITE_ALPHABET = string.ascii_uppercase + string.digits


def new_invite_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
        if not db.query(Server).filter(Server.invite_code == code).first():
            return code
    raise RuntimeError("Não foi possível gerar um convite.")


def create_server_with_channels(db: Session, owner: User, name: str) -> Server:
    server = Server(
        name=name.strip(),
        owner_id=owner.id,
        invite_code=new_invite_code(db),
        icon_color=owner.avatar_color,
    )
    db.add(server)
    db.flush()
    db.add(ServerMember(server_id=server.id, user_id=owner.id))
    defaults = [
        ("geral", "text", 0),
        ("jogos", "text", 1),
        ("Lobby", "voice", 2),
        ("Partida", "voice", 3),
    ]
    for channel_name, channel_type, position in defaults:
        db.add(
            Channel(
                server_id=server.id,
                name=channel_name,
                type=channel_type,
                position=position,
            )
        )
    db.commit()
    db.refresh(server)
    return server


def is_server_member(db: Session, server_id: int, user_id: int) -> bool:
    return (
        db.query(ServerMember)
        .filter(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
        .first()
        is not None
    )


def can_use_channel(db: Session, channel: Channel, user_id: int) -> bool:
    if channel.type == "dm":
        return (
            db.query(ChannelMember)
            .filter(ChannelMember.channel_id == channel.id, ChannelMember.user_id == user_id)
            .first()
            is not None
        )
    if channel.server_id is None:
        return False
    return is_server_member(db, channel.server_id, user_id)


def server_member_ids(db: Session, server_id: int) -> set[int]:
    rows = db.query(ServerMember.user_id).filter(ServerMember.server_id == server_id).all()
    return {row[0] for row in rows}


def serialize_server(server: Server, member_count: int | None = None) -> dict:
    return {
        "id": server.id,
        "name": server.name,
        "owner_id": server.owner_id,
        "invite_code": server.invite_code,
        "icon_color": server.icon_color,
        "member_count": member_count,
    }


def serialize_channel(channel: Channel) -> dict:
    return {
        "id": channel.id,
        "server_id": channel.server_id,
        "name": channel.name,
        "type": channel.type,
        "position": channel.position,
    }


def serialize_message(message) -> dict:
    return {
        "id": message.id,
        "channel_id": message.channel_id,
        "content": message.content,
        "created_at": message.created_at.isoformat() + "Z",
        "author": user_public(message.user),
    }


def friendship_pair(db: Session, a: int, b: int) -> Friendship | None:
    return (
        db.query(Friendship)
        .filter(
            or_(
                (Friendship.requester_id == a) & (Friendship.addressee_id == b),
                (Friendship.requester_id == b) & (Friendship.addressee_id == a),
            )
        )
        .first()
    )


def find_or_create_dm(db: Session, me: User, other: User) -> Channel:
    mine = {
        row[0]
        for row in db.query(ChannelMember.channel_id).filter(ChannelMember.user_id == me.id).all()
    }
    theirs = {
        row[0]
        for row in db.query(ChannelMember.channel_id).filter(ChannelMember.user_id == other.id).all()
    }
    shared = mine & theirs
    if shared:
        existing = (
            db.query(Channel)
            .filter(Channel.id.in_(shared), Channel.type == "dm")
            .first()
        )
        if existing:
            return existing

    channel = Channel(server_id=None, name=other.display_name, type="dm", position=0)
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, user_id=me.id))
    db.add(ChannelMember(channel_id=channel.id, user_id=other.id))
    db.commit()
    db.refresh(channel)
    return channel


def dm_other_user(db: Session, channel: Channel, me_id: int) -> User | None:
    member = (
        db.query(ChannelMember)
        .options(joinedload(ChannelMember.user))
        .filter(ChannelMember.channel_id == channel.id, ChannelMember.user_id != me_id)
        .first()
    )
    return member.user if member else None
