# Base image pinned by digest (multi-arch index: amd64 + arm64); Dependabot bumps the tag and the digest together.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS app
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
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS bridge-bundle
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts ./scripts
RUN npm run bundle:bridge

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS bridge
WORKDIR /app
ENV DATA_DIR=/data
COPY --from=bridge-bundle /app/dist/bridge.mjs ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
CMD ["node", "bridge.mjs"]
