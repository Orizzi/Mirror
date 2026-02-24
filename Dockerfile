FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 101 app && useradd -u 10001 -g 101 -M -s /usr/sbin/nologin app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
RUN mkdir -p /data /cache && chown -R app:app /app /data /cache
ENV NODE_ENV=production
ENV NODE_OPTIONS=--use-openssl-ca
EXPOSE 8085
USER app
CMD ["node", "dist/server.js"]
