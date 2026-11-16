# Base image pinned by digest (multi-arch index: amd64 + arm64); Dependabot bumps the tag and the digest together.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS app
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]

# The bridge to the WF-RAC adapters (scripts/wfrac.mts), bundled with its dependencies (mqtt included) into one file by esbuild,
# so the image has no node_modules. Compose picks the stages with `target: app` and `target: bridge`.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS bridge-bundle
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts ./scripts
RUN npm run bundle:bridge

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS bridge
WORKDIR /app
ENV DATA_DIR=/data
COPY --from=bridge-bundle /app/dist/bridge.mjs ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
CMD ["node", "bridge.mjs"]
