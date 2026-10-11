def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}