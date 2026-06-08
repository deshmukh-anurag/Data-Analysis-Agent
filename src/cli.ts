import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { runAgent } from "./agent.js";
import { prisma } from "./prisma.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

function truncate(s: string, max = 800): string {
  return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s;
}

async function main() {
  const args = process.argv.slice(2);
  let question = args.join(" ").trim();

  if (!question && !process.stdin.isTTY) {
    question = await readStdin();
  }

  if (!question) {
    console.error(
      'Usage: npm run ask -- "your question about the sales data"\n' +
        '   or: echo "question" | npm run ask',
    );
    process.exit(1);
  }

  console.log(`\nQuestion: ${question}\n`);

  const start = Date.now();
  const { finalAnswer, messages } = await runAgent(question);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log("─".repeat(60));
  console.log("Message trace");
  console.log("─".repeat(60));
  for (const m of messages) {
    if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        console.log(`\n[call] ${tc.name}`);
        console.log(`       args: ${JSON.stringify(tc.args)}`);
      }
    } else if (m instanceof ToolMessage) {
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      console.log(`\n[result] ${m.name ?? "tool"}`);
      console.log(
        truncate(content)
          .split("\n")
          .map((l) => "         " + l)
          .join("\n"),
      );
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log("Final answer");
  console.log("─".repeat(60));
  console.log(finalAnswer);
  console.log(`\n(${elapsed}s, ${messages.length} messages)`);
}

main()
  .catch((err) => {
    console.error("Agent error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
