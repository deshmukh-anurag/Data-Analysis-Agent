import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "./config.js";

export const model = new ChatGoogleGenerativeAI({
  model: config.geminiModel,
  apiKey: config.geminiApiKey,
  temperature: 0,
});

export async function chatText(prompt: string): Promise<string> {
  const res = await model.invoke(prompt);
  const c = res.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : "text" in p ? p.text : ""))
      .join("")
      .trim();
  }
  return String(c).trim();
}
