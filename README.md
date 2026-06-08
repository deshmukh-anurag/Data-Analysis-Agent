# data-anal-agent

A TypeScript port of **Lab 1 — Building Your Agent** from DeepLearning.AI's
[Evaluating AI Agents](https://learn.deeplearning.ai/courses/evaluating-ai-agents)
course, rebuilt on the LangChain + LangSmith stack.

The original lab uses Python + DuckDB + OpenAI + Phoenix. This version uses:

- **TypeScript** (Node 22+, ESM)
- **Prisma + PostgreSQL** as the ORM and database
- **Google Gemini** (free tier — `gemini-2.0-flash` by default) via `@langchain/google-genai`
- **LangChain** `createAgent` (from `langchain` v1) for the agent loop
- **LangSmith** for tracing and evaluation

## Architecture

```
                       ┌────────────────────────┐
   user question  ───▶ │   createAgent          │
                       │  systemPrompt +        │
                       │  ChatGoogleGenerativeAI│
                       │  + 3 tools             │
                       └──────────┬─────────────┘
                                  │ tool_calls
            ┌─────────────────────┼──────────────────────┐
            ▼                     ▼                      ▼
   lookup_sales_data    analyze_sales_data    generate_visualization
   (NL → SQL → Prisma)  (LLM markdown)        (LLM JSON → Vega-Lite)
            │                     │                      │
            └────────► ToolMessage results ◀────────────┘
                                  │
                                  ▼
                          final AIMessage
```

| Tool | Output |
| --- | --- |
| `lookup_sales_data` | JSON `{ sql, row_count, preview_markdown }` — generated `SELECT` runs through `prisma.$queryRawUnsafe` (read-only guard) |
| `analyze_sales_data` | JSON `{ analysis_markdown }` — bullet-point analysis of the last result set |
| `generate_visualization` | JSON `{ chart_config, vega_lite_spec }` — portable Vega-Lite JSON spec |

The three tools share per-invocation state via closures: each `runAgent` call
builds fresh tool instances that capture/read a local `lastLookup` ref, so
`analyze` and `visualize` operate on the most recent lookup result without the
LLM having to re-pass the whole result set.

## Setup

### 1. PostgreSQL

```bash
sudo -u postgres createdb data_anal_agent
sudo -u postgres psql -c "CREATE USER agent WITH PASSWORD 'agent';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE data_anal_agent TO agent;"
sudo -u postgres psql -d data_anal_agent -c "GRANT ALL ON SCHEMA public TO agent;"
```

### 2. Environment

```bash
cp .env.example .env
# then fill in:
#   - DATABASE_URL
#   - GEMINI_API_KEY   (https://aistudio.google.com/apikey)
#   - LANGSMITH_API_KEY (https://smith.langchain.com)
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

The CLI prints every `[call]` (AI message with `tool_calls`) and `[result]`
(ToolMessage) on its way to the final answer.

## LangSmith tracing

Tracing is wired purely through environment variables — LangChain's runnables
emit the right spans automatically once these are set:

```bash
LANGSMITH_TRACING="true"
LANGSMITH_API_KEY="..."
LANGSMITH_PROJECT="data-anal-agent"
```

Each `npm run ask` produces a trace under your project at
https://smith.langchain.com with this shape:

```
agent                       (chain)
├── model                   (llm — Gemini, tool selection)
├── tools.lookup_sales_data (tool)
│   └── chatText            (llm — SQL generation)
├── model                   (llm)
├── tools.analyze_sales_data (tool)
│   └── chatText            (llm)
└── model                   (llm — final answer)
```

## Evaluation

A LangSmith experiment runs the agent over a small dataset and scores each
run with four evaluators:

| Evaluator | What it measures |
| --- | --- |
| `used_expected_tool` | Did the agent call the tool the question implied? |
| `mentions_key_terms` | Fraction of expected facts/terms present in the final answer |
| `produced_chart_if_requested` | If the question asked for a chart, did `generate_visualization` run? |
| `llm_judge` | Gemini scores the final answer 0–1 against expected facts |

Run it:

```bash
npm run eval
```

The first run creates the `data-anal-agent-smoke` dataset in LangSmith and
seeds it with the examples in [eval/dataset.ts](eval/dataset.ts). Subsequent
runs reuse the dataset and append new experiments named
`data-anal-agent-YYYY-MM-DD-...`.

## Project layout

```
prisma/
  schema.prisma         # SalesTransaction model
  seed.ts               # deterministic synthetic data
src/
  cli.ts                # entry point — `npm run ask -- "…"`
  agent.ts              # createAgent + per-invocation tool closures
  gemini.ts             # ChatGoogleGenerativeAI + chatText helper
  prisma.ts             # shared PrismaClient
  config.ts             # env loading
  prompts.ts            # system + per-tool prompt templates
  tools/
    lookupSalesData.ts      # NL → SQL → Postgres (read-only guarded)
    analyzeSalesData.ts     # LLM markdown analysis
    generateVisualization.ts# withStructuredOutput → Vega-Lite spec
eval/
  dataset.ts            # local examples + LangSmith dataset name
  evaluators.ts         # heuristic + LLM-as-judge evaluators
  eval.ts               # entry point — `npm run eval`
```

## Differences from the original Python lab

- **DuckDB → Prisma + Postgres.** `lookup_sales_data` generates Postgres SQL
  and runs it through `prisma.$queryRawUnsafe`, with a whitelist that rejects
  anything other than a single `SELECT`/`WITH`.
- **OpenAI → Gemini.** `ChatGoogleGenerativeAI` from `@langchain/google-genai`,
  with `withStructuredOutput(zodSchema)` replacing OpenAI's structured output
  for the chart-config tool.
- **Custom router → `createAgent`.** The router loop is delegated to LangChain
  v1's `createAgent`, which handles tool calling, message threading, and the
  iteration loop for us.
- **matplotlib → Vega-Lite.** The TS runtime can't execute Python, so the viz
  tool emits a portable Vega-Lite JSON spec that any frontend can render.
- **Phoenix → LangSmith.** Tracing is env-var driven (no manual span helpers),
  and evaluation uses `langsmith/evaluation.evaluate()` against datasets
  hosted on smith.langchain.com.
