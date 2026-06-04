import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  phoenixEndpoint: process.env.PHOENIX_COLLECTOR_ENDPOINT ?? "http://localhost:6006",
  phoenixProjectName: process.env.PHOENIX_PROJECT_NAME ?? "data-anal-agent",
  phoenixApiKey: process.env.PHOENIX_API_KEY,
};
