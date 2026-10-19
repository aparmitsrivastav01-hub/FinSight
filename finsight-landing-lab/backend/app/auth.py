from __future__ import annotations

from typing import Any, Callable

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings


bearer_scheme = HTTPBearer(auto_error=False)


def verify_access_token(
    token: str,
    settings: Settings,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    try:
        settings.require_auth_configuration()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Authentication service is not configured.") from exc

    try:
        auth_get = get or httpx.get
        response = auth_get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Could not verify the Supabase session.") from exc

    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="The Supabase session is invalid or expired.")
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="Could not verify the Supabase session.")

    try:
        user = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Supabase returned an invalid user response.") from exc
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="The Supabase session has no authenticated user.")
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="A Supabase access token is required.")
    return verify_access_token(credentials.credentials, settings)
