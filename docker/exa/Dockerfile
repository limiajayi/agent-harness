FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts exa-mcp-server@3.4.3
USER node
ENTRYPOINT ["exa-mcp-server"]