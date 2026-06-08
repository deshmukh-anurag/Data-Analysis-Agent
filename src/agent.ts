import { createAgent } from "langchain";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { model } from "./gemini.js";
import { ROUTER_SYSTEM_PROMPT } from "./prompts.js";
import {
  makeLookupSalesData,
  type LookupResult,
} from "./tools/lookupSalesData.js";
import { makeAnalyzeSalesData } from "./tools/analyzeSalesData.js";
import { makeGenerateVisualization } from "./tools/generateVisualization.js";

export interface AgentRun {
  finalAnswer: string;
  messages: BaseMessage[];
}

export async function runAgent(question: string): Promise<AgentRun> {
  let lastLookup: LookupResult | null = null;

  const tools = [
    makeLookupSalesData((r) => {
      lastLookup = r;
    }),
    makeAnalyzeSalesData(() => lastLookup),
    makeGenerateVisualization(() => lastLookup),
  ];

  const agent = createAgent({
    model,
    tools,
    systemPrompt: ROUTER_SYSTEM_PROMPT,
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(question)],
  });

  const messages = result.messages as BaseMessage[];
  const last = messages[messages.length - 1];
  const finalAnswer =
    typeof last.content === "string" ? last.content.trim() : JSON.stringify(last.content);

  return { finalAnswer, messages };
}
