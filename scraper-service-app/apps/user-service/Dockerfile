FROM node:20-alpine As base
WORKDIR /usr/src/app

FROM base As dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 1000000

# Development
FROM dependencies As development
COPY . .

# Build Stage
FROM development As build
RUN yarn build user-service

ARG NODE_MAILER_USER
ARG NODE_MAILER_SECRET

# Production Image
FROM node:20-alpine As production
WORKDIR /usr/src/app

COPY --from=build /usr/src/app/dist/apps/user-service ./dist
COPY --from=dependencies /usr/src/app/node_modules ./node_modules

CMD ["node", "dist/apps/user-service/src/main"]