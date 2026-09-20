import { config } from "../config.js";
import { BedrockCareLlmClient } from "./bedrock.js";
import { type CareLlmClient, OfflineCareLlmClient } from "./careLlm.js";

/** Pick the reasoning backend: Amazon Bedrock (default) or the offline client. */
export function createLlmClient(): CareLlmClient {
  if (config.llmProvider === "offline") {
    console.log("[llm] OfflineCareLlmClient (LLM_PROVIDER=offline)");
    return new OfflineCareLlmClient();
  }
  console.log(
    `[llm] Amazon Bedrock · model=${config.aws.bedrockModelId} ` +
      `region=${config.aws.bedrockRegion} failover=${config.aws.bedrockFailoverRegion}`
  );
  return new BedrockCareLlmClient();
}
