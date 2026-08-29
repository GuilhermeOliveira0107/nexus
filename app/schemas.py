from pydantic import BaseModel, Field


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=4, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)


class ServerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class JoinServerIn(BaseModel):
    invite_code: str = Field(min_length=4, max_length=16)


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: str = Field(pattern="^(text|voice)$")


class FriendIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)


class DmIn(BaseModel):
    user_id: int
