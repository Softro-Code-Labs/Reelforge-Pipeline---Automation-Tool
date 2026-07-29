import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";

export type JobStatus = "pending" | "running" | "success" | "failed";

export interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  topic?: string;
  videoPath?: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  error?: string;
  log: string[];
}

function readAll(): Record<string, JobRecord> {
  if (!fs.existsSync(env.jobDbPath)) return {};
  return JSON.parse(fs.readFileSync(env.jobDbPath, "utf-8"));
}

function writeAll(data: Record<string, JobRecord>): void {
  fs.mkdirSync(path.dirname(env.jobDbPath), { recursive: true });
  fs.writeFileSync(env.jobDbPath, JSON.stringify(data, null, 2));
}

export function createJob(id: string): JobRecord {
  const jobs = readAll();
  const job: JobRecord = {
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [],
  };
  jobs[id] = job;
  writeAll(jobs);
  return job;
}

export function updateJob(id: string, patch: Partial<JobRecord>): void {
  const jobs = readAll();
  const existing = jobs[id];
  if (!existing) return;
  jobs[id] = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeAll(jobs);
}

export function appendLog(id: string, line: string): void {
  const jobs = readAll();
  const existing = jobs[id];
  if (!existing) return;
  existing.log.push(`[${new Date().toISOString()}] ${line}`);
  existing.updatedAt = new Date().toISOString();
  writeAll(jobs);
  console.log(`[job ${id}] ${line}`);
}

export function listJobs(): JobRecord[] {
  return Object.values(readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): JobRecord | undefined {
  return readAll()[id];
}
