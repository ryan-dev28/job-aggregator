FROM node:20-bullseye As base
WORKDIR /usr/src/app

# Install all required dependencies
RUN apt-get update && \
    apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer env vars
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV DISPLAY=:99
ENV XVFB_WHD=1280x720x16

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 1000000

FROM base As development
COPY . .

FROM development As build
RUN yarn build scraper-service

FROM node:20-bullseye As production
WORKDIR /usr/src/app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y \
    chromium \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV DISPLAY=:99
ENV XVFB_WHD=1280x720x16

COPY --from=build /usr/src/app/dist/apps/scraper-service ./dist
COPY --from=development /usr/src/app/node_modules ./node_modules

CMD ["sh", "-c", "Xvfb :99 -ac -screen 0 $XVFB_WHD -nolisten tcp & export DISPLAY=:99 && node dist/main"]