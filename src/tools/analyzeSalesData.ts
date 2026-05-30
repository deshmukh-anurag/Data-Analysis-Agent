import { generateText } from "../gemini.js";
import { ANALYSIS_PROMPT } from "../prompts.js";

export async function analyzeSalesData(
  userPrompt: string,
  dataPreview: string,
): Promise<string> {
  try {
    return await generateText(ANALYSIS_PROMPT(userPrompt, dataPreview));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `_Analysis failed: ${msg}_`;
  }
}
