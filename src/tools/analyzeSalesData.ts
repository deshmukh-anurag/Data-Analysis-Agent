import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chatText } from "../gemini.js";
import { ANALYSIS_PROMPT } from "../prompts.js";
import type { LookupResult } from "./lookupSalesData.js";

export function makeAnalyzeSalesData(getLast: () => LookupResult | null) {
  return tool(
    async ({ prompt }) => {
      const last = getLast();
      if (!last) {
        return JSON.stringify({
          error: "No data to analyze. Call lookup_sales_data first.",
        });
      }
      try {
        const analysis = await chatText(ANALYSIS_PROMPT(prompt, last.preview));
        return JSON.stringify({ analysis_markdown: analysis });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    },
    {
      name: "analyze_sales_data",
      description:
        "Produce a written analysis of the most recently returned result set. Call only after lookup_sales_data has succeeded.",
      schema: z.object({
        prompt: z
          .string()
          .describe("The question or angle the analysis should focus on."),
      }),
    },
  );
}
