import { BullMQAdapter } from '../infrastructure/queue/BullMQAdapter.js';
import { BullMQWorker } from '../infrastructure/queue/BullMQWorker.js';
import { MemoryPromotionWorker } from '../infrastructure/queue/MemoryPromotionWorker.js';
import { EvaluationWorker } from '../infrastructure/queue/EvaluationWorker.js';
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
import { MongoMemoryRepository } from '../repositories/MongoMemoryRepository.js';
import { AgentRunRepository } from '../repositories/AgentRunRepository.js';
import { EvaluationRepository } from '../repositories/EvaluationRepository.js';
import { RegisterUserUseCase } from '../usecases/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { RegisterTenantUseCase } from '../usecases/RegisterTenantUseCase.js';
import { RegisterSpaceUseCase } from '../usecases/RegisterSpaceUseCase.js';
import { AssociateTenantToUserUseCase } from '../usecases/AssociateTenantToUserUseCase.js';
import { RegisterChatConfigUseCase } from '../usecases/RegisterChatConfigUseCase.js';
import { GetChatConfigUseCase } from '../usecases/GetChatConfigUseCase.js';
import { OnboardingController } from '../controllers/OnboardingController.js';
import { AuthController } from '../controllers/AuthController.js';
import { EvaluationController } from '../controllers/EvaluationController.js';
import { AggregationService } from '../evaluation/AggregationService.js';
import { Redis } from 'ioredis';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { RedisShortTermMemory } from '../infrastructure/memory/RedisShortTermMemory.js';
import { LLMMemoryExtractor } from '../infrastructure/memory/LLMMemoryExtractor.js';
import { OpenAIEmbeddingProvider } from '../infrastructure/llm/OpenAIEmbeddingProvider.js';
import { ContextAssembler } from '../harness/ContextAssembler.js';
import { AgentHarness } from '../harness/AgentHarness.js';
import { AESEncryptionService } from '../infrastructure/security/AESEncryptionService.js';
import { IdempotencyGuard } from '../infrastructure/resilience/IdempotencyGuard.js';

import { HealthChecker } from '../infrastructure/health/HealthChecker.js';

// ─── Database Connection ─────────────────────────────
await MongoConnection.connect(
    process.env.MONGODB_URI!,
    process.env.MONGODB_DB_NAME!
);

// ─── Redis Connection (ioredis) ──────────────────────
export const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
    });

export const healthChecker = new HealthChecker({ redisClient: redisConnection });

// ─── Repositories ────────────────────────────────────
const encryptionService = new AESEncryptionService();
const tenantRepository = new TenantRepository(encryptionService);
const chatRepository = new ChatRepository();
const userRepository = new UserRepository();
const spaceMappingRepository = new SpaceMappingRepository();
export const chatConfigRepository = new ChatConfigRepository(encryptionService);
export const memoryRepository = new MongoMemoryRepository();
export const agentRunRepository = new AgentRunRepository();
export const evaluationRepository = new EvaluationRepository();

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

// ─── Embeddings & Vector Search ──────────────────────
const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY || (process.env.LLM_PROVIDER === 'openai' ? process.env.LLM_API_KEY : undefined);
const isVectorMemoryEnabled = process.env.VECTOR_MEMORY_ENABLED !== 'false';
export const embeddingProvider = embeddingApiKey && isVectorMemoryEnabled
    ? new OpenAIEmbeddingProvider(embeddingApiKey, process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small')
    : undefined;

// ─── Agent Harness, Short-Term & Long-Term Memory ─────
const tokenCounter = new TiktokenAdapter();
const contextAssembler = new ContextAssembler(tokenCounter);
const shortTermMemory = new RedisShortTermMemory(redisConnection);
const memoryExtractor = new LLMMemoryExtractor();

const isLongTermMemoryEnabled = process.env.LONG_TERM_MEMORY_ENABLED !== 'false';
const activeMemoryRepository = isLongTermMemoryEnabled ? memoryRepository : undefined;

const agentHarness = new AgentHarness(
    contextAssembler,
    shortTermMemory,
    undefined,
    activeMemoryRepository,
    queueAdapter,
    embeddingProvider,
    agentRunRepository
);

// ─── Use Cases ───────────────────────────────────────
const processAgentUseCase = new ProcessAgentResponseUse(
    spaceMappingRepository,
    tenantRepository,
    chatRepository,
    agentHarness
);

const registerUserUseCase = new RegisterUserUseCase(userRepository);
const loginUserUseCase = new LoginUserUseCase(userRepository);
const registerTenantUseCase = new RegisterTenantUseCase(tenantRepository);
const registerSpaceUseCase = new RegisterSpaceUseCase(spaceMappingRepository, tenantRepository);
const associateTenantUseCase = new AssociateTenantToUserUseCase(userRepository, tenantRepository);

export const registerChatConfigUseCase = new RegisterChatConfigUseCase(chatConfigRepository);
export const getChatConfigUseCase = new GetChatConfigUseCase(chatConfigRepository);

// ─── Resilience & Idempotency ────────────────────────
export const idempotencyGuard = new IdempotencyGuard(redisConnection);

// ─── Controllers ────────────────────────────────────
export const webhookController = new ChatWebhookController(queueAdapter, idempotencyGuard);
export const chatConfigController = new ChatConfigController(
    registerChatConfigUseCase,
    getChatConfigUseCase
);
export const aggregationService = new AggregationService(evaluationRepository);
export const evaluationController = new EvaluationController(evaluationRepository, aggregationService);

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

export const memoryPromotionWorker = new MemoryPromotionWorker(
    redisConnection,
    tenantRepository,
    memoryExtractor,
    memoryRepository,
    embeddingProvider,
    'memory-promotion'
);

export const evaluationWorker = new EvaluationWorker(
    redisConnection,
    tenantRepository,
    evaluationRepository,
    'agent-evaluation'
);

if (process.env.START_WORKER !== 'false') {
    queueWorker.start();
    memoryPromotionWorker.start();
    evaluationWorker.start();
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
    chatConfigRepository,
    idempotencyGuard
);
