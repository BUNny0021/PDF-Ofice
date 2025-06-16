# Use an official Node.js runtime as the base image.
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# ---- CRITICAL FIX 1: Set HOME environment for LibreOffice ----
# This prevents silent crashes related to user profile creation.
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

# ---- CRITICAL FIX 2: Create uploads dir and set permissions ----
# We create the directory and give the 'node' user ownership of everything.
# This guarantees write permissions.
RUN mkdir -p /usr/src/app/uploads && \
    chown -R node:node /usr/src/app

# Switch to the non-root 'node' user for security and to run the app
USER node

# Copy package files (they will be owned by 'node' now)
COPY --chown=node:node package*.json ./

# Now install npm packages as the 'node' user
RUN npm install

# Copy the rest of your application code (also owned by 'node')
COPY --chown=node:node . .

# Expose the port
EXPOSE 3000

# The command to run your application as the 'node' user
CMD ["npm", "start"]