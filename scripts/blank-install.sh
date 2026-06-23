#!/usr/bin/env bash
# Spin up a disposable Smithers install for screenshots, demo, or
# smoke-testing the first-run experience. Lives at ~/smithers-shots/,
# runs on port 3001, uses ~/smithers-shots-data + ~/smithers-shots-vault
# so it never touches your real install at ~/smithers/ or your real
# data dir at ~/.smithers/.
#
# Usage (via pnpm aliases at repo root):
#   pnpm shots:up      → clone (if needed) + install + start dev on :3001
#   pnpm shots:down    → tear down everything (checkout + data + vault)
#   pnpm shots:reset   → wipe data + vault but keep checkout (fast restart)

set -e

SHOTS_DIR="$HOME/smithers-shots"
SHOTS_DATA="$HOME/smithers-shots-data"
SHOTS_VAULT="$HOME/smithers-shots-vault"
PORT=3001
REPO_URL="https://github.com/unicornfancy/smithers.git"

cmd="${1:-up}"

case "$cmd" in
  up)
    echo "==> Setting up blank install at $SHOTS_DIR"
    if [ ! -d "$SHOTS_DIR/.git" ]; then
      echo "    Cloning fresh from $REPO_URL"
      git clone "$REPO_URL" "$SHOTS_DIR"
    else
      echo "    Reusing existing checkout (run 'pnpm shots:down' first for a fully fresh clone)"
      ( cd "$SHOTS_DIR" && git pull --ff-only ) || true
    fi

    cd "$SHOTS_DIR"
    echo "==> Installing deps (silent — takes ~1 min on fresh)"
    pnpm install --silent

    mkdir -p "$SHOTS_DATA" "$SHOTS_VAULT"

    # Disposable config so the wizard knows where to put files. Leaves
    # all MCPs off — the demo install runs in mock mode for clean
    # screenshots without any external auth.
    cat > config.local.yaml <<EOF
identity:
  name: "Demo TAM"
  role: "Launch TAM"
paths:
  vault: $SHOTS_VAULT
  data: $SHOTS_DATA
  hive_mind: ""
  my_voice: ""
  kosh: ""
mcps:
  context_a8c: { enabled: false }
  hive_mind: { enabled: false }
  fathom: { enabled: false }
  google_drive: { enabled: false }
EOF

    echo ""
    echo "===================================================="
    echo "  Blank install ready. Open:"
    echo "    http://localhost:$PORT/setup"
    echo ""
    echo "  Ctrl+C to stop the dev server."
    echo "  When you're done with the install entirely:"
    echo "    pnpm shots:down"
    echo "===================================================="
    echo ""
    PORT=$PORT pnpm dev
    ;;

  down)
    echo "==> Tearing down blank install"
    rm -rf "$SHOTS_DIR" "$SHOTS_DATA" "$SHOTS_VAULT"
    echo "==> Done. Real install at ~/smithers/ untouched."
    ;;

  reset)
    if [ ! -d "$SHOTS_DIR" ]; then
      echo "No blank install at $SHOTS_DIR. Run 'pnpm shots:up' first."
      exit 1
    fi
    echo "==> Wiping data + vault (keeping checkout)"
    rm -rf "$SHOTS_DATA" "$SHOTS_VAULT"
    mkdir -p "$SHOTS_DATA" "$SHOTS_VAULT"
    echo "==> Reset. Run 'pnpm shots:up' to relaunch."
    ;;

  *)
    cat <<EOF
Usage: $0 {up|down|reset}

Commands:
  up      Clone (if needed) + install + write disposable config + start dev on :$PORT
  down    Tear down: remove checkout, data dir, and vault
  reset   Wipe data + vault but keep checkout (fast restart for clean wizard state)

Paths:
  checkout: $SHOTS_DIR
  data:     $SHOTS_DATA
  vault:    $SHOTS_VAULT
EOF
    exit 1
    ;;
esac
