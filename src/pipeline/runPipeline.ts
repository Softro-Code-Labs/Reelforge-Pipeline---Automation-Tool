import * as path from "path";
import { v4 as uuid } from "uuid";
import { env } from "../config/env";
import { generateContentPlan } from "../services/gemini.service";
import { fetchStockClips } from "../services/pexels.service";
import { synthesizeVoiceover } from "../services/tts.service";
import { fetchBackgroundMusic } from "../services/music.service";
import { assembleVideo } from "../services/video.service";
import { enforceStorageLimit } from "../services/storage.service";
import { createJob, appendLog, updateJob, JobTrigger } from "../store/jobStore";

// Content niches to rotate through -- swap in your own rotation/queue logic here
const NICHES = ["science facts", "world history", "personal finance tips", "space exploration"];

function pickNiche(): string {
  return NICHES[Math.floor(Math.random() * NICHES.length)];
}

/**
 * Starts a run in the background and returns the job id immediately -- used
 * by the "Generate now" API (trigger "manual") and the cron scheduler
 * (trigger "scheduled") so callers can poll GET /api/jobs/:id for progress.
 */
export function startPipelineRun(trigger: JobTrigger = "manual"): string {
  const jobId = uuid();
  const workDir = path.join(env.workdir, jobId);
  createJob(jobId, trigger);
  executeJob(jobId, workDir).catch(() => {
    // executeJob already logs the error and marks the job failed internally
  });
  return jobId;
}

/** Runs a job to completion -- used by `run:once`, which awaits the full run. */
export async function runPipelineOnce(): Promise<void> {
  const jobId = uuid();
  const workDir = path.join(env.workdir, jobId);
  createJob(jobId, "manual");
  await executeJob(jobId, workDir);
}

/**
 * Executes one full pipeline run end-to-end: content plan -> stock clips ->
 * voiceover -> background music -> assembled video. Updates the job record
 * throughout so the UI can poll and display live progress, and never throws
 * -- failures are captured on the job record instead.
 */
async function executeJob(jobId: string, workDir: string): Promise<void> {
  try {
    updateJob(jobId, { status: "running" });

    appendLog(jobId, "Requesting content plan from Gemini...");
    const niche = pickNiche();
    const plan = await generateContentPlan(niche);
    updateJob(jobId, { topic: plan.topic, narrationScript: plan.narration_script });
    appendLog(jobId, `Topic: ${plan.topic}`);

    appendLog(jobId, `Fetching stock clips for keywords: ${plan.visual_keywords.join(", ")}`);
    const clipPaths = await fetchStockClips(
      plan.visual_keywords,
      path.join(workDir, "clips"),
      env.video.targetDurationSeconds
    );
    appendLog(jobId, `Fetched ${clipPaths.length} clip(s)`);

    appendLog(jobId, `Synthesizing voiceover (${env.tts.provider})...`);
    const audioPath = await synthesizeVoiceover(plan.narration_script, path.join(workDir, "audio"));

    appendLog(jobId, `Sourcing background music (mood: ${plan.music_mood})...`);
    const musicPath = await fetchBackgroundMusic(
      plan.music_mood,
      env.video.targetDurationSeconds,
      path.join(workDir, "music")
    );
    appendLog(jobId, musicPath ? "Background music ready." : "No background music -- continuing with voice only.");

    appendLog(jobId, "Assembling final video with ffmpeg...");
    const videoPath = await assembleVideo({
      clipPaths,
      audioPath,
      narrationScript: plan.narration_script,
      workDir,
      musicPath,
    });
    appendLog(jobId, `Video ready at ${videoPath}`);

    // Video lives at <workdir>/<jobId>/final.mp4 -- store the path relative to
    // the workdir root so the server can serve it under /media/<relPath>
    const videoRelPath = path.relative(env.workdir, videoPath).split(path.sep).join("/");

    updateJob(jobId, {
      status: "success",
      videoPath: videoRelPath,
      title: plan.title,
      caption: plan.caption,
      hashtags: plan.hashtags,
    });
    appendLog(jobId, "Done. Review and download the video for manual upload to TikTok.");

    await enforceStorageLimit();
  } catch (err) {
    const message = (err as Error).message;
    appendLog(jobId, `ERROR: ${message}`);
    updateJob(jobId, { status: "failed", error: message });
  }
}
