FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Create directory for environment files
RUN mkdir -p env

# Use port 3000 for fly.io
ENV APP_PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
