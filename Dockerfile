FROM ubuntu:jammy

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app
RUN apt-get update ; apt-get install -fy git python3 make g++ npm curl dirmngr apt-transport-https lsb-release ca-certificates
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash
RUN apt-get update ; apt-get -fy install nodejs

RUN npm install --production

CMD ["npm", "start"]
