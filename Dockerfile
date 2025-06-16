# Step 1: Start with a stable, official Debian base image.
FROM debian:bookworm-slim

# Step 2: Set an environment variable to prevent installers from asking interactive questions.
ENV DEBIAN_FRONTEND=noninteractive

# Step 3: Update the system and install everything we need in one go.
# - nodejs and npm: To run our application.
# - libreoffice: The full office suite.
# - poppler-utils: For the PDF-to-JPG tool.
# - fonts-liberation & fonts-dejavu-core: Critical fonts to prevent silent crashes.
# We are NOT using --no-install-recommends. We want everything.
RUN apt-get update && \
    apt-get install -y \
    nodejs \
    npm \
    libreoffice \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Step 4: Set the working directory for our application.
WORKDIR /usr/src/app

# Step 5: Copy our application files into the container.
COPY . .

# Step 6: Install our application's dependencies.
RUN npm install

# Step 7: Expose the port our app runs on.
EXPOSE 3000

# Step 8: The command to start our Node.js server.
CMD ["npm", "start"]