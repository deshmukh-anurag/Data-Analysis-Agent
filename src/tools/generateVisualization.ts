import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { model } from "../gemini.js";
import { VIZ_CONFIG_PROMPT } from "../prompts.js";
import type { LookupResult } from "./lookupSalesData.js";

const ChartConfig = z.object({
  chart_type: z.enum(["bar", "line", "pie", "scatter"]),
  x_axis: z.string(),
  y_axis: z.string(),
  title: z.string(),
});
export type ChartConfig = z.infer<typeof ChartConfig>;

function inferType(
  rows: Record<string, unknown>[],
  field: string,
): "quantitative" | "temporal" | "nominal" {
  const sample = rows.find((r) => r[field] != null)?.[field];
  if (sample instanceof Date) return "temporal";
  if (typeof sample === "number") return "quantitative";
  if (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample)) return "temporal";
  return "nominal";
}

function buildVegaLite(
  cfg: ChartConfig,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  if (cfg.chart_type === "pie") {
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: cfg.title,
      data: { values: rows },
      mark: { type: "arc" },
      encoding: {
        theta: { field: cfg.y_axis, type: "quantitative" },
        color: { field: cfg.x_axis, type: "nominal" },
      },
    };
  }
  const mark = cfg.chart_type === "scatter" ? "point" : cfg.chart_type;
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: cfg.title,
    data: { values: rows },
    mark,
    encoding: {
      x: { field: cfg.x_axis, type: inferType(rows, cfg.x_axis) },
      y: { field: cfg.y_axis, type: inferType(rows, cfg.y_axis) },
    },
  };
}

export function makeGenerateVisualization(getLast: () => LookupResult | null) {
  const structuredModel = model.withStructuredOutput(ChartConfig, {
    name: "chart_config",
  });
  return tool(
    async ({ prompt }) => {
      const last = getLast();
      if (!last) {
        return JSON.stringify({
          error: "No data to visualize. Call lookup_sales_data first.",
        });
      }
      try {
        const cfg = await structuredModel.invoke(VIZ_CONFIG_PROMPT(prompt, last.preview));
        const spec = buildVegaLite(cfg, last.rows);
        return JSON.stringify({ chart_config: cfg, vega_lite_spec: spec });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    },
    {
      name: "generate_visualization",
      description:
        "Generate a chart configuration (Vega-Lite spec) for the most recently returned result set. Use only when a chart/plot/graph is requested.",
      schema: z.object({
        prompt: z
          .string()
          .describe("What the visualization should communicate."),
      }),
    },
  );
}
