import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type GenerateContentParameters,
} from "@google/genai";
import {
  OpenInferenceSpanKind,
  SpanStatusCode,
  getLLMAttributes,
  trace,
  type Message,
} from "@arizeai/phoenix-otel";
import { SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import { config } from "./config.js";

export const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const tracer = trace.getTracer("data-anal-agent");

type GenerateArgs = Omit<GenerateContentParameters, "model"> & { model?: string };

export async function tracedGenerateContent(
  args: GenerateArgs,
  spanName = "gemini.generateContent",
): Promise<GenerateContentResponse> {
  const model = args.model ?? config.geminiModel;
  return tracer.startActiveSpan(spanName, async (span) => {
    span.setAttribute(
      SemanticConventions.OPENINFERENCE_SPAN_KIND,
      OpenInferenceSpanKind.LLM,
    );
    const inputMessages = toMessages(args.contents);
    span.setAttributes(
      getLLMAttributes({
        provider: "google",
        modelName: model,
        inputMessages,
        invocationParameters: pickInvocationParams(args.config),
      }),
    );

    try {
      const res = await genai.models.generateContent({ ...args, model });
      const outputMessages = extractOutputMessages(res);
      const usage = res.usageMetadata;
      span.setAttributes(
        getLLMAttributes({
          provider: "google",
          modelName: model,
          outputMessages,
          tokenCount: usage
            ? {
                prompt: usage.promptTokenCount,
                completion: usage.candidatesTokenCount,
                total: usage.totalTokenCount,
              }
            : undefined,
        }),
      );
      span.setStatus({ code: SpanStatusCode.OK });
      return res;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function generateText(prompt: string): Promise<string> {
  const res = await tracedGenerateContent(
    { contents: prompt },
    "gemini.generateText",
  );
  return (res.text ?? "").trim();
}

export async function generateJSON<T = unknown>(prompt: string): Promise<T> {
  const res = await tracedGenerateContent(
    {
      contents: prompt,
      config: { responseMimeType: "application/json" },
    },
    "gemini.generateJSON",
  );
  const raw = (res.text ?? "").trim();
  return JSON.parse(raw) as T;
}

function toMessages(contents: GenerateArgs["contents"]): Message[] {
  if (typeof contents === "string") {
    return [{ role: "user", content: contents }];
  }
  if (!Array.isArray(contents)) {
    return [{ role: "user", content: JSON.stringify(contents) }];
  }
  return contents.map(contentToMessage);
}

function contentToMessage(c: Content): Message {
  const role = c.role === "model" ? "assistant" : c.role ?? "user";
  const parts = c.parts ?? [];
  const textPieces: string[] = [];
  for (const p of parts) {
    if (typeof p.text === "string") textPieces.push(p.text);
    else if (p.functionCall) {
      textPieces.push(
        `[tool_call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args ?? {})})]`,
      );
    } else if (p.functionResponse) {
      textPieces.push(
        `[tool_response ${p.functionResponse.name}=${JSON.stringify(p.functionResponse.response ?? {})}]`,
      );
    }
  }
  return { role, content: textPieces.join("\n") };
}

function extractOutputMessages(res: GenerateContentResponse): Message[] {
  const text = (res.text ?? "").trim();
  const calls = res.functionCalls ?? [];
  if (!text && calls.length === 0) return [];
  const pieces: string[] = [];
  if (text) pieces.push(text);
  for (const c of calls) {
    pieces.push(`[tool_call ${c.name}(${JSON.stringify(c.args ?? {})})]`);
  }
  return [{ role: "assistant", content: pieces.join("\n") }];
}

function pickInvocationParams(cfg: GenerateArgs["config"]): Record<string, unknown> | undefined {
  if (!cfg) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of ["temperature", "topP", "topK", "maxOutputTokens", "responseMimeType"] as const) {
    const v = (cfg as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
