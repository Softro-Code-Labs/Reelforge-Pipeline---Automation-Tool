import fetch from "node-fetch";
import { env } from "../config/env";
import { withRetry } from "../utils/retry";

/** Structured content plan produced by Gemini for a single video. */
export interface ContentPlan {
  /** Internal working title, for logs/history only -- never shown to viewers. */
  topic: string;
  /** Scroll-stopping hook, ready to paste as the TikTok title. */
  title: string;
  /** Ready-to-paste caption (hook + light call to action, no hashtags). */
  caption: string;
  /** Natural spoken-word script for the voiceover, ~60-90 words. */
  narration_script: string;
  /** Stock-footage search terms that visually match the script. */
  visual_keywords: string[];
  /** TikTok hashtags, without the leading "#". */
  hashtags: string[];
  /** Short mood/genre descriptor used to pick matching background music. */
  music_mood: string;
}

// Kept detailed and example-driven rather than terse: short-form scripts live
// or die on the first line, so the prompt spells out what "good" looks like
// (concrete hook patterns, a ban on generic filler) instead of leaving that
// to the model's default instincts.
const SYSTEM_PROMPT = `You write short-form vertical video content plans for TikTok.

Given a general content niche, pick ONE specific, currently-relevant, non-generic angle
within it -- prefer a surprising fact, a common misconception, or a concrete story over a
broad overview. Avoid throat-clearing openers like "Did you know" or "Let's talk about";
open with the payoff or a vivid concrete detail instead.

Write the narration_script to be read aloud: short sentences, plain words, one idea per
sentence, and a clear payoff by the final line (a twist, a takeaway, or a call to think
differently) -- not just a trailing fact.

Respond with STRICT JSON ONLY, no markdown fences, no commentary, matching exactly this shape:

{
  "topic": "short internal working title, for our own reference only",
  "title": "a catchy, scroll-stopping TikTok title/hook, under 100 characters, ready to use as-is",
  "caption": "a ready-to-paste TikTok caption: 1-2 short lines, hook + a light call to action (e.g. asking a question or telling people to follow for more). Do NOT include hashtags here, those are separate.",
  "narration_script": "a natural spoken-word script, 60-90 words, written to be read aloud in about 25-30 seconds",
  "visual_keywords": ["3 to 6 short search terms for stock footage that visually match the script, ordered to roughly follow the script's narrative arc"],
  "hashtags": ["5 to 8 relevant TikTok hashtags, without the # symbol"],
  "music_mood": "a 2-4 word instrumental music style/mood matching this script's tone, e.g. 'upbeat corporate', 'epic cinematic', 'chill lo-fi', 'dramatic tense', 'quirky playful'"
}`;

/**
 * Calls the Gemini API once and parses/validates its JSON response.
 * Split out from {@link generateContentPlan} so retry logic can wrap just
 * the network call without re-validating on every internal branch.
 */
async function requestContentPlan(niche: string): Promise<ContentPlan> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.gemini.model}:generateContent?key=${env.gemini.apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `Niche: ${niche}\n\n${SYSTEM_PROMPT}` }],
      },
    ],
    generationConfig: {
      temperature: 0.9,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${text}`);
  }

  const data: any = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no content");
  }

  let plan: ContentPlan;
  try {
    plan = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse Gemini JSON output: ${text}`);
  }

  if (
    !plan.narration_script ||
    !plan.visual_keywords?.length ||
    !plan.title ||
    !plan.caption ||
    !plan.music_mood
  ) {
    throw new Error(`Gemini output missing required fields: ${JSON.stringify(plan)}`);
  }

  return plan;
}

/**
 * Generates a full content plan (script, title, caption, hashtags, visual
 * search terms, and a music mood) for the given niche. Retries transient
 * failures (rate limits, brief outages) with backoff before giving up.
 */
export async function generateContentPlan(niche: string): Promise<ContentPlan> {
  return withRetry(() => requestContentPlan(niche), {
    attempts: 3,
    baseDelayMs: 1000,
    onRetry: (err, attempt) =>
      console.warn(`[gemini] attempt ${attempt} failed, retrying: ${(err as Error).message}`),
  });
}
