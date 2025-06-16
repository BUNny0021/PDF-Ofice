# Use an official Node.js runtime as the base image.
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Set HOME environment for LibreOffice to prevent silent crashes.
ENV HOME /usr/src/app

# Switch to root user to install system dependencies
USER root

# Install ALL recommended dependencies for LibreOffice and our fonts
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create uploads dir and give the 'node' user ownership of everything.
# This guarantees the app has permission to write files.
RUN mkdir -p /usr/src/app/uploads && \
    chown -R node:node /usr/src/app

# Switch to the non-root 'node' user for security
USER node

# Copy package files (they will now be owned by the 'node' user)
COPY --chown=node:node package*.json ./

# Install npm packages as the 'node' user
RUN npm install

# Copy the rest of your application code (also owned by 'node')
COPY --chown=node:node . .

# Expose the port
EXPOSE 3000

# The command to run your application
CMD ["npm", "start"]