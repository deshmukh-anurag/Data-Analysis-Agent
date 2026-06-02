import { Type, type Content, type FunctionDeclaration } from "@google/genai";
import { genai } from "./gemini.js";
import { config } from "./config.js";
import { ROUTER_SYSTEM_PROMPT } from "./prompts.js";
import { lookupSalesData, type LookupResult } from "./tools/lookupSalesData.js";
import { analyzeSalesData } from "./tools/analyzeSalesData.js";
import { generateVisualization } from "./tools/generateVisualization.js";

const MAX_ITERATIONS = 6;

// Gemini function-calling declarations. Names + parameter shapes must match
// what the dispatcher below expects.
const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "lookup_sales_data",
    description:
      "Run a read-only SQL query (generated from the natural-language prompt) against the sales_transactions table and return the resulting rows.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description:
            "Natural-language description of the data you want. Example: 'total revenue per store in November 2021'.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "analyze_sales_data",
    description:
      "Produce a written analysis of the most recently returned result set. Call this only after lookup_sales_data has succeeded.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description:
            "The question or angle the user wants the analysis focused on.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_visualization",
    description:
      "Generate a chart configuration (Vega-Lite spec) for the most recently returned result set. Call this only when a chart/plot/graph is requested.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description:
            "What the visualization should communicate. Example: 'compare revenue by store as a bar chart'.",
        },
      },
      required: ["prompt"],
    },
  },
];

export interface AgentTrace {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentRun {
  finalAnswer: string;
  trace: AgentTrace[];
}

export async function runAgent(userQuestion: string): Promise<AgentRun> {
  const trace: AgentTrace[] = [];
  // Most-recent lookup result — tools downstream of lookup operate on it.
  let lastLookup: LookupResult | null = null;

  const history: Content[] = [
    { role: "user", parts: [{ text: userQuestion }] },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await genai.models.generateContent({
      model: config.geminiModel,
      contents: history,
      config: {
        systemInstruction: ROUTER_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

    const calls = response.functionCalls ?? [];

    // Model is done — return its text answer.
    if (calls.length === 0) {
      return { finalAnswer: (response.text ?? "").trim(), trace };
    }

    // Append the model turn (with the function_call parts) to history so
    // subsequent function_response parts have something to reference.
    const candidate = response.candidates?.[0];
    if (candidate?.content) {
      history.push(candidate.content);
    }

    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      const result = await dispatch(name, args, {
        getLastLookup: () => lastLookup,
        setLastLookup: (l) => {
          lastLookup = l;
        },
      });
      trace.push({ toolName: name, args, result });

      history.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { result },
            },
          },
        ],
      });
    }
  }

  return {
    finalAnswer:
      "_Agent exceeded max tool iterations without producing a final answer._",
    trace,
  };
}

interface DispatchCtx {
  getLastLookup: () => LookupResult | null;
  setLastLookup: (l: LookupResult) => void;
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: DispatchCtx,
): Promise<unknown> {
  try {
    switch (name) {
      case "lookup_sales_data": {
        const prompt = String(args.prompt ?? "");
        const result = await lookupSalesData(prompt);
        ctx.setLastLookup(result);
        return {
          sql: result.sql,
          row_count: result.rowCount,
          preview_markdown: result.preview,
        };
      }
      case "analyze_sales_data": {
        const last = ctx.getLastLookup();
        if (!last) {
          return {
            error:
              "No data available to analyze. Call lookup_sales_data first.",
          };
        }
        const prompt = String(args.prompt ?? "");
        const analysis = await analyzeSalesData(prompt, last.preview);
        return { analysis_markdown: analysis };
      }
      case "generate_visualization": {
        const last = ctx.getLastLookup();
        if (!last) {
          return {
            error:
              "No data available to visualize. Call lookup_sales_data first.",
          };
        }
        const prompt = String(args.prompt ?? "");
        const viz = await generateVisualization(prompt, last.rows, last.preview);
        return {
          chart_config: viz.config,
          vega_lite_spec: viz.vegaLiteSpec,
        };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}
