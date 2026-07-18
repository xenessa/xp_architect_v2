FROM node:20-slim

WORKDIR /app

# Install dependencies (incl. dev deps — needed for the build step)
COPY package.json package-lock.json ./
RUN npm ci

# App source (.env ships via build context; not excluded by .dockerignore)
COPY . .

# Build frontend bundle + server bundle into dist/
RUN npm run build

EXPOSE 3000

# NODE_ENV is set by the start script; PORT honored if provided
CMD ["npm", "start"]
