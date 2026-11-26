#!/usr/bin/env sh
# Wraps cuaderno.html (the claude.ai artifact source) into a standalone page
# that can be hosted anywhere (Netlify Drop, Cloudflare Pages, GitHub Pages).
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  printf '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  printf '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%%}[hidden]{display:none!important}</style></head><body>'
  cat cuaderno.html
  printf '</body></html>\n'
} > dist/index.html
echo "dist/index.html listo"
