# Implementation Plan: Slack ChatConfig Entity & Encrypted Token Storage

## 📋 Overview
Implement a dedicated domain entity `ChatConfig` and its persistence infrastructure in MongoDB to allow each tenant/user to configure and register their own Slack bot credentials (`botToken`, `appToken`, `signingSecret`, `teamId`). To ensure enterprise-level security, all sensitive credentials will be encrypted at rest using AES-256-GCM prior to being stored in the database.

---

## 🎯 Success Criteria
1. **Domain Model**: `ChatConfig` entity represents chat provider configurations (Slack, expandable to future providers) scoped by `workspaceId`.
2. **Security**: Sensitive tokens (`botToken`, `signingSecret`, `appToken`) are encrypted at rest (AES-256-GCM) using an `EncryptionService` and decrypted seamlessly when retrieved.
3. **Persistence**: `ChatConfigRepository` implemented on top of MongoDB collection `chat_configs` with unique index on `(workspaceId, provider)`.
4. **Use Cases / Endpoints**: Use cases and API handlers created for registering, updating, retrieving, and deleting chat configurations.
5. **Adapter Dynamic Token Resolution**: `SlackChatAdapter` dynamically receives tenant-specific decrypted bot tokens when processing messages.
6. **Tests & Verification**: 100% unit test coverage for `EncryptionService`, `ChatConfig` entity, and `ChatConfigRepository`.

---

## 🛠️ Tech Stack & Rationale
- **Language**: TypeScript (Node.js 20+ ESM)
- **Database**: MongoDB (via `mongodb` driver)
- **Security / Crypto**: Node.js `crypto` module (AES-256-GCM cipher with random IV & auth tag)
- **Testing**: Vitest / Jest (for unit & integration tests)

---

## 📂 File Structure Changes

```
src/
├── domain/
│   ├── ChatConfig.ts                     # Domain entity for ChatConfig
│   └── ports/
│       ├── IChatConfigRepository.ts       # Repository interface
│       └── IEncryptionService.ts          # Encryption service interface
├── infrastructure/
│   ├── security/
│   │   ├── AESEncryptionService.ts       # AES-256-GCM implementation
│   │   └── AESEncryptionService.test.ts  # Unit tests for encryption
├── repositories/
│   ├── ChatConfigRepository.ts           # MongoDB repository implementation
│   └── ChatConfigRepository.test.ts      # Unit tests for repository
├── usecases/
│   ├── RegisterChatConfigUseCase.ts      # Use case to save/update ChatConfig
│   └── GetChatConfigUseCase.ts           # Use case to retrieve ChatConfig
│   ├── RegisterChatConfigUseCase.test.ts # Unit test for use case
│   └── GetChatConfigUseCase.test.ts      # Unit test for use case
└── api/
    └── controllers/
        └── ChatConfigController.ts       # REST controller for ChatConfig endpoints
```

---

## 🔄 Runtime Flow: Busca Dinâmica de Credenciais no Banco de Dados

Para garantir que cada bot cadastrado no agente utilize suas próprias credenciais isoladas, o fluxo de execução funcionará da seguinte forma:

```
[Slack Event Webhook]
       │
       ▼
1. SlackWebhookController
   ├── Extrai o `team_id` da requisição do Slack (ex: "T0123456")
   ├── Consulta `ChatConfigRepository.findByTeamId(teamId)` no MongoDB
   ├── `AESEncryptionService` descriptografa o `signingSecret`
   └── Valida a assinatura da mensagem recebida do Slack
       │
       ▼
2. Fila (BullMQ Queue)
   └── Despacha o job contendo `workspaceId` / `spaceId` / `threadId`
       │
       ▼
3. BullMQWorker / Factory (`ChatProviderFactory`)
   ├── Recebe o job do worker para processamento pelo Agente LLM
   ├── Consulta `ChatConfigRepository.findByWorkspaceId(workspaceId)`
   ├── `AESEncryptionService` descriptografa o `botToken` (`xoxb-...`)
   └── Instancia o `SlackChatAdapter` dinamicamente com o token do bot específico
       │
       ▼
4. Resposta Enviada
   └── `SlackChatAdapter.sendMessage()` envia a resposta para o Slack usando o bot do usuário
```

---

## 🔐 Encryption Strategy (AES-256-GCM)
- **Algorithm**: `aes-256-gcm`
- **Key Source**: `process.env.ENCRYPTION_KEY` (32-byte hex or base64 string)
- **Payload Format**: `iv:authTag:encryptedData` (hex-encoded string)
- **Data Protection**: `botToken`, `appToken`, `signingSecret` são criptografados em memória antes da gravação no MongoDB, e descriptografados automaticamente ao serem lidos pelo `ChatConfigRepository`.

---

## 📝 Task Breakdown

### Phase 1: Security & Encryption Foundation (P0)

