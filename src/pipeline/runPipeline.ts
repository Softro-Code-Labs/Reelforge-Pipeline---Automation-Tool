import * as path from "path";
import { v4 as uuid } from "uuid";
import { env } from "../config/env";
import { generateContentPlan } from "../services/gemini.service";
import { fetchStockClips } from "../services/pexels.service";
import { synthesizeVoiceover } from "../services/tts.service";
import { assembleVideo } from "../services/video.service";
import { createJob, appendLog, updateJob } from "../store/jobStore";

// Content niches to rotate through -- swap in your own rotation/queue logic here
const NICHES = ["science facts", "world history", "personal finance tips", "space exploration"];

function pickNiche(): string {
  return NICHES[Math.floor(Math.random() * NICHES.length)];
}

// Starts a run in the background and returns the job id immediately -- used
// by the "Generate now" API so the UI can poll GET /api/jobs/:id for progress
export function startPipelineRun(): string {
  const jobId = uuid();
  const workDir = path.join(env.workdir, jobId);
  createJob(jobId);
  executeJob(jobId, workDir).catch(() => {
    // executeJob already logs the error and marks the job failed internally
  });
  return jobId;
}

// Runs a job to completion -- used by `run:once`, which awaits the full run
export async function runPipelineOnce(): Promise<void> {
  const jobId = uuid();
  const workDir = path.join(env.workdir, jobId);
  createJob(jobId);
  await executeJob(jobId, workDir);
}

async function executeJob(jobId: string, workDir: string): Promise<void> {
  try {
    updateJob(jobId, { status: "running" });

    appendLog(jobId, "Requesting content plan from Gemini...");
    const niche = pickNiche();
    const plan = await generateContentPlan(niche);
    updateJob(jobId, { topic: plan.topic });
    appendLog(jobId, `Topic: ${plan.topic}`);

    appendLog(jobId, `Fetching stock clips for keywords: ${plan.visual_keywords.join(", ")}`);
    const clipPaths = await fetchStockClips(plan.visual_keywords, path.join(workDir, "clips"));
    appendLog(jobId, `Fetched ${clipPaths.length} clip(s)`);

    appendLog(jobId, "Synthesizing voiceover with Piper...");
    const audioPath = await synthesizeVoiceover(plan.narration_script, path.join(workDir, "audio"));

    appendLog(jobId, "Assembling final video with ffmpeg...");
    const videoPath = await assembleVideo({
      clipPaths,
      audioPath,
      narrationScript: plan.narration_script,
      workDir,
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
  } catch (err) {
    const message = (err as Error).message;
    appendLog(jobId, `ERROR: ${message}`);
    updateJob(jobId, { status: "failed", error: message });
  }
}
