from pydantic import BaseModel

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token_raw: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str