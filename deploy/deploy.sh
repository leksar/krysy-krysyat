#!/usr/bin/env bash
# /opt/krysy/bin/deploy.sh — вызывается CI по ssh с принудительной командой (restrict,command=...),
# тег образа приходит в SSH_ORIGINAL_COMMAND. Локально: SSH_ORIGINAL_COMMAND=sha-abc1234 /opt/krysy/bin/deploy.sh
set -euo pipefail
cd /opt/krysy

TAG="${SSH_ORIGINAL_COMMAND:-latest}"
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "bad tag: $TAG" >&2; exit 2; }

echo "== deploy $TAG"
printf 'IMAGE_TAG=%s\n' "$TAG" > .env
docker compose pull --quiet
docker compose up -d --remove-orphans
# чистим только свои старые образы (по label из metadata-action), чужое не трогаем
docker image prune -af --filter "label=org.opencontainers.image.source=https://github.com/leksar/krysy-krysyat" >/dev/null

docker compose ps
sleep 2
docker exec krysy wget -qO- http://127.0.0.1:2567/health && echo
