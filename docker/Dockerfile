FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts/build-widgets.ts ./scripts/build-widgets.ts
COPY src ./src
COPY ui ./ui
RUN npm run build && npm prune --omit=dev

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    TRANSPORT=http

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE README.md ./

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/bin.js"]
