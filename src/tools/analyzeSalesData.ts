import { traceTool } from "@arizeai/phoenix-otel";
import { generateText } from "../gemini.js";
import { ANALYSIS_PROMPT } from "../prompts.js";

export const analyzeSalesData = traceTool(
  async (userPrompt: string, dataPreview: string): Promise<string> => {
    try {
      return await generateText(ANALYSIS_PROMPT(userPrompt, dataPreview));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `_Analysis failed: ${msg}_`;
    }
  },
  { name: "analyze_sales_data" },
);
