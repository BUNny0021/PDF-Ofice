#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
npm install

# Install system dependencies required by our Node packages
apt-get update && apt-get install -y libreoffice poppler-utils