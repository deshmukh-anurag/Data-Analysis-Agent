# data-anal-agent

A TypeScript port of **Lab 1 — Building Your Agent** from DeepLearning.AI's
[Evaluating AI Agents](https://learn.deeplearning.ai/courses/evaluating-ai-agents)
course.

The original lab uses Python + DuckDB + OpenAI. This version uses:

- **TypeScript** (Node 22+, ESM)
- **Prisma + PostgreSQL** as the ORM and database
- **Google Gemini** (free tier — `gemini-2.0-flash` by default) via `@google/genai`
- **Arize Phoenix** for tracing via `@arizeai/phoenix-otel` (the official Node SDK)

The agent answers natural-language questions about a retail sales dataset by
orchestrating three tools through Gemini's function-calling loop. Every agent
run, router step, tool call, and Gemini call is instrumented as an
OpenInference span and exported to Phoenix.

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

### 4. Phoenix (tracing — optional but recommended)

Run Phoenix locally with Docker:

```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
```

Then open http://localhost:6006 to view the trace UI. The defaults in
`.env.example` already point at `http://localhost:6006`, so as soon as Phoenix
is running, every `npm run ask` invocation will show up as a trace under the
project `data-anal-agent` with this span hierarchy:

```
data-anal-agent          (AGENT — the runAgent call)
├── router.step          (LLM — Gemini turn 1, with tool calls)
├── lookup_sales_data    (TOOL)
│   └── gemini.generateText   (LLM — SQL generation)
├── router.step          (LLM — Gemini turn 2)
├── analyze_sales_data   (TOOL)
│   └── gemini.generateText   (LLM — written analysis)
└── router.step          (LLM — final answer)
```

LLM spans include model name, provider, input/output messages, token counts
from `usageMetadata`, and tool-call/response payloads.

For Phoenix Cloud instead of local, set:

```bash
PHOENIX_COLLECTOR_ENDPOINT="https://app.phoenix.arize.com"
PHOENIX_API_KEY="your-cloud-key"
```

To disable tracing, just don't start Phoenix — the OTLP exporter will fail
quietly and the agent continues working.

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
  agent.ts              # Gemini function-calling router loop (wrapped in traceAgent)
  gemini.ts             # @google/genai wrapper with LLM-span instrumentation
  tracing.ts            # phoenix-otel register() bootstrap
  prisma.ts             # shared PrismaClient
  config.ts             # env loading
  prompts.ts            # system + per-tool prompt templates
  tools/
    lookupSalesData.ts      # NL → SQL → Postgres (read-only guarded, traceTool)
    analyzeSalesData.ts     # LLM markdown analysis (traceTool)
    generateVisualization.ts# LLM JSON config → Vega-Lite spec (traceTool)
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
- **Phoenix tracing via the TS SDK.** Arize ships `@arizeai/phoenix-otel` for
  Node.js — `register()` configures the OTLP exporter, and `traceAgent` /
  `traceTool` / manual LLM spans with `getLLMAttributes()` produce the same
  OpenInference span shape Phoenix expects from the Python SDK. The UI
  doesn't care which language emitted the trace.
