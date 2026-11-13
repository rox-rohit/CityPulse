#!/usr/bin/env bash
# CityPulse AI - provision PostgreSQL + PostGIS inside WSL2 Ubuntu.
# Idempotent: safe to re-run. Must be executed as root inside the distro.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing PostgreSQL + PostGIS packages"
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib postgis postgresql-postgis \
  postgresql-postgis-scripts curl ca-certificates

PGVER="$(ls /usr/lib/postgresql | sort -V | tail -1)"
echo "==> PostgreSQL major version: ${PGVER}"

echo "==> Starting cluster"
pg_ctlcluster "${PGVER}" main start 2>/dev/null || true
for i in $(seq 1 30); do
  if su postgres -c "pg_isready -q"; then break; fi
  sleep 1
done

echo "==> Ensuring role 'citypulse'"
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='citypulse'\"" | grep -q 1; then
  su postgres -c "psql -c \"CREATE ROLE citypulse LOGIN PASSWORD 'citypulse_password' SUPERUSER\""
else
  echo "    role already exists"
fi

echo "==> Ensuring database 'citypulse'"
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='citypulse'\"" | grep -q 1; then
  su postgres -c "createdb -O citypulse citypulse"
else
  echo "    database already exists"
fi

echo "==> Ensuring PostGIS extension"
su postgres -c "psql -d citypulse -c 'CREATE EXTENSION IF NOT EXISTS postgis'" >/dev/null

echo "==> Allowing TCP connections from the Windows host"
HBA="$(su postgres -c "psql -tAc 'show hba_file'")"
CONF="$(su postgres -c "psql -tAc 'show config_file'")"
for net in "172.16.0.0/12" "192.168.0.0/16" "10.0.0.0/8"; do
  if ! grep -q "${net}" "$HBA"; then
    echo "host all all ${net} scram-sha-256" >> "$HBA"
  fi
done
if grep -qE "^#?listen_addresses" "$CONF"; then
  sed -i -E "s/^#?listen_addresses.*/listen_addresses = '*'/" "$CONF"
else
  echo "listen_addresses = '*'" >> "$CONF"
fi

echo "==> Restarting cluster to apply configuration"
pg_ctlcluster "${PGVER}" main restart

for i in $(seq 1 30); do
  if su postgres -c "pg_isready -q"; then break; fi
  sleep 1
done

echo "==> Enabling systemd boot (so the cluster starts with WSL)"
if ! grep -q "systemd=true" /etc/wsl.conf 2>/dev/null; then
  if [ -f /etc/wsl.conf ] && grep -q "^\[boot\]" /etc/wsl.conf; then
    sed -i "/^\[boot\]/a systemd=true" /etc/wsl.conf
  else
    printf '\n[boot]\nsystemd=true\n' >> /etc/wsl.conf
  fi
fi

echo "==> Verification"
su postgres -c "psql -d citypulse -tAc 'SELECT postgis_version()'"
su postgres -c "psql -d citypulse -tAc 'SELECT version()'" | head -1
su postgres -c "psql -d citypulse -tAc \"SELECT rolname FROM pg_roles WHERE rolname='citypulse'\""
echo "==> DONE"