#### Task 1.1: Create `IEncryptionService` Port & `AESEncryptionService` Infrastructure
- **Agent**: `security-auditor`
- **Skill**: `clean-code`
- **Priority**: P0 (Blocker for persistence)
- **Dependencies**: None
- **INPUT**: Encryption key requirements (`ENCRYPTION_KEY` env var)
- **OUTPUT**:
  - `src/domain/ports/IEncryptionService.ts`
  - `src/infrastructure/security/AESEncryptionService.ts`
  - `src/infrastructure/security/AESEncryptionService.test.ts`
- **VERIFY**: Run `npm test -- AESEncryptionService.test.ts` to confirm encrypt/decrypt cycle, IV uniqueness, and auth tag validation.

---

### Phase 2: Domain Entity & Repository Port (P0)

#### Task 2.1: Implement `ChatConfig` Domain Entity
- **Agent**: `database-architect`
- **Skill**: `database-design`
- **Priority**: P0
- **Dependencies**: None
- **INPUT**: Chat configuration properties (`workspaceId`, `provider`, `teamId`, `botToken`, `appToken`, `signingSecret`, `isActive`, `createdAt`, `updatedAt`)
- **OUTPUT**: `src/domain/ChatConfig.ts`
- **VERIFY**: Compile TypeScript (`npx tsc --noEmit`) and verify entity validation logic.

#### Task 2.2: Define `IChatConfigRepository` Port
- **Agent**: `database-architect`
- **Skill**: `clean-code`
- **Priority**: P0
- **Dependencies**: Task 2.1
- **INPUT**: `ChatConfig` entity
- **OUTPUT**: `src/domain/ports/IChatConfigRepository.ts`
- **VERIFY**: Compile TypeScript (`npx tsc --noEmit`).

---

### Phase 3: MongoDB Persistence Layer (P1)

#### Task 3.1: Implement `ChatConfigRepository` with Automatic Token Encryption/Decryption
- **Agent**: `database-architect`
- **Skill**: `database-design`
- **Priority**: P1
- **Dependencies**: Task 1.1, Task 2.2
- **INPUT**: MongoDB collection `chat_configs`, `IEncryptionService` reference
- **OUTPUT**:
  - `src/repositories/ChatConfigRepository.ts`
  - `src/repositories/ChatConfigRepository.test.ts`
- **VERIFY**: Unit test repository mapping, upsert operations, and verify tokens stored in DB are not plain text.

---

### Phase 4: Use Cases & REST API Layer (P1)

#### Task 4.1: Create `RegisterChatConfigUseCase` and `GetChatConfigUseCase`
- **Agent**: `backend-specialist`
- **Skill**: `api-patterns`
- **Priority**: P1
- **Dependencies**: Task 3.1
- **INPUT**: `IChatConfigRepository` and input DTOs
- **OUTPUT**:
  - `src/usecases/RegisterChatConfigUseCase.ts`
  - `src/usecases/GetChatConfigUseCase.ts`
- **VERIFY**: Unit tests for use cases verifying validation and error handling.

#### Task 4.2: Implement `ChatConfigController` & Express Routes
- **Agent**: `backend-specialist`
- **Skill**: `api-patterns`
- **Priority**: P1
- **Dependencies**: Task 4.1
- **INPUT**: Use cases, HTTP request validation
- **OUTPUT**:
  - `src/controllers/ChatConfigController.ts`
  - Integration in `src/api/routes.ts` or `src/app.ts`
- **VERIFY**: Send HTTP POST/GET requests to `/api/v1/chat-configs` and verify responses.

---

### Phase 5: Adapter Integration (P2)

#### Task 5.1: Refactor `SlackChatAdapter` and Webhook Handlers to Resolve Tenant Tokens
- **Agent**: `backend-specialist`
- **Skill**: `clean-code`
- **Priority**: P2
- **Dependencies**: Task 4.1
- **INPUT**: `IChatConfigRepository`
- **OUTPUT**: Updated `SlackChatAdapter.ts` and Slack webhook controllers to fetch tenant `ChatConfig` by `workspaceId` / `teamId`.
- **VERIFY**: Execute `npm test` and verify Slack message sending works dynamically with resolved bot tokens.

---

## ✅ PHASE X: Verification Checklist

- [x] `npx tsc --noEmit` passes without type errors
- [x] `npm test` passes all unit & integration tests
- [x] Secrets check: No plain text tokens saved in MongoDB `chat_configs` collection
- [x] `ENCRYPTION_KEY` properly documented in `.env.example` and `.env`
- [x] REST API endpoints `/api/v1/chat-configs` & `/api/chat-configs` implemented and tested

## ✅ PHASE X COMPLETE
- Security: ✅ AES-256-GCM Token Encryption Implemented
- Persistence: ✅ MongoDB `chat_configs` Collection & `ChatConfigRepository` Implemented
- Factory & Adaptadores: ✅ Dynamic Token Resolution with `ChatProviderFactory`
- Date: 2026-08-14

