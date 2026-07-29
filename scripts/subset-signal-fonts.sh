#!/usr/bin/env bash
# One-off: fetch the Archivo + Geist Mono variable TTFs from the google/fonts
# repo, pin static instances, and subset to latin woff2 for the Signal deck
# template. Re-run only if the instances or subset ranges change. Needs uv (uvx).
# Usage: scripts/subset-signal-fonts.sh
set -euo pipefail
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/templates/microsite-signal/fonts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$OUT_DIR"

# Latin + en/em dash, curly quotes, ellipsis, rightwards arrow (CTA "→").
UNICODES="U+0000-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+2192"

curl -fsSL -o "$TMP_DIR/archivo-var.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
curl -fsSL -o "$TMP_DIR/geistmono-var.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/geistmono/GeistMono%5Bwght%5D.ttf"

# Pin a static instance out of a variable font.
inst() { # inst <src> <axes...> -> writes to the file named by the last arg
  local src="$1"; shift
  local out="${*: -1}"
  local axes=("${@:1:$#-1}")
  uvx --from fonttools fonttools varLib.instancer "$src" "${axes[@]}" -o "$out" >/dev/null
}

inst "$TMP_DIR/archivo-var.ttf" wght=400 wdth=100 "$TMP_DIR/archivo-400.ttf"
inst "$TMP_DIR/archivo-var.ttf" wght=500 wdth=100 "$TMP_DIR/archivo-500.ttf"
inst "$TMP_DIR/archivo-var.ttf" wght=700 wdth=100 "$TMP_DIR/archivo-700.ttf"
# Expanded width axis for poster headlines (roster-site's .display-wide = 118%).
inst "$TMP_DIR/archivo-var.ttf" wght=700 wdth=118 "$TMP_DIR/archivo-expanded-700.ttf"
inst "$TMP_DIR/geistmono-var.ttf" wght=400 "$TMP_DIR/geistmono-400.ttf"

sub() {
  uvx --from "fonttools[woff]" pyftsubset "$TMP_DIR/$1" \
    --output-file="$OUT_DIR/$2" --flavor=woff2 \
    --layout-features='*' --unicodes="$UNICODES"
}
sub "archivo-400.ttf"          "archivo-400.woff2"
sub "archivo-500.ttf"          "archivo-500.woff2"
sub "archivo-700.ttf"          "archivo-700.woff2"
sub "archivo-expanded-700.ttf" "archivo-expanded-700.woff2"
sub "geistmono-400.ttf"        "geistmono-400.woff2"
ls -la "$OUT_DIR"
