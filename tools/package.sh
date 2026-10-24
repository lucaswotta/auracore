#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
package_dir=$(mktemp -d)
trap 'rm -rf "$package_dir"' EXIT

shared="_locales/*/messages.json content.js engine.js page.js popup.js scenes.js styles.js background.js
  popup.html popup.css LICENSE artwork/*.webp audio/*.webm fonts/*.woff2 fonts/licenses/*.txt
  icons/*.png icons/*.svg support/*.svg"

# Chrome e Edge.
zip -q "$package_dir/auracore.zip" manifest.json offscreen.html offscreen.js $shared

# Firefox: manifest próprio, sem o documento offscreen.
mkdir "$package_dir/firefox"
node tools/firefox-manifest.mjs > "$package_dir/firefox/manifest.json"
zip -q "$package_dir/auracore-firefox.zip" $shared
(cd "$package_dir/firefox" && zip -q ../auracore-firefox.zip manifest.json)

mkdir -p dist
mv "$package_dir/auracore.zip" "$package_dir/auracore-firefox.zip" dist/
echo dist/auracore.zip
echo dist/auracore-firefox.zip
