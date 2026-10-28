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
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
