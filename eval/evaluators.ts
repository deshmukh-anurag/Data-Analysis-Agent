import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { chatText } from "../src/gemini.js";

export interface AgentOutput {
  answer: string;
  messages: BaseMessage[];
}

interface EvalArgs {
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}

function asAgentOutput(o: Record<string, any>): AgentOutput {
  return o as unknown as AgentOutput;
}

function toolNamesCalled(messages: BaseMessage[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    if (m instanceof AIMessage && m.tool_calls) {
      for (const tc of m.tool_calls) names.add(tc.name);
    }
  }
  return names;
}

export function usedExpectedTool(args: EvalArgs): { key: string; score: number } {
  const expected = args.referenceOutputs?.expectsTool as string | undefined;
  if (!expected) return { key: "used_expected_tool", score: 1 };
  const tools = toolNamesCalled(asAgentOutput(args.outputs).messages);
  return { key: "used_expected_tool", score: tools.has(expected) ? 1 : 0 };
}

export function mentionsKeyTerms(args: EvalArgs): { key: string; score: number } {
  const terms = (args.referenceOutputs?.mustMention ?? []) as string[];
  if (terms.length === 0) return { key: "mentions_key_terms", score: 1 };
  const answer = asAgentOutput(args.outputs).answer.toLowerCase();
  const hits = terms.filter((t) => answer.includes(t.toLowerCase())).length;
  return { key: "mentions_key_terms", score: hits / terms.length };
}

export function producedChartIfRequested(args: EvalArgs): { key: string; score: number } {
  if (!args.referenceOutputs?.expectsChart) {
    return { key: "produced_chart_if_requested", score: 1 };
  }
  const tools = toolNamesCalled(asAgentOutput(args.outputs).messages);
  return {
    key: "produced_chart_if_requested",
    score: tools.has("generate_visualization") ? 1 : 0,
  };
}

const JUDGE_PROMPT = (
  question: string,
  answer: string,
  mustMention: string[],
) => `
You are a strict grader. Given a user question, an AI agent's final answer, and
a list of facts/terms the answer should cover, score the answer 0.0–1.0.

Scoring rubric:
  1.0 — answer is correct and covers all expected facts/terms
  0.5 — partially correct or covers some expected facts/terms
  0.0 — wrong, evasive, or off-topic

Return ONLY JSON of the form:
{ "score": <number between 0 and 1>, "reason": "<one sentence>" }

Question:
${question}

Expected facts/terms:
${mustMention.map((t) => `- ${t}`).join("\n")}

Agent's final answer:
${answer}
`.trim();

export async function llmJudge(
  args: EvalArgs,
): Promise<{ key: string; score: number; comment?: string }> {
  try {
    const question = String(args.inputs.question ?? "");
    const answer = asAgentOutput(args.outputs).answer;
    const mustMention = (args.referenceOutputs?.mustMention ?? []) as string[];
    const raw = await chatText(JUDGE_PROMPT(question, answer, mustMention));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { score: number; reason?: string };
    const score = Math.max(0, Math.min(1, Number(parsed.score) || 0));
    return { key: "llm_judge", score, comment: parsed.reason };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { key: "llm_judge", score: 0, comment: `judge failed: ${msg}` };
  }
}
