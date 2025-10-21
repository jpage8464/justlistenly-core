FROM node:18-alpine
WORKDIR /app

# Copy only package manifests first
COPY package*.json ./

# Use npm install since we don't have a lockfile yet
RUN npm install --omit=dev

# Now copy the rest of the app
COPY . .

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node","server.js"]
