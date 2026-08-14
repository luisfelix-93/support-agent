import { BullMQAdapter } from '../infrastructure/queue/BullMQAdapter.js';
import { BullMQWorker } from '../infrastructure/queue/BullMQWorker.js';
import { GoogleChatAdapter } from '../infrastructure/chat/GoogleChatAdapter.js';
import { SlackChatAdapter } from '../infrastructure/chat/SlackChatAdapter.js';
import { ChatProviderFactory } from '../infrastructure/chat/ChatProviderFactory.js';
import { ProcessAgentResponseUse } from '../usecases/ProcessAgentResponseUseCase.js';
import { ChatWebhookController } from '../controllers/ChatWebhookController.js';
import { SlackWebhookController } from '../controllers/SlackWebhookController.js';
import { ChatConfigController } from '../controllers/ChatConfigController.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { TenantRepository } from '../repositories/TenantRepository.js';
import { ChatRepository } from '../repositories/ChatRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { SpaceMappingRepository } from '../repositories/SpaceMappingRepository.js';
import { ChatConfigRepository } from '../repositories/ChatConfigRepository.js';
import { RegisterUserUseCase } from '../usecases/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { RegisterTenantUseCase } from '../usecases/RegisterTenantUseCase.js';
import { RegisterSpaceUseCase } from '../usecases/RegisterSpaceUseCase.js';
import { AssociateTenantToUserUseCase } from '../usecases/AssociateTenantToUserUseCase.js';
import { RegisterChatConfigUseCase } from '../usecases/RegisterChatConfigUseCase.js';
import { GetChatConfigUseCase } from '../usecases/GetChatConfigUseCase.js';
import { OnboardingController } from '../controllers/OnboardingController.js';
import { AuthController } from '../controllers/AuthController.js';
import { Redis } from 'ioredis';

// ─── Database Connection ─────────────────────────────
await MongoConnection.connect(
    process.env.MONGODB_URI!,
    process.env.MONGODB_DB_NAME!
);

// ─── Redis Connection (ioredis) ──────────────────────
const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
    });

// ─── Repositories ────────────────────────────────────
const tenantRepository = new TenantRepository();
const chatRepository = new ChatRepository();
const userRepository = new UserRepository();
const spaceMappingRepository = new SpaceMappingRepository();
export const chatConfigRepository = new ChatConfigRepository();

// ─── Infrastructure Adapters & Factories ─────────────
const queueAdapter = new BullMQAdapter(redisConnection);
const googleChatAdapter = new GoogleChatAdapter();
const fallbackSlackChatAdapter = new SlackChatAdapter(
    process.env.SLACK_BOT_TOKEN || 'xoxb-dummy-placeholder-token'
);

export const chatProviderFactory = new ChatProviderFactory(
    chatConfigRepository,
    process.env.SLACK_BOT_TOKEN
);

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

export const registerChatConfigUseCase = new RegisterChatConfigUseCase(chatConfigRepository);
export const getChatConfigUseCase = new GetChatConfigUseCase(chatConfigRepository);

// ─── Controllers ────────────────────────────────────
export const webhookController = new ChatWebhookController(queueAdapter);
export const chatConfigController = new ChatConfigController(
    registerChatConfigUseCase,
    getChatConfigUseCase
);

export const queueWorker = new BullMQWorker(
    redisConnection,
    processAgentUseCase,
    {
        google: googleChatAdapter,
        slack: fallbackSlackChatAdapter,
    },
    'message-processing',
    chatProviderFactory
);

if (process.env.START_WORKER !== 'false') {
    queueWorker.start();
}
export const authController = new AuthController(loginUserUseCase);
export const onboardingController = new OnboardingController(
    registerUserUseCase,
    registerTenantUseCase,
    registerSpaceUseCase,
    associateTenantUseCase
);
export const slackWebhookController = new SlackWebhookController(
    queueAdapter,
    process.env.SLACK_SIGNING_SECRET,
    chatConfigRepository
);
