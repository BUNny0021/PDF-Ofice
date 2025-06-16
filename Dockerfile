# Step 1: Start with a stable, official Debian base image.
FROM debian:bookworm-slim

# Step 2: Set an environment variable to prevent installers from asking interactive questions.
ENV DEBIAN_FRONTEND=noninteractive

# Step 3: Update the system and install necessary tools, including curl.
RUN apt-get update && \
    apt-get install -y curl

# Step 4: Use the official NodeSource script to install the correct Node.js version (v20).
# This is the most reliable method and fixes the version mismatch.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Step 5: Now, install Node.js, LibreOffice, and all other dependencies.
RUN apt-get update && \
    apt-get install -y \
    nodejs \
    libreoffice \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Step 6: Set the working directory for our application.
WORKDIR /usr/src/app

# Step 7: Copy our application files into the container.
COPY . .

# Step 8: Install our application's dependencies.
RUN npm install

# Step 9: Expose the port our app runs on.
EXPOSE 3000

# Step 10: The command to start our Node.js server.
CMD ["npm", "start"]