#!/bin/sh
# Copy Tripo Studio downloads (<id>_rig.decoded-*.glb, <id>_{idle,walk,attack}.glb) into assets-src/models/anim/<id>/.
# Usage: sh scripts/stage_tripo_anims.sh [download dir, default ~/Documents/TripoStudio/ironhold]
SRC=${1:-"$HOME/Documents/TripoStudio/ironhold"}
cd "$(dirname "$0")/.." || exit 1
for rig in "$SRC"/*_rig.decoded-*.glb; do
  id=$(basename "$rig" | sed 's/_rig\.decoded-.*//')
  mkdir -p "assets-src/models/anim/$id"
  cp "$rig" "assets-src/models/anim/$id/rig.glb"
  for c in idle walk attack; do
    [ -f "$SRC/${id}_$c.glb" ] && cp "$SRC/${id}_$c.glb" "assets-src/models/anim/$id/$c.glb"
  done
  echo "$id: $(ls "assets-src/models/anim/$id" | tr '\n' ' ')"
done
