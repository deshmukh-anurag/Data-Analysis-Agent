import { traceTool } from "@arizeai/phoenix-otel";
import { prisma } from "../prisma.js";
import { generateText } from "../gemini.js";
import { SQL_GENERATION_PROMPT } from "../prompts.js";

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|vacuum)\b/i;

function stripCodeFences(sql: string): string {
  // Gemini occasionally wraps SQL in ```sql … ``` despite instructions.
  return sql
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function assertReadOnly(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstWord !== "select" && firstWord !== "with") {
    throw new Error(`Generated SQL must start with SELECT or WITH; got: ${firstWord}`);
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("Generated SQL contains a forbidden write/DDL keyword.");
  }
  if (trimmed.includes(";")) {
    throw new Error("Generated SQL must be a single statement (no semicolons).");
  }
}

export interface LookupResult {
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  preview: string; // markdown table for use as LLM context downstream
}

function toMarkdownTable(rows: Record<string, unknown>[], maxRows = 20): string {
  if (rows.length === 0) return "_(no rows returned)_";
  const cols = Object.keys(rows[0]);
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, maxRows)
    .map((r) => `| ${cols.map((c) => formatCell(r[c])).join(" | ")} |`)
    .join("\n");
  const footer =
    rows.length > maxRows ? `\n_… ${rows.length - maxRows} more rows omitted_` : "";
  return [header, sep, body].join("\n") + footer;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const lookupSalesData = traceTool(
  async (prompt: string): Promise<LookupResult> => {
    const generated = await generateText(SQL_GENERATION_PROMPT(prompt));
    const sql = stripCodeFences(generated);
    assertReadOnly(sql);
    const rows = (await prisma.$queryRawUnsafe(sql)) as Record<string, unknown>[];
    return {
      sql,
      rowCount: rows.length,
      rows,
      preview: toMarkdownTable(rows),
    };
  },
  { name: "lookup_sales_data" },
);
