# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# WARNING: Vite inlines the VITE_* variables into the bundle at BUILD TIME.
# So the API URL is baked in here — pass it as a build-arg per environment:
#   docker build --build-arg VITE_API_URL=https://api.seu-dominio.com/api -t meu-front .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# nginx already runs in the foreground in the official image (default CMD).
