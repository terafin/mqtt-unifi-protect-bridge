FROM ubuntu:jammy

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app
RUN apt-get update ; apt-get install -fy git python3 make g++ curl dirmngr apt-transport-https lsb-release ca-certificates
RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
RUN bash nodesource_setup.sh
RUN apt-get install -fy nodejs

RUN npm install --production

CMD ["npm", "start"]
