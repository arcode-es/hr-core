#!/bin/sh
# Ajusta la web compilada a esta instalación al arrancar el contenedor (lo ejecuta la imagen oficial
# de nginx antes de servir). Así una misma imagen vale para cualquier empresa.
#   APP_NAME  nombre de la app en el título, en la app instalada y en las pantallas (por defecto HR-Core)
set -eu
HTML=/usr/share/nginx/html
NAME="${APP_NAME:-HR-Core}"
# Solo letras, números, espacios y signos sencillos: el nombre va dentro de HTML, JSON y JavaScript.
if ! printf '%s' "$NAME" | grep -Eq "^[[:alnum:][:space:]À-ÿ._'()-]{1,40}$"; then
  echo "hr-core: APP_NAME no válido (máx. 40 caracteres: letras, números, espacios y . _ ' ( ) -); se usa HR-Core" >&2
  NAME=HR-Core
fi
SHORT=$(printf '%s' "$NAME" | cut -c1-12)
JS=$(printf '%s' "$NAME" | sed "s/'/\\\\'/g")
# Se parte siempre de los originales: reiniciar con otro nombre no acumula cambios.
for f in index.html manifest.webmanifest; do
  [ -f "$HTML/$f.orig" ] || cp "$HTML/$f" "$HTML/$f.orig"
done
HTMLNAME=$(printf '%s' "$NAME" | sed "s/&/\\\\\\&amp;/g; s/'/\\\\\\&#39;/g")
sed "s|<title>HR-Core</title>|<title>$HTMLNAME</title>|" "$HTML/index.html.orig" > "$HTML/index.html"
JSONNAME=$(printf '%s' "$NAME" | sed 's/&/\\&/g')
JSONSHORT=$(printf '%s' "$SHORT" | sed 's/&/\\&/g')
sed "s|\"name\":\"HR-Core\"|\"name\":\"$JSONNAME\"|; s|\"short_name\":\"HR-Core\"|\"short_name\":\"$JSONSHORT\"|" "$HTML/manifest.webmanifest.orig" > "$HTML/manifest.webmanifest"
printf "window.__HR_CONFIG__ = { appName: '%s' };\n" "$JS" > "$HTML/config.js"
echo "hr-core: web configurada como «$NAME»"
