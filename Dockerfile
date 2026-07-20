FROM node:20-slim

WORKDIR /app

# Install dependencies (incl. dev deps — needed for the build step)
COPY package.json package-lock.json ./
# node:20-slim ships npm 10.8.2, which intermittently dies mid-install
# ("Exit handler never called") on some hosts — upgrade npm first.
RUN npm install -g npm@11 --no-audit --no-fund && npm ci --no-audit --no-fund

# App source (.env ships via build context; not excluded by .dockerignore)
COPY . .

# Build frontend bundle + server bundle into dist/
RUN npm run build

EXPOSE 3000

# NODE_ENV is set by the start script; PORT honored if provided
CMD ["npm", "start"]
