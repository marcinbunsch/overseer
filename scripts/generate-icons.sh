#!/bin/bash
set -euo pipefail

# Generate Tauri icons from the rounded design source
# Requires: sips (macOS built-in), iconutil (macOS built-in), magick (ImageMagick)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PROJECT_DIR/design/overseer_icon_rounded_1024.png"
ICONS_DIR="$PROJECT_DIR/src-tauri/icons"
TMPDIR="$(mktemp -d)"

trap 'rm -rf "$TMPDIR"' EXIT

if [ ! -f "$SOURCE" ]; then
  echo "Error: Source icon not found at $SOURCE"
  exit 1
fi

# Check for ImageMagick
if ! command -v magick &>/dev/null; then
  echo "Error: ImageMagick (magick) is required. Install with: brew install imagemagick"
  exit 1
fi

echo "Generating Tauri icons from: $SOURCE"
echo "Output directory: $ICONS_DIR"

# Add ~10% padding around icon for proper macOS dock sizing
PADDED="$TMPDIR/padded_1024.png"
echo "  Adding dock padding to source..."
magick "$SOURCE" -resize 824x824 -gravity center -background none -extent 1024x1024 "$PADDED"

# Standard Tauri PNG icons
declare -a SIZES=(
  "32x32:32"
  "128x128:128"
  "128x128@2x:256"
)

for entry in "${SIZES[@]}"; do
  name="${entry%%:*}"
  size="${entry##*:}"
  output="$ICONS_DIR/${name}.png"
  echo "  ${name}.png (${size}x${size})"
  sips -z "$size" "$size" "$PADDED" --out "$output" >/dev/null 2>&1
done

# Windows Store / Square Logo icons
declare -a SQUARE_SIZES=(
  "Square30x30Logo:30"
  "Square44x44Logo:44"
  "Square71x71Logo:71"
  "Square89x89Logo:89"
  "Square107x107Logo:107"
  "Square142x142Logo:142"
  "Square150x150Logo:150"
  "Square284x284Logo:284"
  "Square310x310Logo:310"
  "StoreLogo:50"
)

for entry in "${SQUARE_SIZES[@]}"; do
  name="${entry%%:*}"
  size="${entry##*:}"
  output="$ICONS_DIR/${name}.png"
  echo "  ${name}.png (${size}x${size})"
  sips -z "$size" "$size" "$PADDED" --out "$output" >/dev/null 2>&1
done

# Main icon.png (512x512)
echo "  icon.png (512x512)"
sips -z 512 512 "$PADDED" --out "$ICONS_DIR/icon.png" >/dev/null 2>&1

# Generate .icns via iconutil
echo "  icon.icns (via iconutil)"
ICONSET="$TMPDIR/icon.iconset"
mkdir -p "$ICONSET"
sips -z 16 16 "$PADDED" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1
sips -z 32 32 "$PADDED" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1
sips -z 32 32 "$PADDED" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1
sips -z 64 64 "$PADDED" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1
sips -z 128 128 "$PADDED" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1
sips -z 256 256 "$PADDED" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
sips -z 256 256 "$PADDED" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1
sips -z 512 512 "$PADDED" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
sips -z 512 512 "$PADDED" --out "$ICONSET/icon_512x512.png" >/dev/null 2>&1
cp "$PADDED" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns"

# Generate .ico via ImageMagick
echo "  icon.ico (via magick)"
magick "$PADDED" -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"

# Generate dev icon with yellow "DEV" badge (used in debug builds)
echo "  icon-dev.png (512x512, yellow DEV badge)"
magick "$PADDED" \
  \( -size 300x100 xc:none \
     -fill '#FFD700' -draw 'roundrectangle 0,0 299,99 20,20' \
     -font Helvetica-Bold -pointsize 64 -fill '#000000' -gravity center -annotate +0+0 'DEV' \
     -background none -rotate 35 \
  \) -gravity NorthEast -geometry +0+0 -composite \
  -resize 512x512 "$ICONS_DIR/icon-dev.png"

echo ""
echo "Done! Generated $(ls "$ICONS_DIR" | wc -l | tr -d ' ') icons in $ICONS_DIR"
