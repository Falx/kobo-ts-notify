# Kobo Deal Notifier — frontend image (Angular SPA served by nginx)
# nginx also proxies /api to the backend container so the app is same-origin.

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY angular.json tsconfig.json tsconfig.app.json proxy.conf.json ./
COPY src ./src
COPY public ./public

# Output goes to dist/browser (the Angular application builder appends /browser).
RUN npm run build -- --output-path=dist

# ---- runtime stage ----
FROM nginx:1.27-alpine AS runtime

COPY conf/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]