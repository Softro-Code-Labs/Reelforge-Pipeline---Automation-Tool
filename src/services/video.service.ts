import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";
import { buildSrt } from "./captions";

/** Runs a CLI command and resolves with stdout, or rejects with stderr on non-zero exit. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });
}

/** Reads the duration (seconds) of any audio or video file via ffprobe. */
async function getMediaDurationSeconds(mediaPath: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mediaPath,
  ]);
  const seconds = parseFloat(out.trim());
  if (!seconds || Number.isNaN(seconds)) {
    throw new Error(`Could not read duration of ${mediaPath}`);
  }
  return seconds;
}

/**
 * Scales+crops a single source clip to the target aspect ratio and trims (or,
 * if the source is shorter than its slot, loops) it to exactly `duration`
 * seconds. Doing this one clip at a time (rather than in one big
 * filter_complex with every clip open at once) keeps peak memory bounded to
 * roughly a single decoder's worth of frames instead of N of them summed
 * together -- this is what was causing the Render OOM.
 *
 * Looping short clips (instead of the previous behavior of just trimming,
 * which silently produced a shorter-than-requested segment) keeps every
 * clip's slot exactly `duration` long, so the final concatenated video
 * always matches the voiceover's length instead of ending early or
 * freezing on the last frame while audio keeps playing.
 */
async function preprocessClip(
  clipPath: string,
  duration: number,
  width: number,
  height: number,
  outPath: string
): Promise<void> {
  const sourceDuration = await getMediaDurationSeconds(clipPath);
  const needsLoop = sourceDuration < duration;

  const args = [
    "-y",
    ...(needsLoop ? ["-stream_loop", "-1"] : []),
    "-i",
    clipPath,
    "-t",
    duration.toFixed(2),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ];
  await run(env.video.ffmpegPath, args);
}

// Bundled directly under assets/fonts (Google Fonts' Poppins, OFL-licensed)
// rather than relying on a system font -- this way caption rendering looks
// identical regardless of what fonts happen to be installed on the host/
// container, with no fontconfig setup required.
const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const CAPTION_FONT = "Poppins ExtraBold";

/**
 * Builds the ffmpeg filter_complex graph for the final mux pass: burns in
 * subtitles on the video, and -- when `musicPath` is provided -- mixes the
 * voiceover with a ducked background-music bed so the music audibly drops
 * whenever narration is present instead of competing with it.
 *
 * Sidechain compression (rather than a single fixed low volume throughout)
 * is what gives a genuine "ducking" effect: the music is attenuated further,
 * dynamically, in response to the voiceover's level, then recovers between
 * lines -- closer to how real short-form edits mix music under narration.
 */
function buildFilterComplex(srtPath: string, hasMusic: boolean): { filter: string; audioMap: string } {
  const escapedSrtPath = srtPath.replace(/:/g, "\\:");
  const escapedFontsDir = FONTS_DIR.replace(/:/g, "\\:");

  // Big, bold, high-contrast caption style modeled on typical short-form
  // video captions: large enough to read at a glance, thick black outline
  // so it stays legible over any footage, and enough bottom margin to clear
  // TikTok's own UI (like/comment/share icons) once posted.
  const style = [
    `FontName=${CAPTION_FONT}`,
    "FontSize=68",
    "PrimaryColour=&H00FFFFFF&", // opaque white fill
    "OutlineColour=&H00000000&", // opaque black outline
    "BorderStyle=1",
    "Outline=7",
    "Shadow=3",
    "Alignment=2", // bottom-center
    "MarginV=160",
    "MarginL=50",
    "MarginR=50",
  ].join(",");

  const subtitleFilter = `subtitles='${escapedSrtPath}':fontsdir='${escapedFontsDir}':force_style='${style}'`;

  const videoStage = `[0:v]${subtitleFilter}[vout]`;

  if (!hasMusic) {
    return { filter: videoStage, audioMap: "1:a" };
  }

  const musicVolume = env.music.volume;
  const audioStage =
    `[2:a]volume=${musicVolume}[music_vol];` +
    // Duck the music bed against the voiceover: attenuate further whenever
    // narration is present, recover in the gaps between lines.
    `[music_vol][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=400:makeup=1[music_ducked];` +
    // Blend the (unmodified) voice with the ducked music into one track.
    `[1:a][music_ducked]amix=inputs=2:duration=first:dropout_transition=1[aout]`;

  return { filter: `${videoStage};${audioStage}`, audioMap: "[aout]" };
}

/**
 * Concatenates clips (cropped to portrait), overlays the voiceover (mixed
 * with optional ducked background music), and burns in captions. Outputs a
 * single 9:16 MP4 sized for TikTok.
 *
 * Runs in three passes to keep memory and CPU bounded:
 *   1. Preprocess each clip individually (scale/crop/trim-or-loop) -- one
 *      decoder open at a time instead of all of them at once.
 *   2. Concatenate the (now uniform, already-small) processed clips with
 *      the concat demuxer + "-c copy" -- a stream copy, no re-decoding.
 *   3. Single pass over the concatenated video to mux in audio (voice, plus
 *      ducked music if available) and burn in subtitles.
 */
export async function assembleVideo(params: {
  clipPaths: string[];
  audioPath: string;
  narrationScript: string;
  workDir: string;
  /** Path to a background-music file, or omitted/undefined if none was fetched. */
  musicPath?: string | null;
}): Promise<string> {
  const { clipPaths, audioPath, narrationScript, workDir, musicPath } = params;
  const { width, height } = env.video;

  const audioDuration = await getMediaDurationSeconds(audioPath);
  const perClipDuration = audioDuration / clipPaths.length;

  const srtPath = buildSrt(narrationScript, audioDuration, workDir);
  const outputPath = path.join(workDir, "final.mp4");

  // Pass 1: preprocess clips one at a time.
  const processedDir = path.join(workDir, "processed");
  fs.mkdirSync(processedDir, { recursive: true });
  const processedPaths: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const outPath = path.join(processedDir, `clip_${i}.mp4`);
    await preprocessClip(clipPaths[i], perClipDuration, width, height, outPath);
    processedPaths.push(outPath);
  }

  // Pass 2: cheap concat via the concat demuxer (stream copy, no decode).
  const listPath = path.join(processedDir, "list.txt");
  const listContents = processedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContents);

  const concatPath = path.join(workDir, "concat.mp4");
  await run(env.video.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    concatPath,
  ]);

  // Pass 3: mux audio (voice, optionally ducked under background music) and
  // burn in captions in a single decode pass.
  const hasMusic = !!musicPath;
  const { filter, audioMap } = buildFilterComplex(srtPath, hasMusic);

  const inputArgs = [
    "-i",
    concatPath,
    "-i",
    audioPath,
    // Loop the music bed indefinitely; amix's duration=first (matched to the
    // voiceover, input 1) trims it back down to the video's actual length,
    // so a short track still covers the whole clip without a hard cutoff.
    ...(hasMusic ? ["-stream_loop", "-1", "-i", musicPath as string] : []),
  ];

  await run(env.video.ffmpegPath, [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-shortest",
    // Moves the moov atom (metadata/index) to the front of the file instead
    // of the end. Without this, a browser/player streaming the file
    // progressively (exactly how the in-app preview and TikTok's own upload
    // do it) has to wait on data at the very end before it can seek or
    // continue decoding -- it plays the first buffered chunk fine, then
    // stalls/lags once that runs out. This was the cause of the "lag after
    // a few seconds" symptom.
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  return outputPath;
}
