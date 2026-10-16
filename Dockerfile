FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m workbench && mkdir /data /work && chown workbench:workbench /data
COPY scripts/install_phoneinfoga.py /tmp/install_phoneinfoga.py
RUN python /tmp/install_phoneinfoga.py && phoneinfoga version && rm /tmp/install_phoneinfoga.py
COPY scripts/install_research_tools.py /tmp/install_research_tools.py
RUN python /tmp/install_research_tools.py && rm /tmp/install_research_tools.py
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl libarchive-zip-perl chromium chromium-driver xvfb dumb-init fonts-liberation util-linux iproute2 openvpn wireguard-tools wireguard-go iptables curl procps && rm -rf /var/lib/apt/lists/*
COPY scripts/install_browser_tool.py /tmp/install_browser_tool.py
RUN python /tmp/install_browser_tool.py && rm /tmp/install_browser_tool.py
COPY scripts/install_instagram_tool.py /tmp/install_instagram_tool.py
RUN python /tmp/install_instagram_tool.py && rm /tmp/install_instagram_tool.py
COPY requirements-core.txt /tmp/requirements-core.txt
RUN pip install --no-cache-dir -r /tmp/requirements-core.txt && rm /tmp/requirements-core.txt
COPY scripts/install_consensus.py /tmp/install_consensus.py
RUN python /tmp/install_consensus.py && rm /tmp/install_consensus.py
COPY scripts/install_deepface.py /tmp/install_deepface.py
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/* && python /tmp/install_deepface.py && rm /tmp/install_deepface.py
COPY scripts/install_toutatis.py /tmp/install_toutatis.py
RUN python /tmp/install_toutatis.py && rm /tmp/install_toutatis.py
COPY . .
RUN python scripts/verify_frontend.py && python scripts/build_provider_catalogue.py && python scripts/build_research_profiles.py
USER workbench
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=2)"
ENTRYPOINT ["/usr/bin/dumb-init", "--", "python", "scripts/container_entry.py"]
CMD ["python", "server.py"]

