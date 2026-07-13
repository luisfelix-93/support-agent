import { QStashAdapter } from '../infrastructure/queue/QStashAdapter.js';
import { GoogleChatAdapter } from '../infrastructure/chat/GoogleChatAdapter.js';
import { SlackChatAdapter } from '../infrastructure/chat/SlackChatAdapter.js';
import { ProcessAgentResponseUse } from '../usecases/ProcessAgentResponseUseCase.js';
import { ChatWebhookController } from '../controllers/ChatWebhookController.js';
import { SlackWebhookController } from '../controllers/SlackWebhookController.js';
import { WorkerController } from '../controllers/WorkerController.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { TenantRepository } from '../repositories/TenantRepository.js';
import { ChatRepository } from '../repositories/ChatRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { SpaceMappingRepository } from '../repositories/SpaceMappingRepository.js';
import { RegisterUserUseCase } from '../usecases/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { RegisterTenantUseCase } from '../usecases/RegisterTenantUseCase.js';
import { RegisterSpaceUseCase } from '../usecases/RegisterSpaceUseCase.js';
import { AssociateTenantToUserUseCase } from '../usecases/AssociateTenantToUserUseCase.js';
import { OnboardingController } from '../controllers/OnboardingController.js';
import { AuthController } from '../controllers/AuthController.js';

// ─── Database Connection ─────────────────────────────
await MongoConnection.connect(
    process.env.MONGODB_URI!,
    process.env.MONGODB_DB_NAME!
);

// ─── Infrastructure Adapters ─────────────────────
const queueAdapter = new QStashAdapter(
    process.env.QSTASH_TOKEN!,
    process.env.WORKER_URL!
);

const chatAdapter = new GoogleChatAdapter();

const slackChatAdapter = new SlackChatAdapter(
    process.env.SLACK_BOT_TOKEN!
);

// ─── Repositories ────────────────────────────────────
const tenantRepository = new TenantRepository();
const chatRepository = new ChatRepository();
const userRepository = new UserRepository();
const spaceMappingRepository = new SpaceMappingRepository();

// ─── Use Cases ───────────────────────────────────────
const processAgentUseCase = new ProcessAgentResponseUse(
    spaceMappingRepository,
    tenantRepository,
    chatRepository,
);

const registerUserUseCase = new RegisterUserUseCase(userRepository);
const loginUserUseCase = new LoginUserUseCase(userRepository);
const registerTenantUseCase = new RegisterTenantUseCase(tenantRepository);
const registerSpaceUseCase = new RegisterSpaceUseCase(spaceMappingRepository, tenantRepository);
const associateTenantUseCase = new AssociateTenantToUserUseCase(userRepository, tenantRepository);

// ─── Controllers ────────────────────────────────────
export const webhookController = new ChatWebhookController(queueAdapter);
export const workerController = new WorkerController(processAgentUseCase, {
    google: chatAdapter,
    slack: slackChatAdapter,
});
export const authController = new AuthController(loginUserUseCase);
export const onboardingController = new OnboardingController(
    registerUserUseCase,
    registerTenantUseCase,
    registerSpaceUseCase,
    associateTenantUseCase
);
export const slackWebhookController = new SlackWebhookController(
    queueAdapter,
    process.env.SLACK_SIGNING_SECRET!
);
