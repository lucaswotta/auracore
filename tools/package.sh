#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
package_dir=$(mktemp -d)
trap 'rm -rf "$package_dir"' EXIT

zip -q "$package_dir/auracore.zip" \
  manifest.json _locales/*/messages.json background.js content.js engine.js offscreen.js page.js popup.js scenes.js styles.js \
  offscreen.html popup.html popup.css \
  LICENSE artwork/*.webp audio/*.webm fonts/*.woff2 fonts/licenses/*.txt icons/*.png icons/*.svg support/*.svg

mkdir -p dist
mv "$package_dir/auracore.zip" dist/auracore.zip
echo dist/auracore.zip
