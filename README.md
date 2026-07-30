# AI Video Pipeline (near-zero API cost) — generate for manual upload

Pipeline: **Gemini (free tier) → Pexels free stock footage → Piper (free local TTS) → Freesound
(free CC0 background music) → ffmpeg assembly (with ducked music + burned-in captions)**. The
app generates the video plus a ready-to-use title, caption, and hashtags, and shows them in a
UI where you preview, download, and post manually — there is no automated TikTok publishing
step.

Generation can be triggered **manually** from the UI at any time, or run **automatically on a
daily schedule** (Sri Lanka time). Every video is kept in a searchable history with inline
playback, metadata, and one-click delete, and storage is capped automatically so old videos
don't pile up forever.

Nothing in this chain has a required per-run dollar cost. The tradeoff, stated plainly: this
produces a fast-paced stock-footage explainer with a synthetic voice, not a Veo-style
AI-generated video (Veo has no free API tier at all).

## 1. Install prerequisites (all free)

- **Node.js** 18+
- **ffmpeg** (and ffprobe, bundled with it) — `apt install ffmpeg` / `brew install ffmpeg`
- **Text-to-speech** — two engines, no API key for either:
  - **edge-tts** (primary/default) — `pip install edge-tts`. Uses Microsoft Edge's neural
    voices (the same ones behind Edge's "Read Aloud"), which sound far more natural than
    Piper. **Important caveat:** this is an unofficial wrapper around a consumer service, not
    a supported API — Microsoft could rate-limit or change it without notice. That's why Piper
    (below) is always kept configured as an automatic fallback.
  - **Piper TTS** (fallback) — download a prebuilt binary from
    https://github.com/rhasspy/piper/releases and a voice model (`.onnx` + `.onnx.json`) from
    https://github.com/rhasspy/piper/blob/master/VOICES.md (recommended: `en_US-libritts_r-medium`
    — trained on audiobook narration, paces spoken scripts more naturally than a conversational
    voice). Fully offline, no external dependency at all — this is what keeps videos generating
    if edge-tts ever has an outage.

## 2. Get free API keys

- **Gemini**: create a key at https://aistudio.google.com/apikey — Flash models are free
  within rate limits (your content may be used to improve Google's products on the free tier).
- **Pexels**: free key at https://www.pexels.com/api/ — generous rate limits, no cost.
- **Freesound** (optional, for background music): free key at
  https://freesound.org/apiv2/apply/ — create an account, then apply for an API credential.
  Only CC0 (public domain) tracks are searched, so no attribution is required. Leave
  `FREESOUND_API_KEY` blank to skip background music; the video still generates normally with
  voice-only audio.

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
from there for preview/download.

## 6. Automated scheduled generation (Sri Lanka time)

Set `SCHEDULE_TIMES` in `.env` to a comma-separated list of 24h times, e.g.:

```
SCHEDULE_TIMES=09:00,18:00
```

The app will automatically start a full generation run at each of those times, every day,
**in Sri Lanka local time (Asia/Colombo, UTC+5:30)** — this timezone is fixed and does not
depend on the host server's own timezone. Scheduled runs use the exact same pipeline as a
manual "Generate Now" click and post their result to the same history/dashboard, just tagged
with trigger `scheduled` instead of `manual`. Manual generation from the UI keeps working at
any time regardless of the schedule.

Leave `SCHEDULE_TIMES` blank to disable automated generation entirely; the UI will show "No
automated schedule configured" and manual generation still works normally.

All job log lines (both manual and scheduled) are timestamped in Sri Lanka time.

## 7. Storage retention (FIFO, 100-video cap)

`MAX_STORED_VIDEOS` (default `100`) caps how many generated videos are kept on disk at once.
After every successful run (manual or scheduled), if the count exceeds the cap, the **oldest**
video's file and database record are deleted automatically — first in, first out. Lower this
value if you're on a small disk, or raise it if you have more storage to spare.

## 8. Video history & management

The UI's **Video history** section lists every generated video, newest first, with its status,
trigger (manual/scheduled), and Sri Lanka-time timestamp. Click a row to expand it and see the
full script, title, hashtags, an inline HTML5 video player, a **Download** button, and a
**Delete** button (removes both the video file and its database record). Videos are never
auto-downloaded — a download only happens when you explicitly click the button.

## 9. Voiceover: edge-tts (primary) with automatic Piper fallback

`TTS_PROVIDER` controls which engine generates narration:

```
TTS_PROVIDER=edge   # default -- natural neural voice, unofficial API (see caveat below)
TTS_PROVIDER=piper  # fully offline, more synthetic, zero external dependency
```

With `TTS_PROVIDER=edge`, set `EDGE_TTS_VOICE` to pick a different voice (default
`en-US-AndrewNeural`). Run `edge-tts --list-voices` to see the full catalog across languages
and genders.

**Why there's a fallback:** edge-tts is not an official Microsoft API — it's a wrapper around
the consumer-facing voice service behind Edge's "Read Aloud" feature, maintained by reverse-
engineering the endpoint it calls. That endpoint has changed before and could again, or get
rate-limited, without warning. So every edge-tts failure is automatically caught and retried
with Piper instead (see `src/services/tts.service.ts`) — a run degrades to a more synthetic
voice rather than failing outright. Check the job log for a line like
`[tts] edge-tts failed, falling back to Piper: ...` to know when that's happened; if you see it
often, either Piper alone or a paid TTS API (ElevenLabs, Google Cloud TTS, Azure TTS — all have
free/cheap tiers) may be worth switching to.

## Customizing content

Edit `NICHES` in `src/pipeline/runPipeline.ts` to control what topics get generated, or replace
`pickNiche()` with your own logic (rotate through a config file, pull from a trends feed, etc).

## Known limitations / things to harden before relying on this in production

- **edge-tts is unofficial** — see section 9. It's the best-sounding free option available, but
  it's not a supported API, so treat the Piper fallback as load-bearing, not decorative: make
  sure Piper is actually installed and working, don't assume edge-tts will always be up.
- **Captions are timed by even word-count spreading**, not real speech alignment — good enough
  for burned-in captions, not perfectly synced to Piper's actual cadence.
- **Background music selection is mood-based text search**, not audio analysis — Freesound
  results for a given mood can vary in quality; if a track sounds off, delete the video and
  regenerate to get a fresh pick.
- **Storage retention caps video *count*, not disk usage** — if you need a hard disk-space
  limit instead, lower `MAX_STORED_VIDEOS` or add a size-based check in
  `src/services/storage.service.ts`.
- **If hosting on a platform with an ephemeral filesystem** (e.g. most free tiers), everything
  under `WORKDIR` and `JOB_DB_PATH` — including history — is wiped on redeploy/restart. Use a
  persistent disk/volume if you need videos and history to survive deploys.
