# --- build the React UI
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- runtime: Express API + static UI, PM2 cluster
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY domains ./domains
COPY ecosystem.config.js ./
COPY --from=web /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["npx", "pm2-runtime", "ecosystem.config.js"]
