import { z } from "zod";
import { traceTool } from "@arizeai/phoenix-otel";
import { generateJSON } from "../gemini.js";
import { VIZ_CONFIG_PROMPT } from "../prompts.js";

const ChartConfig = z.object({
  chart_type: z.enum(["bar", "line", "pie", "scatter"]),
  x_axis: z.string(),
  y_axis: z.string(),
  title: z.string(),
});
export type ChartConfig = z.infer<typeof ChartConfig>;

export interface Visualization {
  config: ChartConfig;
  /**
   * Vega-Lite spec — a portable, JSON-only chart spec the caller can hand to
   * any frontend (or render via `vega-cli`). We deliberately do not generate
   * Python/matplotlib code: it's not executable in this TS runtime and would
   * just be dead text.
   */
  vegaLiteSpec: Record<string, unknown>;
}

function buildVegaLite(
  cfg: ChartConfig,
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  const markByChart: Record<ChartConfig["chart_type"], string> = {
    bar: "bar",
    line: "line",
    scatter: "point",
    pie: "arc",
  };
  const mark = markByChart[cfg.chart_type];

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

export const generateVisualization = traceTool(
  async (
    userPrompt: string,
    rows: Record<string, unknown>[],
    preview: string,
  ): Promise<Visualization> => {
    const raw = await generateJSON<unknown>(VIZ_CONFIG_PROMPT(userPrompt, preview));
    const config = ChartConfig.parse(raw);
    return {
      config,
      vegaLiteSpec: buildVegaLite(config, rows),
    };
  },
  { name: "generate_visualization" },
);
