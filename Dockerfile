FROM node:lts-alpine

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app
RUN apk add --no-cache git python make g++
RUN npm install --production

CMD ["npm", "start"]
