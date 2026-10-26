# syntax=docker/dockerfile:1
# Servidor do WorkForces, com o site e o mapa. Para um time, use deploy/docker-compose.yml (com o Caddy na frente, em HTTPS).
# Node 24 LTS; ao sair uma versão de segurança do Node, atualize as duas linhas FROM.

FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2
# Só os manifestos primeiro: a instalação fica em cache enquanto as dependências não mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/bridge/package.json packages/bridge/
COPY packages/e2e/package.json packages/e2e/
RUN pnpm install --frozen-lockfile --filter "@workforces/server..." --filter "@workforces/client..."
COPY packages/protocol packages/protocol
COPY packages/server packages/server
COPY packages/client packages/client
RUN pnpm --filter "@workforces/server..." --filter "@workforces/client" run build
# A imagem final leva só as dependências de produção do servidor.
RUN rm -rf node_modules packages/*/node_modules \
  && pnpm install --frozen-lockfile --prod --filter "@workforces/server..."

FROM node:24.22.1-bookworm-slim
ENV NODE_ENV=production \
    WF_HOST=0.0.0.0 \
    WF_PORT=4600 \
    WF_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/protocol/package.json packages/protocol/
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/packages/protocol/node_modules packages/protocol/node_modules
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/node_modules packages/server/node_modules
COPY --from=build /app/packages/client/dist packages/client/dist
COPY assets/map assets/map
# A arte do LPC (OGA-BY 3.0) vai junto, então os créditos também.
COPY LICENSE ./
COPY assets/CREDITS.md assets/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4600/api/me').then((r) => process.exit(r.status === 401 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "packages/server/dist/cli.js", "start"]
