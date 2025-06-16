#!/usr/bin/env bash
# exit on error
set -o errexit

# Install npm dependencies
npm install

# Install system dependencies (LibreOffice, Poppler for PDF tools, and Fonts)
apt-get update && apt-get install -y libreoffice poppler-utils fonts-liberation fonts-dejavu-core