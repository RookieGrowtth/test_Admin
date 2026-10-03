FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY backend ./backend
COPY public ./public
COPY templates ./templates
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "server.js"]
