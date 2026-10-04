# Munder Mobile gateway — 헤드리스 VM/컨테이너용 이미지
FROM node:22-bookworm
# node-pty 네이티브 빌드 + 에이전트가 쓸 기본 도구
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# 기본으로 Claude Code CLI를 설치합니다. 다른 엔진은 AGENT_CLIS에 npm 패키지명을 추가하세요.
ARG AGENT_CLIS="@anthropic-ai/claude-code"
RUN if [ -n "$AGENT_CLIS" ]; then npm i -g $AGENT_CLIS; fi
WORKDIR /opt/munder-mobile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY gateway ./gateway
COPY web ./web
RUN useradd -m -s /bin/bash agent && mkdir -p /work && chown agent /work
USER agent
ENV HOST=0.0.0.0 PORT=8787 MD_WORKSPACE=/work MD_HIVE=/home/agent/.munder-difflin-mobile/hive LANG=C.UTF-8
EXPOSE 8787
CMD ["node", "gateway/server.js"]
