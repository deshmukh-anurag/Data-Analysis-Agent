import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

export const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });


export async function generateText(prompt: string): Promise<string> {
  const res = await genai.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
  });
  return (res.text ?? "").trim();
}


export async function generateJSON<T = unknown>(prompt: string): Promise<T> {
  const res = await genai.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });
  const raw = (res.text ?? "").trim();
  return JSON.parse(raw) as T;
}
