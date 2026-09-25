FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html app.js styles.css server.js ./

RUN mkdir -p /data

ENV PORT=3000
ENV DB_PATH=/data/rewards.db
EXPOSE 3000

CMD ["node", "server.js"]
