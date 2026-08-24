# Draft Advisor — one image, two roles (api / worker), selected by the start command.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first so code changes do not reinstall everything.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/ingest/package.json apps/ingest/
COPY apps/model/package.json apps/model/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# TypeScript is stripped at runtime, so there is no build step.
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "apps/api/src/index.ts"]
