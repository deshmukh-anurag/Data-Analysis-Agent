import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { chatText } from "../gemini.js";
import { SQL_GENERATION_PROMPT } from "../prompts.js";

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|vacuum)\b/i;

function stripCodeFences(sql: string): string {
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
  preview: string;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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

export function makeLookupSalesData(onResult: (r: LookupResult) => void) {
  return tool(
    async ({ prompt }) => {
      const generated = await chatText(SQL_GENERATION_PROMPT(prompt));
      const sql = stripCodeFences(generated);
      assertReadOnly(sql);
      const rows = (await prisma.$queryRawUnsafe(sql)) as Record<string, unknown>[];
      const result: LookupResult = {
        sql,
        rowCount: rows.length,
        rows,
        preview: toMarkdownTable(rows),
      };
      onResult(result);
      return JSON.stringify({
        sql,
        row_count: rows.length,
        preview_markdown: result.preview,
      });
    },
    {
      name: "lookup_sales_data",
      description:
        "Run a read-only SQL query (generated from the natural-language prompt) against the sales_transactions table and return the resulting rows.",
      schema: z.object({
        prompt: z
          .string()
          .describe(
            "Natural-language description of the data you want, e.g. 'total revenue per store in November 2021'.",
          ),
      }),
    },
  );
}
