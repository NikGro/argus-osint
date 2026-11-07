FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
# System libraries that tools need but cannot install at runtime (the app runs
# unprivileged). The research tools themselves, plugin code and Python
# environments are downloaded on demand into the data volume.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libimage-exiftool-perl libarchive-zip-perl chromium chromium-driver xvfb \
      dumb-init fonts-liberation iproute2 openvpn wireguard-tools wireguard-go \
      iptables curl procps libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m workbench && mkdir /data && chown workbench:workbench /data
COPY . .
# Native plugins are downloaded from this source revision and checked against
# plugins/native.json (CI verifies it matches the repository).
ARG ARGUS_SOURCE_REF=
ENV ARGUS_SOURCE_REF=${ARGUS_SOURCE_REF}
RUN python scripts/verify_frontend.py
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=2)"
ENTRYPOINT ["/usr/bin/dumb-init", "--", "python", "scripts/container_entry.py"]
CMD ["python", "server.py"]
