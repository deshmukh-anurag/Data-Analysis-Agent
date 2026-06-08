import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { runAgent } from "../src/agent.js";
import { prisma } from "../src/prisma.js";
import { datasetName, datasetDescription, examples } from "./dataset.js";
import {
  llmJudge,
  mentionsKeyTerms,
  producedChartIfRequested,
  usedExpectedTool,
  type AgentOutput,
} from "./evaluators.js";

import "dotenv/config";

async function ensureDataset(client: Client): Promise<string> {
  try {
    const existing = await client.readDataset({ datasetName });
    console.log(`Using existing dataset: ${datasetName} (${existing.id})`);
    return existing.id;
  } catch {
    console.log(`Creating dataset: ${datasetName}`);
    const ds = await client.createDataset(datasetName, {
      description: datasetDescription,
    });
    await client.createExamples(
      examples.map((e) => ({
        datasetId: ds.id,
        inputs: e.inputs,
        outputs: e.outputs,
      })),
    );
    console.log(`Inserted ${examples.length} examples.`);
    return ds.id;
  }
}

function formatScore(score: number | boolean | null | undefined): string {
  if (score === null || score === undefined) return "-";
  if (typeof score === "boolean") return score ? "1.00" : "0.00";
  return score.toFixed(2);
}

async function target(
  inputs: { question: string },
): Promise<Record<string, unknown>> {
  const { finalAnswer, messages } = await runAgent(inputs.question);
  const out: AgentOutput = { answer: finalAnswer, messages };
  return out as unknown as Record<string, unknown>;
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY) {
    console.error("Missing LANGSMITH_API_KEY in env.");
    process.exit(1);
  }

  const client = new Client();
  await ensureDataset(client);

  const experimentPrefix = `data-anal-agent-${new Date().toISOString().slice(0, 10)}`;
  console.log(`Running experiment: ${experimentPrefix}\n`);

  const results = await evaluate(target, {
    data: datasetName,
    evaluators: [
      usedExpectedTool,
      mentionsKeyTerms,
      producedChartIfRequested,
      llmJudge,
    ],
    experimentPrefix,
    maxConcurrency: 2,
  });

  console.log("\n" + "─".repeat(60));
  console.log("Experiment results");
  console.log("─".repeat(60));
  for await (const row of results) {
    const question = (row.example.inputs as { question?: string }).question ?? "";
    const scores = row.evaluationResults.results
      .map((r) => `${r.key}=${formatScore(r.score)}`)
      .join("  ");
    console.log(`\n> ${question}`);
    console.log(`  ${scores}`);
  }
}

main()
  .catch((err) => {
    console.error("Eval error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
