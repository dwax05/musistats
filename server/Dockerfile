# The server runs TypeScript directly via tsx — no compile step.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx typescript
COPY . .
EXPOSE 3500
CMD ["npx", "tsx", "src/index.ts"]
