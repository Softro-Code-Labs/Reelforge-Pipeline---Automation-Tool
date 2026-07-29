# Self-contained image: Node app + ffmpeg + Piper TTS + a default voice model
# baked in, so nothing needs installing on the host (e.g. Render) at runtime.

FROM node:20-bookworm-slim

# ffmpeg: video assembly. python3/pip: installs Piper.
# fonts-dejavu-core/fontconfig: the subtitles filter (libass) needs a real,
# installed font -- without one it falls back to slow, repeated font
# matching for every caption. fc-cache prebuilds the cache at build time so
# it isn't rebuilt (slowly) on every container start.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# --break-system-packages: Debian's Python is externally-managed (PEP 668);
# fine here since this is a throwaway container image.
RUN pip3 install --no-cache-dir --break-system-packages piper-tts

# Bake in one default free voice. Swap the URLs for a different voice --
# see https://github.com/rhasspy/piper/blob/master/VOICES.md
RUN mkdir -p /opt/piper-voices && \
    curl -fsSL -o /opt/piper-voices/en_US-amy-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx" && \
    curl -fsSL -o /opt/piper-voices/en_US-amy-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

WORKDIR /app

# Installed separately first so this layer caches unless package.json changes
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Defaults; anything set in Render's dashboard overrides these
ENV PIPER_BINARY_PATH=piper
ENV PIPER_VOICE_MODEL_PATH=/opt/piper-voices/en_US-amy-medium.onnx
ENV FFMPEG_PATH=ffmpeg
ENV NODE_ENV=production

# Render sets PORT itself and routes to it; this is just documentation
EXPOSE 3000

CMD ["node", "dist/index.js"]
