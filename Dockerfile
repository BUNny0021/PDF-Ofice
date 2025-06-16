# Step 1: Use the professional, pre-built LibreOffice image as our base.
# This image already contains a working LibreOffice with all dependencies and fonts.
FROM adrienthiery/libreoffice-headless

# Switch to the root user to install Node.js and other tools
USER root

# Install Node.js, npm, and other necessary tools onto the LibreOffice image
RUN apt-get update && \
    apt-get install -y nodejs npm && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set our application's working directory
WORKDIR /usr/src/app

# Copy our application files into the container
COPY . .

# Install our application's npm dependencies
RUN npm install

# Expose the port our app will run on
EXPOSE 3000

# The command to start our Node.js server
CMD ["npm", "start"]