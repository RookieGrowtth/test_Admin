FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "server.js"]
