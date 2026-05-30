# data-anal-agent

A TypeScript port of **Lab 1 — Building Your Agent** from DeepLearning.AI's
[Evaluating AI Agents](https://learn.deeplearning.ai/courses/evaluating-ai-agents)
course.

The original lab uses Python + DuckDB + OpenAI. This version uses:

- **TypeScript** (Node 22+, ESM)
- **Prisma + PostgreSQL** as the ORM and database
- **Google Gemini** (free tier — `gemini-2.0-flash` by default) via `@google/genai`

The agent answers natural-language questions about a retail sales dataset by
orchestrating three tools through Gemini's function-calling loop.

## Architecture

```
                       ┌────────────────────────┐
   user question  ───▶ │   Router (Gemini)      │
                       │  systemInstruction +   │
                       │  tool declarations     │
                       └──────────┬─────────────┘
                                  │ functionCalls
            ┌─────────────────────┼──────────────────────┐
            ▼                     ▼                      ▼
   lookup_sales_data    analyze_sales_data    generate_visualization
   (NL → SQL → Prisma)  (LLM markdown)        (LLM JSON → Vega-Lite)
            │                     │                      │
            └────────► functionResponse parts ◀──────────┘
                                  │
                                  ▼
                          final text answer
```

| Tool | Input | Output |
| --- | --- | --- |
| `lookup_sales_data` | NL prompt | `{ sql, row_count, preview_markdown }` — runs a generated SELECT against Postgres via Prisma `$queryRawUnsafe` (guarded read-only) |
| `analyze_sales_data` | NL prompt | `{ analysis_markdown }` — bullet-point analysis of the last result set |
| `generate_visualization` | NL prompt | `{ chart_config, vega_lite_spec }` — a portable Vega-Lite JSON spec, not Python code |

The router loops up to 6 turns, dispatches each `functionCall` to the matching
TS handler, and feeds results back as `functionResponse` parts until Gemini
emits a final text answer.

## Setup

### 1. PostgreSQL

Create a database (any role with CREATE privileges will do):

```bash
sudo -u postgres createdb data_anal_agent
sudo -u postgres psql -c "CREATE USER agent WITH PASSWORD 'agent';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE data_anal_agent TO agent;"
sudo -u postgres psql -d data_anal_agent -c "GRANT ALL ON SCHEMA public TO agent;"
```

### 2. Environment

```bash
cp .env.example .env
# edit .env and paste:
#   - DATABASE_URL=postgresql://agent:agent@localhost:5432/data_anal_agent?schema=public
#   - GEMINI_API_KEY=<get one free at https://aistudio.google.com/apikey>
```

### 3. Install + migrate + seed

```bash
npm install
npm run prisma:generate
npm run db:push      # creates the sales_transactions table
npm run seed         # inserts ~2.5k synthetic rows for Nov–Dec 2021
```

## Use it

```bash
npm run ask -- "what was total revenue per store in November 2021?"
npm run ask -- "which SKUs sold the most units while on promotion?"
npm run ask -- "show a bar chart of revenue by store"
```

Example output (abridged):

```
Question: what was total revenue per store in November 2021?

────────────────────────────────────────────
Tool trace
────────────────────────────────────────────

[1] lookup_sales_data
    args: {"prompt":"total revenue per store in November 2021"}
    {
      "sql": "SELECT store_number, SUM(total_sale_value) AS revenue …",
      "row_count": 5,
      "preview_markdown": "| store_number | revenue | … |"
    }

────────────────────────────────────────────
Final answer
────────────────────────────────────────────
Store 1320 led with $X, followed by …
```

When `generate_visualization` runs, the `vega_lite_spec` field can be pasted
into the [Vega Editor](https://vega.github.io/editor/) or rendered by any
Vega-Lite-aware frontend.

## Project layout

```
prisma/
  schema.prisma         # SalesTransaction model
  seed.ts               # deterministic synthetic data
src/
  cli.ts                # entry point — `npm run ask -- "…"`
  agent.ts              # Gemini function-calling router loop
  gemini.ts             # @google/genai wrapper
  prisma.ts             # shared PrismaClient
  config.ts             # env loading
  prompts.ts            # system + per-tool prompt templates
  tools/
    lookupSalesData.ts      # NL → SQL → Postgres (read-only guarded)
    analyzeSalesData.ts     # LLM markdown analysis
    generateVisualization.ts# LLM JSON config → Vega-Lite spec
```

## Differences from the original Python lab

- **DuckDB → Postgres via Prisma.** `lookupSalesData` generates Postgres SQL
  (not DuckDB SQL) and runs it through `prisma.$queryRawUnsafe`, with a
  whitelist that rejects anything other than a single `SELECT`/`WITH` statement.
- **OpenAI → Gemini.** Function-calling is expressed via `@google/genai`'s
  `functionDeclarations` and `functionResponse` parts; the loop structure is
  the same.
- **Pydantic structured output → Zod + `responseMimeType: application/json`.**
  Gemini's JSON mode plus a Zod parse gives us the same "validated structured
  output" guarantee.
- **matplotlib code → Vega-Lite spec.** The TS runtime can't execute Python,
  so emitting matplotlib source would be dead text. A Vega-Lite JSON spec is
  portable, renderable in any frontend, and keeps the tool genuinely useful.
