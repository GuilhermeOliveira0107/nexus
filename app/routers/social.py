from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Channel, ChannelMember, Friendship, User
from app.realtime import user_public
from app.schemas import DmIn, FriendIn
from app.services import dm_other_user, find_or_create_dm, friendship_pair, serialize_channel

router = APIRouter(prefix="/api", tags=["social"])


@router.get("/friends")
def list_friends(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Friendship)
        .options(joinedload(Friendship.requester), joinedload(Friendship.addressee))
        .filter(or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id))
        .all()
    )
    accepted, incoming, outgoing = [], [], []
    for row in rows:
        other = row.addressee if row.requester_id == user.id else row.requester
        item = {**user_public(other), "friendship_id": row.id}
        if row.status == "accepted":
            accepted.append(item)
        elif row.addressee_id == user.id:
            incoming.append(item)
        else:
            outgoing.append(item)
    return {"accepted": accepted, "incoming": incoming, "outgoing": outgoing}


@router.post("/friends")
def add_friend(payload: FriendIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    other = db.query(User).filter(User.username.ilike(payload.username.strip())).first()
    if not other:
        raise HTTPException(404, "Usuário não encontrado.")
    if other.id == user.id:
        raise HTTPException(400, "Você não pode se adicionar.")
    existing = friendship_pair(db, user.id, other.id)
    if existing:
        if existing.status == "accepted":
            raise HTTPException(409, "Vocês já são amigos.")
        if existing.addressee_id == user.id:
            existing.status = "accepted"
            db.commit()
            return {"ok": True, "status": "accepted"}
        raise HTTPException(409, "Pedido já enviado.")
    db.add(Friendship(requester_id=user.id, addressee_id=other.id, status="pending"))
    db.commit()
    return {"ok": True, "status": "pending"}


@router.post("/friends/{friendship_id}/accept")
def accept_friend(friendship_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Friendship, friendship_id)
    if not row or row.addressee_id != user.id:
        raise HTTPException(404, "Pedido não encontrado.")
    row.status = "accepted"
    db.commit()
    return {"ok": True}


@router.post("/friends/{friendship_id}/decline")
def decline_friend(friendship_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Friendship, friendship_id)
    if not row or user.id not in (row.requester_id, row.addressee_id):
        raise HTTPException(404, "Pedido não encontrado.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/dms")
def list_dms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = db.query(ChannelMember).filter(ChannelMember.user_id == user.id).all()
    result = []
    for membership in memberships:
        channel = db.get(Channel, membership.channel_id)
        if not channel or channel.type != "dm":
            continue
        other = dm_other_user(db, channel, user.id)
        if not other:
            continue
        item = serialize_channel(channel)
        item["name"] = other.display_name
        item["peer"] = user_public(other)
        result.append(item)
    return result


@router.post("/dms")
def open_dm(payload: DmIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    other = db.get(User, payload.user_id)
    if not other:
        raise HTTPException(404, "Usuário não encontrado.")
    channel = find_or_create_dm(db, user, other)
    item = serialize_channel(channel)
    item["name"] = other.display_name
    item["peer"] = user_public(other)
    return item
