# Guano, as one container.
#
# Two stages so the image does not carry the SPA's build toolchain: the first
# installs everything and builds dist/, the second keeps only production
# dependencies and the files the server actually serves.
#
# The data dir is a VOLUME. Everything that matters — projects, drafts, media,
# users, the published site — lives there, and nothing in the image is worth
# keeping. One container is one project is one site; see the README.

FROM node:22-slim AS build
WORKDIR /app
# sharp ships prebuilt binaries for this platform, so no toolchain is needed
COPY package.json package-lock.json ./
COPY packages/guano/package.json packages/guano/
COPY packages/create-guano/package.json packages/create-guano/
RUN npm ci
COPY . .
RUN npm run build-only


FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# the server reads and writes only here
ENV GUANO_DATA_DIR=/data
ENV PORT=4174

COPY package.json package-lock.json ./
COPY packages/guano/package.json packages/guano/
COPY packages/create-guano/package.json packages/create-guano/
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY src ./src
COPY packages/guano/runtime ./packages/guano/runtime
COPY --from=build /app/dist ./dist

# `node` is uid 1000 in this image and owns the volume mount point. Running as
# root would leave every file in the data dir root-owned on the host.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 4174
# the preview server, which is token-gated but still worth not exposing by
# accident — publish it only if you use the MCP preview tool from elsewhere
EXPOSE 4175

# Reports draining during a graceful shutdown, so an orchestrator takes the
# container out of rotation before the socket closes rather than racing it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4174)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# exec form, so the process is PID 1 and receives SIGTERM directly
CMD ["node", "server/index.mjs"]
