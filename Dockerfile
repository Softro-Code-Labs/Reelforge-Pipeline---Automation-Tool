# Self-contained image: Node app + ffmpeg + edge-tts (primary voice engine)
# + Piper (automatic fallback voice engine) + a default Piper voice model
# baked in, so nothing needs installing on the host (e.g. Render) at runtime.

FROM node:20-bookworm-slim

# ffmpeg: video assembly. python3/pip: installs Piper.
# fonts-dejavu-core/fontconfig: libass (ffmpeg's subtitles filter) needs
# fontconfig at runtime regardless; captions primarily use the Poppins font
# bundled directly in assets/fonts (loaded via the filter's fontsdir option,
# no install needed), with DejaVu Sans installed here only as a last-resort
# system fallback. fc-cache prebuilds the cache at build time so it isn't
# rebuilt (slowly) on every container start.
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
#
# edge-tts: primary voice engine (Microsoft Edge's neural voices, unofficial
# free wrapper -- see src/services/tts.service.ts for the fallback logic).
# piper-tts: automatic fallback if edge-tts's unofficial endpoint is ever
# unreachable or rate-limited.
RUN pip3 install --no-cache-dir --break-system-packages edge-tts piper-tts

# Bake in one default free voice. en_US-libritts_r-medium is trained on
# audiobook narration (LibriTTS-R), so sentence-final intonation and pacing
# suit a spoken script better than a conversational voice like Amy. Swap the
# URLs for a different voice -- see https://github.com/rhasspy/piper/blob/master/VOICES.md
RUN mkdir -p /opt/piper-voices && \
    curl -fsSL -o /opt/piper-voices/en_US-libritts_r-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx" && \
    curl -fsSL -o /opt/piper-voices/en_US-libritts_r-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json"

WORKDIR /app

# Installed separately first so this layer caches unless package.json changes
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Defaults; anything set in Render's dashboard overrides these
ENV TTS_PROVIDER=edge
ENV EDGE_TTS_VOICE=en-US-AndrewNeural
ENV PIPER_BINARY_PATH=piper
ENV PIPER_VOICE_MODEL_PATH=/opt/piper-voices/en_US-libritts_r-medium.onnx
ENV FFMPEG_PATH=ffmpeg
ENV NODE_ENV=production

# Render sets PORT itself and routes to it; this is just documentation
EXPOSE 3000

CMD ["node", "dist/index.js"]
