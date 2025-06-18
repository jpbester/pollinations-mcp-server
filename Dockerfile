# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the application source code
COPY . .

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run the application
CMD ["node", "server.js"]
