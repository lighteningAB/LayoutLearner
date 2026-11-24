#!/bin/sh
# Run from the repo root with the dev server up (yarn dev). Writes docs/screenshots/*.png.
set -e
V="node scripts/verify.mjs --size 1440x900"
S() { echo "localStorage.setItem('ll:v1:settings', JSON.stringify($1))"; }
# Hide the Next.js dev badge so it stays out of the pictures.
H="eval:document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())"
mkdir -p docs/screenshots
$V "goto:/?seed=7" wait:3000 "type:they an" wait:800 "$H" shot:hero
$V "goto:/" "eval:$(S "{layoutId:'corne-36'}")" "goto:/?seed=7" wait:4000 "type:they an" wait:800 "$H" shot:test-split
$V "goto:/learn" wait:2000 "$H" shot:learn-map
$V "goto:/learn/home-fj" wait:3000 "$H" shot:lesson
$V "goto:/layouts" wait:2500 "$H" shot:layouts
$V "goto:/" "eval:$(S "{theme:'whiteprint'}")" "goto:/?seed=7" wait:4000 "type:they an" wait:800 "$H" shot:theme-paper
for n in hero test-split learn-map lesson layouts theme-paper; do cp .verify/$n.png docs/screenshots/$n.png; done
ls -la docs/screenshots
