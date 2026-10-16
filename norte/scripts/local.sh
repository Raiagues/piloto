# Shared helpers for ./setup, ./start and ./stop. Sourced, never executed.
#
# Everything local lives under var/ (ignored by Git): the JSON store fallback,
# the launcher PID and its log. PostgreSQL runs in a Docker container whose data
# stays in a named volume between ./stop and ./start.

NORTE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NORTE_ENV_FILE="$NORTE_ROOT/.env"
NORTE_PID_FILE="$NORTE_ROOT/var/run/norte.pid"
NORTE_LOG_FILE="$NORTE_ROOT/var/log/norte.log"
NORTE_NODE_VERSION="$(tr -d '[:space:]' < "$NORTE_ROOT/.node-version")"
NORTE_NVM_VERSION="v0.40.3"

# Local development database only, bound to 127.0.0.1. The name keeps a "dev"
# segment so scripts/reset-validation-data.mjs accepts it.
NORTE_DB_CONTAINER="norte-postgres"
NORTE_DB_VOLUME="norte-postgres-data"
NORTE_DB_IMAGE="postgres:17-alpine"
NORTE_DB_NAME="norte_dev"
NORTE_DB_USER="norte"
NORTE_DB_PASSWORD="norte"
NORTE_DB_DEFAULT_PORT=55432

if [ -t 1 ]; then
  BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi
step() { printf '%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# --- Node.js -----------------------------------------------------------------

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const have = process.versions.node.split(".").map(Number);
    const need = process.argv[1].split(".").map(Number);
    for (let i = 0; i < 3; i += 1) if (have[i] !== need[i]) process.exit(have[i] > need[i] ? 0 : 1);
  ' "$NORTE_NODE_VERSION"
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] || return 1
  # nvm.sh is not written for `set -e`.
  set +e
  . "$NVM_DIR/nvm.sh" --no-use
  local status=$?
  set -e
  return $status
}

# Put a supported Node.js on PATH without installing anything.
use_node() {
  node_is_supported && return 0
  load_nvm || return 1
  set +e
  nvm use --silent "$NORTE_NODE_VERSION" >/dev/null 2>&1
  set -e
  node_is_supported
}

ensure_node() {
  if use_node; then ok "Node.js $(node -v)"; return; fi
  if ! load_nvm; then
    command -v curl >/dev/null 2>&1 || die "curl is required to install Node.js. Install it (sudo apt install curl) and run ./setup again."
    step "Installing nvm $NORTE_NVM_VERSION (Node.js version manager)"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NORTE_NVM_VERSION/install.sh" | bash
    load_nvm || die "nvm was installed but could not be loaded from $NVM_DIR."
  fi
  step "Installing Node.js $NORTE_NODE_VERSION"
  set +e
  nvm install "$NORTE_NODE_VERSION"
  set -e
  use_node || die "Node.js $NORTE_NODE_VERSION could not be installed with nvm."
  ok "Node.js $(node -v)"
}

dependencies_installed() {
  local marker="$NORTE_ROOT/node_modules/.package-lock.json"
  [ -f "$marker" ] && [ "$marker" -nt "$NORTE_ROOT/package-lock.json" ] || return 1
  (cd "$NORTE_ROOT" && node --input-type=module -e 'await import("argon2")' >/dev/null 2>&1)
}

# --- .env ----------------------------------------------------------------------

env_get() {
  [ -f "$NORTE_ENV_FILE" ] || return 0
  local value
  value="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$NORTE_ENV_FILE" | tail -n 1 | tr -d '\r')" || true
  value="${value#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

# Replace KEY in place (or append it), keeping comments and every other line.
env_set() {
  local temporary="$NORTE_ENV_FILE.$$.tmp"
  ENV_KEY="$1" ENV_VALUE="$2" awk '
    BEGIN { key = ENVIRON["ENV_KEY"]; value = ENVIRON["ENV_VALUE"] }
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" { if (!done) print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$NORTE_ENV_FILE" > "$temporary"
  mv "$temporary" "$NORTE_ENV_FILE"
  chmod 600 "$NORTE_ENV_FILE"
}

# --- PostgreSQL in Docker ----------------------------------------------------------

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

