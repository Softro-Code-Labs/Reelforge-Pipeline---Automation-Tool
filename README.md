# TikTok AI Video Pipeline (zero API cost)

Scheduled pipeline: **Gemini (free tier) → Pexels free stock footage → Piper (free local TTS)
→ ffmpeg assembly → TikTok Content Posting API**.

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

## 3. TikTok setup (the one part that isn't instant)

1. Register an app at https://developers.tiktok.com, add the **Content Posting API** product.
2. Complete the one-time OAuth authorization flow for the TikTok account you want to post to
   (TikTok's login screen → your app receives an access token + refresh token). This project
   assumes you already have these two tokens in `.env` — a minimal OAuth callback route can be
   added if you need help wiring that up.
3. **Until your app passes TikTok's audit, every post publishes as `SELF_ONLY`** (visible only
   to the account owner) — this is enforced by TikTok itself, not something this code can bypass.
   Leave `TIKTOK_UNAUDITED=true` until you've passed review, then flip it to `false`.
4. The audit itself is free — it just takes TikTok 2-4 weeks of manual review and requires a
   real privacy policy URL and a clear description of your use case.

## 4. Configure

```
cp .env.example .env
# fill in GEMINI_API_KEY, PEXELS_API_KEY, PIPER_*, TIKTOK_* values
```

## 5. Run

```bash
npm install

# Test a single pipeline run end-to-end without waiting for the scheduler:
npm run run:once

# Start the always-on scheduler (fires at each time in POST_TIMES):
npm run build && npm start
```

Check `./data/jobs.json` after any run for status, logs, and the resulting TikTok `publish_id`.
Generated clips, audio, and the final video for each run are kept under `./workdir/<job-id>/`
for inspection/debugging (safe to delete once you're happy with output quality).

## Customizing content

Edit `NICHES` in `src/pipeline/runPipeline.ts` to control what topics get generated, or replace
`pickNiche()` with your own logic (rotate through a config file, pull from a trends feed, etc).

## Known limitations / things to harden before relying on this in production

- **Piper voice quality** is decent but noticeably synthetic compared to paid TTS — swap in
  ElevenLabs or Google Cloud TTS later if quality becomes the bottleneck (both have small paid
  tiers, not free).
- **Captions are timed by even word-count spreading**, not real speech alignment — good enough
  for burned-in captions, not perfectly synced to Piper's actual cadence.
- **TikTok refresh tokens rotate on every use** — this is now handled automatically: each run
  persists the newly-rotated token (to Render's env vars if `RENDER_API_KEY`/`RENDER_SERVICE_ID`
  are set, or by rewriting the local `.env` otherwise) so the next run doesn't retry an
  invalidated token. See `DEPLOY_RENDER.md` if deploying elsewhere.
- **No retry/backoff** on transient API failures — add if you see occasional Gemini/Pexels
  rate-limit errors during busier hours.
