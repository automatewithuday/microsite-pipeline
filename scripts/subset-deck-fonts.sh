#!/usr/bin/env bash
# One-off: subset DCN-Deck's TTFs to latin woff2 for the deck template.
# Re-run only if the source fonts or the subset ranges change.
# Needs uv (uvx) and a clone of https://github.com/automatewithuday/DCN-Deck.
# Usage: scripts/subset-deck-fonts.sh /path/to/DCN-Deck
set -euo pipefail
SRC_DIR="${1:?usage: subset-deck-fonts.sh /path/to/DCN-Deck}/fonts"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/templates/microsite/fonts"
mkdir -p "$OUT_DIR"
# Latin + en/em dash, curly quotes, ellipsis, rightwards arrow (CTA "→").
UNICODES="U+0000-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+2192"
sub() {
  uvx --from "fonttools[woff]" pyftsubset "$SRC_DIR/$1" \
    --output-file="$OUT_DIR/$2" --flavor=woff2 \
    --layout-features='*' --unicodes="$UNICODES"
}
sub "Fraunces_72pt_SuperSoft-Light.ttf"          "fraunces-300.woff2"
sub "Fraunces_72pt_SuperSoft-LightItalic.ttf"    "fraunces-300i.woff2"
sub "Fraunces_72pt_SuperSoft-Regular.ttf"        "fraunces-400.woff2"
sub "Fraunces_72pt_SuperSoft-Italic.ttf"         "fraunces-400i.woff2"
sub "Fraunces_72pt_SuperSoft-SemiBold.ttf"       "fraunces-600.woff2"
sub "Fraunces_72pt_SuperSoft-SemiBoldItalic.ttf" "fraunces-600i.woff2"
sub "IBMPlexSans-Regular.ttf"            "plex-400.woff2"
sub "IBMPlexSans-Medium.ttf"             "plex-500.woff2"
sub "IBMPlexSans-SemiBold.ttf"           "plex-600.woff2"
sub "IBMPlexSans_Condensed-SemiBold.ttf" "plex-cond-600.woff2"
ls -la "$OUT_DIR"
