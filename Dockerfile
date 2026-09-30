FROM node:22.14.0-alpine3.21

ENV NODE_ENV=production \
    WEB_PORT=8501
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node web ./web

USER node
EXPOSE 8501
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8501/healthz || exit 1
CMD ["node", "web/server.js"]

