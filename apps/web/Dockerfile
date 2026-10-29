# VOC Web static — serve with nginx on Cloud Run
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm install --workspace=@voc/shared --workspace=@voc/web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @voc/shared && npm run build -w @voc/web

FROM nginx:1.27-alpine
RUN apk add --no-cache gettext
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.sh /docker-entrypoint-voc.sh
RUN chmod +x /docker-entrypoint-voc.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint-voc.sh"]
