# AI Video Pipeline (zero API cost) — generate for manual upload

Scheduled pipeline: **Gemini (free tier) → Pexels free stock footage → Piper (free local TTS)
→ ffmpeg assembly**. The app generates the video plus a ready-to-use title, caption, and
hashtags, and shows them in a UI where you preview, download, and post manually — there is
no automated TikTok publishing step.

Nothing in this chain has a per-run dollar cost. The tradeoff, stated plainly: this produces a
fast-paced stock-footage explainer with a synthetic voice, not a Veo-style AI-generated video
(Veo has no free API tier at all).

## 1. Install prerequisites (all free)

- **Node.js** 18+
- **ffmpeg** (and ffprobe, bundled with it) — `apt install ffmpeg` / `brew install ffmpeg`
- **Piper TTS** — download a prebuilt binary from https://github.com/rhasspy/piper/releases
  and a voice model (`.onnx` + `.onnx.json`) from https://github.com/rhasspy/piper/blob/master/VOICES.md
  (e.g. `en_US-amy-medium`). No account or API key needed, runs fully offline.

## 2. Get free API keys

- **Gemini**: create a key at https://aistudio.google.com/apikey — Flash models are free
  within rate limits (your content may be used to improve Google's products on the free tier).
- **Pexels**: free key at https://www.pexels.com/api/ — generous rate limits, no cost.

## 3. Posting to TikTok (manual)

This project deliberately does not publish to TikTok automatically. There's no TikTok developer
app, no OAuth, and no audit wait to deal with. Instead, each run gives you a finished video plus
title/caption/hashtag text in the UI (`npm run ui`), which you download and post yourself from
the TikTok app:

1. Run a generation (see step 5) and open the UI.
2. Preview the video, then tap **Download video (.mp4)**.
3. In the TikTok app: tap **+** → **Upload** → select the downloaded video.
4. Copy the **Title**, **Caption**, and **Hashtags** shown in the UI into TikTok's caption box
   (there's a Copy button next to each), then tap **Post**.

## 4. Configure

```
cp .env.example .env
# fill in GEMINI_API_KEY, PEXELS_API_KEY, PIPER_* values
```

## 5. Run

```bash
npm install

# Open the UI: click "Generate Now" and it runs the full pipeline on demand
npm run ui

# Or test a single pipeline run end-to-end from the command line, no UI:
npm run run:once
```

Check `./data/jobs.json` after any run for status and logs. Generated clips, audio, and the
final video for each run are kept under `./workdir/<job-id>/` — the UI serves the final video
from there for preview/download; the folder is safe to delete once you've uploaded manually.

## Customizing content

Edit `NICHES` in `src/pipeline/runPipeline.ts` to control what topics get generated, or replace
`pickNiche()` with your own logic (rotate through a config file, pull from a trends feed, etc).

## Known limitations / things to harden before relying on this in production

- **Piper voice quality** is decent but noticeably synthetic compared to paid TTS — swap in
  ElevenLabs or Google Cloud TTS later if quality becomes the bottleneck (both have small paid
  tiers, not free).
- **Captions are timed by even word-count spreading**, not real speech alignment — good enough
  for burned-in captions, not perfectly synced to Piper's actual cadence.
- **No retry/backoff** on transient API failures — add if you see occasional Gemini/Pexels
  rate-limit errors during busier hours.
- **Generated videos are ephemeral** — download each one from the UI soon after it's created;
  see the note in `DEPLOY_RENDER.md` if hosting this remotely.
