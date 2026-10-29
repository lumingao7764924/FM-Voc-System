#!/bin/sh
set -eu

if [ -z "${API_UPSTREAM:-}" ]; then
  echo "API_UPSTREAM is required, e.g. https://voc-api-xxxxx.us-central1.run.app" >&2
  exit 1
fi

# 去掉末尾斜杠
API_UPSTREAM=$(printf '%s' "$API_UPSTREAM" | sed 's:/*$::')
API_HOST=$(printf '%s' "$API_UPSTREAM" | sed -E 's|^https?://||' | cut -d/ -f1)

export API_UPSTREAM API_HOST
envsubst '${API_UPSTREAM} ${API_HOST}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
