from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_operator
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import Operator
from app.schemas.auth import LoginIn, OperatorOut, TokenOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Identical detail for "no such user" and "wrong password" so the response never
# reveals which usernames exist. The dummy hash makes the unknown-user path do
# the same single bcrypt comparison as the known-user path, so the *timing* does
# not reveal it either.
_INVALID = "Invalid username or password"
_DUMMY_HASH = hash_password("timing-equalization-only")


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    operator = db.scalar(select(Operator).where(Operator.username == body.username))
    if operator is None:
        verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail=_INVALID)
    if not verify_password(body.password, operator.password_hash):
        raise HTTPException(status_code=401, detail=_INVALID)
    return TokenOut(
        access_token=create_access_token(str(operator.id), operator.role),
        expires_in=settings.jwt_expires_minutes * 60,
        operator=OperatorOut.model_validate(operator),
    )


@router.get("/me", response_model=OperatorOut)
def me(operator: Operator = Depends(require_operator)) -> OperatorOut:
    return OperatorOut.model_validate(operator)
