FROM adrienthiery/libreoffice-headless


USER root


RUN apt-get update && \
    apt-get install -y nodejs npm && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY . .


RUN npm install

EXPOSE 3000

CMD ["npm", "start"]