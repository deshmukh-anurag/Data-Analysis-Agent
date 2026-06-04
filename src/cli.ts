import { shutdownTracing } from "./tracing.js";
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
  const { finalAnswer, trace } = await runAgent(question);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log("─".repeat(60));
  console.log("Tool trace");
  console.log("─".repeat(60));
  for (const [i, t] of trace.entries()) {
    console.log(`\n[${i + 1}] ${t.toolName}`);
    console.log(`    args: ${JSON.stringify(t.args)}`);
    const resultStr = JSON.stringify(t.result, null, 2);
    const truncated =
      resultStr.length > 1200 ? resultStr.slice(0, 1200) + "\n… (truncated)" : resultStr;
    console.log(
      truncated
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }

  console.log("\n" + "─".repeat(60));
  console.log("Final answer");
  console.log("─".repeat(60));
  console.log(finalAnswer);
  console.log(`\n(${elapsed}s, ${trace.length} tool call${trace.length === 1 ? "" : "s"})`);
}

main()
  .catch((err) => {
    console.error("Agent error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await shutdownTracing();
  });
