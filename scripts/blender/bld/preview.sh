#!/bin/bash
# Build one building (fast AO) and render a contact sheet: two close three-quarter views from opposite
# sides plus a gameplay-distance view, side by side.
#   scripts/blender/bld/preview.sh <registry name> <gallery item> <out.png> [close dist] [pitch]
# e.g. scripts/blender/bld/preview.sh tavern tavern /tmp/x/tavern.png 4.5 0.5
# Needs the dev server on :5173 (npx vite --port 5173).
set -e
cd "$(dirname "$0")/../../.."
N=$1; Q=$2; OUT=$3; D=${4:-4}; P=${5:-0.5}
TMP=$(mktemp -d)
FAST=1 /home/user/blender-4.2.3-linux-x64/blender -b -P scripts/blender/bld/build.py -- "$N" 2>&1 | grep -E "BUILT|Error|Traceback|line [0-9]+," | head -12 || true
node scripts/shot.mjs "play=1&frames=6&nohud=1&gallery=$Q&dist=$D&pitch=$P&lift=0.6&yaw=0.6" $TMP/a.png 800 600 >/dev/null 2>&1
node scripts/shot.mjs "play=1&frames=6&nohud=1&gallery=$Q&dist=$D&pitch=$P&lift=0.6&yaw=3.5" $TMP/b.png 800 600 >/dev/null 2>&1
node scripts/shot.mjs "play=1&frames=6&nohud=1&gallery=$Q&dist=$(python3 -c "print($D*2.2)")&pitch=0.75&lift=0.5&yaw=0.9" $TMP/c.png 800 600 >/dev/null 2>&1
python3 - "$TMP" "$OUT" <<'PY'
import sys
from PIL import Image
t, out = sys.argv[1], sys.argv[2]
ims = [Image.open(f'{t}/{n}.png') for n in 'abc']
c = Image.new('RGB', (2400, 600))
for i, im in enumerate(ims):
    c.paste(im, (i * 800, 0))
c.save(out)
PY
rm -rf $TMP
echo "wrote $OUT"
