import * as path from "path";
import express from "express";
import { env } from "./config/env";
import { startPipelineRun } from "./pipeline/runPipeline";
import { getJob, listJobs } from "./store/jobStore";

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

  // Starts a run and returns immediately; frontend polls /api/jobs/:id for progress
  app.post("/api/generate", (_req, res) => {
    try {
      const jobId = startPipelineRun();
      res.json({ jobId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/jobs", (_req, res) => {
    res.json(listJobs());
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  app.listen(env.server.port, () => {
    console.log(`Generate-now UI available at http://localhost:${env.server.port}`);
  });
}

// Lets `npm run ui` run this standalone; index.ts calls startServer() itself instead
if (require.main === module) {
  startServer();
}
