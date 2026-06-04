import { register } from "@arizeai/phoenix-otel";
import { config } from "./config.js";

export const tracerProvider = register({
  projectName: config.phoenixProjectName,
  url: config.phoenixEndpoint,
  apiKey: config.phoenixApiKey,
});

export async function shutdownTracing(): Promise<void> {
  try {
    await tracerProvider.shutdown();
  } catch {
    // shutdown errors during process exit are non-fatal
  }
}
