FROM node:24.11.1-alpine3.23@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS build
RUN apk upgrade --no-cache && apk add --no-cache gcompat
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
COPY tooling/lint-glob ./tooling/lint-glob
COPY frontend ./frontend
RUN npm ci && npm run build
FROM node:24.11.1-alpine3.23@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7
RUN apk upgrade --no-cache && apk add --no-cache gcompat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 NEXT_INTERNAL_PORT=3000 NODE_OPTIONS=--max-old-space-size=256
COPY --from=build --chown=node:node /src/frontend/web/.next/standalone ./
COPY --from=build --chown=node:node /src/frontend/web/public ./frontend/web/public
COPY --from=build --chown=node:node /src/frontend/web/.next/static ./frontend/web/.next/static
COPY --chown=node:node frontend/web/server/gateway.mjs ./frontend/web/server/gateway.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=10 CMD node -e "const r=require('node:http').get('http://127.0.0.1:8080/healthz',s=>{s.resume();process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(2000,()=>{r.destroy();process.exit(1)});"
CMD ["node", "frontend/web/server/gateway.mjs"]
