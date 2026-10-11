FROM alpine:3.20

RUN apk add --no-cache netcat-openbsd

# Keeps the container alive under `docker compose up`; the demo overrides with
# e.g. `docker compose run --rm test-client nc low 2222`.
CMD ["sh", "-c", "sleep infinity"]