# Harbor Goods — Olares Payment example shop
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Local file: dependency must be present before npm ci
COPY package.json package-lock.json ./
COPY vendor ./vendor

RUN npm ci --omit=dev && npm cache clean --force

COPY server.js format.js index.html admin.html ./

# Generate a sanitized config.js in-image: whatever was pasted locally for dev
# must never reach the image — container values come from env vars instead.
RUN printf '/* generated in image — runtime values come from env vars */\nexport const CONFIG = { port: 32000, shopPublicUrl: "", apiKey: "", apiSecret: "", webhookSecret: "" };\n' > config.js

ENV PORT=32000
EXPOSE 32000

# node image ships the `node` user as uid/gid 1000 — matches Olares userspace
USER node
CMD ["npx", "tsx", "server.js"]
