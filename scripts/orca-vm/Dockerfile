FROM node:22-bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG CODEX_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    openssh-server \
    procps \
    python3 \
    sudo \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@openai/codex@${CODEX_VERSION}"

RUN useradd --create-home --shell /bin/bash orca \
  && install -d -m 0755 /run/sshd /workspace \
  && install -d -m 0700 -o orca -g orca /home/orca/.ssh \
  && chown orca:orca /workspace \
  && printf 'orca ALL=(ALL) NOPASSWD:ALL\n' >/etc/sudoers.d/orca \
  && chmod 0440 /etc/sudoers.d/orca \
  && printf '\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers orca\n' >>/etc/ssh/sshd_config \
  && ssh-keygen -A \
  && git config --system --add safe.directory '*'

COPY docker-ssh-entrypoint.sh /usr/local/bin/orca-docker-ssh-entrypoint
RUN chmod 0755 /usr/local/bin/orca-docker-ssh-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]
CMD []
