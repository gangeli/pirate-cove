#!/bin/bash
# Resize Poly Haven source textures into web-ready 1k JPGs.
SRC=../assets-src/polyhaven/textures
DST=public/assets/tex
mkdir -p $DST
prep() { # name srcname
  ffmpeg -loglevel error -y -i $SRC/$2/$2_Diffuse.jpg -vf scale=1024:1024 -q:v 3 $DST/$1_d.jpg
  ffmpeg -loglevel error -y -i $SRC/$2/$2_nor_gl.jpg -vf scale=1024:1024 -q:v 3 $DST/$1_n.jpg
}
prep sand aerial_sand
prep wetsand damp_beach_sand
prep grass leafy_grass
prep jungle brown_mud_leaves_01
prep rock aerial_rocks_02
prep cliff rock_boulder_dry
prep dirt rocky_trail
prep thatch reed_roof_04
prep planks brown_planks_05
prep oldplanks old_planks_02
prep plaster plastered_stone_wall
prep stone large_sandstone_blocks
prep tiles clay_roof_tiles_02
prep palmbark palm_bark
