import { QStashAdapter } from '../infrastructure/queue/QStashAdapter.js';
import { GoogleChatAdapter } from '../infrastructure/chat/GoogleChatAdapter.js';
import { MCPHttpAdapter } from '../infrastructure/mcp/MCPHttpAdapter.js';
import { LLMFactory } from '../infrastructure/llm/LLMFactory.js';
import { ProcessAgentResponseUse } from '../usecases/ProcessAgentResponseUseCase.js';
import { ChatWebhookController } from '../controllers/ChatWebhookController.js';
import { WorkerController } from '../controllers/WorkerController.js';
import type { LLMProviderType } from '../domain/LLMConfig.js';

// ─── Infrastructure Adapters ─────────────────────────
const queueAdapter = new QStashAdapter(
    process.env.QSTASH_TOKEN!,
    process.env.WORKER_URL!
);

const chatAdapter = new GoogleChatAdapter();

const mcpAdapter = new MCPHttpAdapter(
    process.env.MCP_SERVER_URL!,
    process.env.MCP_API_KEY!
);

const llmModel = process.env.LLM_MODEL;
const llmAdapter = LLMFactory.create({
    provider: (process.env.LLM_PROVIDER ?? 'openai') as LLMProviderType,
    apiKey: process.env.LLM_API_KEY!,
    ...(llmModel ? { model: llmModel } : {})
});

// ─── Use Cases ───────────────────────────────────────
const processAgentUseCase = new ProcessAgentResponseUse(
    llmAdapter,
    mcpAdapter,
    chatAdapter
);

// ─── Controllers ─────────────────────────────────────
export const webhookController = new ChatWebhookController(queueAdapter);
export const workerController = new WorkerController(processAgentUseCase);
