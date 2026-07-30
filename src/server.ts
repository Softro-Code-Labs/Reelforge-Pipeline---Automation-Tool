import * as path from "path";
import express from "express";
import { env } from "./config/env";
import { startPipelineRun } from "./pipeline/runPipeline";
import { getJob, listJobs, JobRecord } from "./store/jobStore";
import { deleteStoredVideo } from "./services/storage.service";
import { formatSriLankaTime } from "./utils/time";
import { startScheduler } from "./scheduler";

/**
 * Shapes a stored job record for the API/UI: adds Sri Lanka-formatted
 * display timestamps alongside the raw ISO ones (which remain useful for
 * the client to sort/diff on).
 */
function toApiJob(job: JobRecord) {
  return {
    ...job,
    createdAtDisplay: formatSriLankaTime(job.createdAt),
    updatedAtDisplay: formatSriLankaTime(job.updatedAt),
  };
}

export function startServer(): void {
  const app = express();

  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(express.json());

  // Serves generated videos for preview/download, e.g. /media/<jobId>/final.mp4
  app.use("/media", express.static(env.workdir));

  // Plain, fast health check for uptime monitors (UptimeRobot, etc.) --
  // deliberately does no real work, just confirms the process is alive.
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptimeSeconds: process.uptime() });
  });

  // Exposes read-only config the UI needs to render itself (schedule times,
  // storage limit) without hardcoding them client-side.
  app.get("/api/config", (_req, res) => {
    res.json({
      schedule: env.schedule,
      maxStoredVideos: env.storage.maxStoredVideos,
    });
  });

  // Starts a manual run and returns immediately; frontend polls /api/jobs/:id
  // for progress. Scheduled runs take the same code path via the cron
  // scheduler (see ./scheduler.ts), just with trigger "scheduled" instead.
  app.post("/api/generate", (_req, res) => {
    try {
      const jobId = startPipelineRun("manual");
      res.json({ jobId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/jobs", (_req, res) => {
    res.json(listJobs().map(toApiJob));
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(toApiJob(job));
  });

  // Manual delete from the history view: removes the video file(s) from
  // disk and the job record from the database.
  app.delete("/api/jobs/:id", async (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    await deleteStoredVideo(req.params.id);
    res.json({ deleted: true });
  });

  app.listen(env.server.port, () => {
    console.log(`Generate-now UI available at http://localhost:${env.server.port}`);
    // Automated schedule is independent of the HTTP server, but starting it
    // here keeps `npm run ui` as the single command that boots everything.
    startScheduler();
  });
}

// Lets `npm run ui` run this standalone; index.ts calls startServer() itself instead
if (require.main === module) {
  startServer();
}