local_database_url() {
  printf 'postgresql://%s:%s@127.0.0.1:%s/%s' "$NORTE_DB_USER" "$NORTE_DB_PASSWORD" "$1" "$NORTE_DB_NAME"
}

# True when .env points at the container these scripts manage.
uses_local_postgres() {
  case "$(env_get DATABASE_URL)" in
    "postgresql://$NORTE_DB_USER:$NORTE_DB_PASSWORD@127.0.0.1:"*"/$NORTE_DB_NAME") return 0 ;;
    *) return 1 ;;
  esac
}

port_is_free() {
  node -e '
    const server = require("node:net").createServer();
    server.once("error", () => process.exit(1));
    server.listen({ host: "127.0.0.1", port: Number(process.argv[1]) }, () => server.close(() => process.exit(0)));
  ' "$1"
}

database_container_state() {
  docker inspect -f '{{.State.Status}}' "$NORTE_DB_CONTAINER" 2>/dev/null || true
}

# Create or start the container, wait until it accepts TCP connections and
# record its URL in .env.
ensure_postgres() {
  local state port url
  state="$(database_container_state)"
  if [ -z "$state" ]; then
    port="$NORTE_DB_DEFAULT_PORT"
    url="$(env_get DATABASE_URL)"
    if uses_local_postgres; then
      port="${url##*127.0.0.1:}"
      port="${port%%/*}"
    fi
    while ! port_is_free "$port"; do port=$((port + 1)); done
    step "Creating PostgreSQL container $NORTE_DB_CONTAINER (127.0.0.1:$port)"
    docker run -d --name "$NORTE_DB_CONTAINER" \
      -e POSTGRES_USER="$NORTE_DB_USER" \
      -e POSTGRES_PASSWORD="$NORTE_DB_PASSWORD" \
      -e POSTGRES_DB="$NORTE_DB_NAME" \
      -p "127.0.0.1:$port:5432" \
      -v "$NORTE_DB_VOLUME:/var/lib/postgresql/data" \
      "$NORTE_DB_IMAGE" >/dev/null
  elif [ "$state" != "running" ]; then
    step "Starting PostgreSQL ($NORTE_DB_CONTAINER)"
    docker start "$NORTE_DB_CONTAINER" >/dev/null
  fi

  port="$(docker port "$NORTE_DB_CONTAINER" 5432/tcp | head -n 1)"
  port="${port##*:}"
  [ -n "$port" ] || die "Could not read the published port of $NORTE_DB_CONTAINER."
  env_set DATABASE_URL "$(local_database_url "$port")"

  # During first initialization PostgreSQL only listens on its socket, so a TCP
  # check does not report ready before the database exists.
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$NORTE_DB_CONTAINER" pg_isready -q -h 127.0.0.1 -U "$NORTE_DB_USER" -d "$NORTE_DB_NAME" 2>/dev/null; then
      ok "PostgreSQL ready on 127.0.0.1:$port"
      return
    fi
    sleep 1
  done
  die "PostgreSQL did not become ready. See: docker logs $NORTE_DB_CONTAINER"
}

# --- Launcher process ---------------------------------------------------------------

# Prints the PID only when it is still our launcher, so a stale file never
# makes ./stop signal an unrelated process.
running_pid() {
  [ -f "$NORTE_PID_FILE" ] || return 1
  local pid
  pid="$(cat "$NORTE_PID_FILE")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  ps -o args= -p "$pid" 2>/dev/null | grep -q "scripts/dev.mjs" || return 1
  printf '%s' "$pid"
}

logged_url() {
  [ -f "$NORTE_LOG_FILE" ] || return 0
  grep -m 1 -o "Norte $1: [^[:space:]]*" "$NORTE_LOG_FILE" | sed "s/^Norte $1: //" || true
}

print_urls() {
  local web api
  web="$(logged_url web)"
  api="$(logged_url API)"
  echo
  printf '  %sWeb%s      %s\n' "$BOLD" "$RESET" "${web:-?}"
  printf '  %sAPI docs%s %s\n' "$BOLD" "$RESET" "${api:-?}"
  printf '  %sLogs%s     tail -f var/log/norte.log\n' "$BOLD" "$RESET"
  printf '  %sStop%s     ./stop\n' "$BOLD" "$RESET"
  echo
}
