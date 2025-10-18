FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Create directory for environment files
RUN mkdir -p env

# Use port 8080 for fly.io
ENV APP_PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
