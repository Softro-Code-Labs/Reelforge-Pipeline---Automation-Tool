import fetch from "node-fetch";
import { env } from "../config/env";

export interface ContentPlan {
  topic: string;
  title: string;
  caption: string;
  narration_script: string;
  visual_keywords: string[];
  hashtags: string[];
}

const SYSTEM_PROMPT = `You write short-form vertical video content plans for TikTok.
Given a general content niche, pick ONE specific, currently-relevant trending angle within it.
Respond with STRICT JSON ONLY, no markdown fences, no commentary, matching exactly this shape:

{
  "topic": "short internal working title, for our own reference only",
  "title": "a catchy, scroll-stopping TikTok title/hook, under 100 characters, ready to use as-is",
  "caption": "a ready-to-paste TikTok caption: 1-2 short lines, hook + a light call to action (e.g. asking a question or telling people to follow for more). Do NOT include hashtags here, those are separate.",
  "narration_script": "a natural spoken-word script, 60-90 words, written to be read aloud in about 25-30 seconds",
  "visual_keywords": ["3 to 6 short search terms for stock footage that visually match the script"],
  "hashtags": ["5 to 8 relevant TikTok hashtags, without the # symbol"]
}`;

export async function generateContentPlan(niche: string): Promise<ContentPlan> {
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

  if (!plan.narration_script || !plan.visual_keywords?.length || !plan.title || !plan.caption) {
    throw new Error(`Gemini output missing required fields: ${JSON.stringify(plan)}`);
  }

  return plan;
}
