FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
# Install runtime + dev extras so the AGENTS.md §3 canonical command
# `docker compose run --rm backend pytest` works without a separate test image.
RUN pip install --no-cache-dir ".[dev]"

COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
COPY tests ./tests

EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]