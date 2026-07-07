import { QStashAdapter } from '../infrastructure/queue/QStashAdapter.js';
import { GoogleChatAdapter } from '../infrastructure/chat/GoogleChatAdapter.js';
import { ProcessAgentResponseUse } from '../usecases/ProcessAgentResponseUseCase.js';
import { ChatWebhookController } from '../controllers/ChatWebhookController.js';
import { WorkerController } from '../controllers/WorkerController.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { TenantRepository } from '../repositories/TenantRepository.js';
import { ChatRepository } from '../repositories/ChatRepository.js';

// ─── Database Connection ─────────────────────────────
await MongoConnection.connect(
    process.env.MONGODB_URI!,
    process.env.MONGODB_DB_NAME!
);

// ─── Infrastructure Adapters ─────────────────────────
const queueAdapter = new QStashAdapter(
    process.env.QSTASH_TOKEN!,
    process.env.WORKER_URL!
);

const chatAdapter = new GoogleChatAdapter();

// ─── Repositories ────────────────────────────────────
const tenantRepository = new TenantRepository();
const chatRepository = new ChatRepository();

// ─── Use Cases ───────────────────────────────────────
const processAgentUseCase = new ProcessAgentResponseUse(
    tenantRepository,
    chatRepository,
    chatAdapter
);

// ─── Controllers ─────────────────────────────────────
export const webhookController = new ChatWebhookController(queueAdapter);
export const workerController = new WorkerController(processAgentUseCase);
