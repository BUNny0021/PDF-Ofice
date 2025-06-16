# Use an official Node.js runtime as the base image.
# We're using Node 20 as it's the current LTS (Long-Term Support) version.
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Temporarily switch to the root user to install system dependencies
USER root

# Update package lists and install LibreOffice and Poppler, then clean up.
# --no-install-recommends keeps the image size smaller.
RUN apt-get update && \
    apt-get install -y libreoffice poppler-utils --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if it exists)
# This is a Docker optimization to cache the npm install layer
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of your application code into the container
COPY . .

# Your app runs on port 3000, so we expose it
EXPOSE 3000

# The command to run your application
CMD ["npm", "start"]