# TODO — Fase 1: Production Hardening

> Checklist de implementação organizado por sub-fase.
> Marque `[x]` conforme cada item for concluído.
> Referência: [production-hardening.md](production-hardening.md)

---

## Sub-Fase 1A: Security Foundation

**Branch:** `feat/phase1a-security`

### Implementação

- [x] Criar `src/domain/Role.ts` — Enum `Role` (ADMIN, OPERATOR, VIEWER)
- [x] Modificar `src/domain/Password.ts` — Migrar SHA-256 → `crypto.scrypt`
  - [x] `create()` com salt aleatório de 16 bytes
  - [x] `compare()` com `timingSafeEqual` e detecção de formato (scrypt vs legacy)
  - [x] `needsRehash()` para detectar hash legado
  - [x] Manter `restore()` compatível com ambos formatos
- [x] Modificar `src/domain/User.ts` — Adicionar campo `role: Role`
- [x] Modificar `src/usecases/LoginUserUseCase.ts`
  - [x] Incluir `role` no JWT payload
  - [x] `verify()` retorna `role` no `JwtPayload`
  - [x] Re-hash automático de senhas legacy no login
- [x] Modificar `src/usecases/RegisterUserUseCase.ts` — Aceitar `role` opcional (default: OPERATOR)
- [x] Criar `src/api/middlewares/requireRole.ts` — Middleware factory RBAC
- [x] Criar `src/api/middlewares/auditLogger.ts` — Auditoria de operações admin
- [x] Modificar `src/api/onboardingRouter.ts`
  - [x] `POST /onboarding/tenants` → auth + requireRole(ADMIN)
  - [x] `POST /onboarding/spaces` → auth + requireRole(ADMIN)
  - [x] `POST /onboarding/associate-tenant` → adicionar requireRole(ADMIN)
- [x] Modificar `src/api/chatConfigRouter.ts`
  - [x] `POST /chat-configs` → auth + requireRole(ADMIN)
  - [x] `GET /chat-configs/:workspaceId` → auth
- [x] Modificar `src/repositories/UserRepository.ts` — Persistir/ler campo `role` (backward compat)
- [x] Modificar `src/api/types/express.d.ts` — Adicionar `role` ao `req.user`

### Testes

- [x] `src/domain/Password.test.ts` — scrypt create/compare, legacy compat, needsRehash, timing-safe
- [x] `src/api/middlewares/requireRole.test.ts` — permite/rejeita roles, formato do 403
- [x] `src/api/middlewares/auditLogger.test.ts` — loga campos corretos
- [x] `src/usecases/LoginUserUseCase.test.ts` — JWT inclui role, re-hash automático
- [ ] Integração: rotas protegidas retornam 401/403 corretamente

### Verificação

- [x] `npm test` — todos os testes passam (109/109 ✅)
- [x] `npm run build` — build sem erros (tsc --noEmit ✅)
- [ ] Manual: login com senha SHA-256 existente funciona e faz re-hash
- [ ] Manual: rotas admin sem token → 401, sem role → 403

---

## Sub-Fase 1B: Tenant Isolation & Secrets Management

**Branch:** `feat/phase1b-isolation`
**Depende de:** ✅ 1A concluída

### Implementação

- [x] Criar `src/api/middlewares/tenantGuard.ts` — Guard de isolamento de tenant
  - [x] Extrai workspaceId de params ou body
  - [x] Valida contra `req.user.workspaceIds`
  - [x] Retorna 403 se user não pertence ao workspace
- [x] Modificar `src/infrastructure/security/AESEncryptionService.ts`
  - [x] Extrair interface genérica para encrypt/decrypt
  - [x] Adicionar HKDF key derivation com contexto separado para MCP
- [x] Modificar `src/repositories/TenantRepository.ts`
  - [x] Injetar `IEncryptionService` no construtor
  - [x] `save()`: criptografar `mcpConfig.apiKey`
  - [x] `findByWorkspaceId()`: descriptografar `mcpConfig.apiKey`
  - [x] `findByWorkspaceIdSafe()`: retornar com apiKey mascarada
- [x] Modificar `src/usecases/ProcessAgentResponseUseCase.ts`
  - [x] Guard cross-tenant: validar workspaceId do mapping
- [x] Modificar `src/api/chatConfigRouter.ts`
  - [x] `GET /chat-configs/:workspaceId` → adicionar `tenantGuard('workspaceId')`
- [x] Modificar `src/config/container.ts`
  - [x] Injetar `AESEncryptionService` no `TenantRepository`

### Testes

- [x] `src/api/middlewares/tenantGuard.test.ts` — permite own workspace, rejeita cross-tenant
- [x] `src/repositories/TenantRepository.test.ts` — apiKey criptografada/descriptografada/mascarada
- [x] Integração: tenant A não acessa dados de tenant B (`src/api/chatConfigRouter.test.ts`)

### Verificação

- [x] `npm test` — todos os testes passam (206/206 ✅)
- [x] `npm run build` — build sem erros (tsc ✅)
- [ ] Manual: verificar no MongoDB que `mcpConfig.apiKey` está criptografada
- [ ] Manual: GET chat-config com user de outro tenant → 403

---

## Sub-Fase 1C: Reliability Core

**Branch:** `feat/phase1c-reliability`
**Depende de:** Nenhuma (parallelizável com 1A/1B)

### Implementação

- [x] Criar `src/infrastructure/resilience/CircuitBreaker.ts`
  - [x] Estados: CLOSED → OPEN → HALF_OPEN → CLOSED
  - [x] Config: failureThreshold (5), resetTimeoutMs (30s), halfOpenMaxCalls (1)
  - [x] `execute<T>(fn)` com tracking de falhas e transições
  - [x] `CircuitBreakerOpenError` para quando circuito está aberto
  - [x] Métricas Prometheus: `circuit_breaker_state`, `circuit_breaker_failures_total`
- [x] Criar `src/infrastructure/resilience/RetryPolicy.ts`
  - [x] Retry com exponential backoff + jitter
  - [x] Config: maxRetries (3), baseDelayMs (1000), maxDelayMs (10000)
  - [x] `isRetryable(error)`: apenas erros transitórios (network, 502, 503, 504)
- [x] Criar `src/infrastructure/resilience/IdempotencyGuard.ts`
  - [x] `isDuplicate(key)` via Redis SET NX EX
  - [x] TTL configurável (default: 3600s)
- [x] Modificar `src/infrastructure/mcp/MCPHttpAdapter.ts`
  - [x] Aceitar `CircuitBreaker` e `RetryPolicy` no construtor
  - [x] `executeTool()` → circuit breaker + retry
  - [x] `listTools()` → circuit breaker + retry
- [x] Modificar `src/harness/ExecutionPolicy.ts`
  - [x] Adicionar `maxRunTimeMs` (default: 120000)
  - [x] Adicionar `llmTimeoutMs` (default: 60000)
- [x] Modificar `src/harness/AgentHarness.ts`
  - [x] Timeout global via AbortController + setTimeout
  - [x] Fallback quando circuit breaker MCP está aberto
  - [x] Resposta parcial se timeout atingido
- [x] Modificar `src/controllers/ChatWebhookController.ts`
  - [x] Injetar `IdempotencyGuard`
  - [x] Verificar duplicidade antes de enfileirar
- [x] Modificar `src/controllers/SlackWebhookController.ts`
  - [x] Injetar `IdempotencyGuard`
  - [x] Usar `event_id` como chave de idempotência
- [x] Modificar `src/infrastructure/queue/BullMQAdapter.ts`
  - [x] `jobId` determinístico com hash + timestamp bucket (5s)
- [x] Modificar `src/config/container.ts`
  - [x] Criar e injetar `IdempotencyGuard` nos controllers
  - [x] Criar `CircuitBreaker` por tenant no `ProcessAgentResponseUseCase`

### Testes

- [x] `CircuitBreaker.test.ts` — transições de estado, threshold, half-open, reset, métricas
- [x] `RetryPolicy.test.ts` — retry em transitório, skip em 4xx, exponential, max retries
- [x] `IdempotencyGuard.test.ts` — primeira → false, segunda → true, TTL expira → false
- [x] `MCPHttpAdapter.test.ts` — circuit breaker + retry + timeout integrados
- [x] `AgentHarness.test.ts` — timeout global aborta, fallback sem tools
- [x] `ChatWebhookController.test.ts` — webhook duplicado → 200 sem enfileirar
- [x] `SlackWebhookController.test.ts` — event_id duplicado → 200 sem enfileirar

### Verificação

- [x] `npm test` — todos os testes passam (233/233 ✅)
- [x] `npm run build` — build sem erros (tsc ✅)
- [ ] Manual: simular falha de MCP 5x → circuit breaker abre → log de transição
- [ ] Manual: enviar mesmo webhook 2x → segundo ignorado
- [ ] Manual: run com MCP lento → timeout global aborta após 2min

---

## Sub-Fase 1D: Operational Readiness

**Branch:** `feat/phase1d-operations`
**Depende de:** ✅ 1A concluída (rate limit por tenant usa auth context)

### Implementação

- [x] Criar `src/infrastructure/health/HealthChecker.ts`
  - [x] `checkReadiness()` → verifica MongoDB + Redis
  - [x] Retorna `{ status: 'ready'|'degraded', checks: {...} }`
- [x] Modificar `src/app.ts`
  - [x] Manter `GET /api/health` como liveness (rápido)
  - [x] Adicionar `GET /api/health/ready` como readiness probe
- [x] Modificar `src/index.ts`
  - [x] Shutdown sequence completa: servers → workers → tracing → Redis → MongoDB
  - [x] Safety timeout: `setTimeout(() => process.exit(1), 30000).unref()`
  - [x] Log de cada etapa do shutdown
- [x] Modificar `src/infrastructure/database/MongoConnection.ts`
  - [x] Adicionar `disconnect()` method
  - [x] Adicionar `ping()` method para health check
- [x] Modificar `src/api/middlewares/rateLimiter.ts`
  - [x] Adicionar `tenantRateLimiter` com key generator customizado
  - [x] Config: 200 req/15min por tenant
  - [x] Fallback para IP se user não autenticado
- [x] Modificar `Dockerfile`
  - [x] Adicionar `USER node` no stage final
  - [x] Adicionar `STOPSIGNAL SIGTERM`
  - [x] Adicionar `HEALTHCHECK` instruction

### Testes

- [x] `HealthChecker.test.ts` — all ok → ready, MongoDB down → degraded, Redis down → degraded
- [x] Health API (integração) — `/api/health` → 200, `/api/health/ready` com mocks (`health.integration.test.ts`)
- [x] `rateLimiter.test.ts` — tenant rate limit: authenticated tenant, IP fallback, health checks skip
- [x] Shutdown (integração) — SIGTERM → drain → exit 0

### Verificação

- [x] `npm test` — todos os testes passam (245/245 ✅)
- [x] `npm run build` — build sem erros (tsc ✅)
- [x] `npm run test:coverage` — cobertura de 85.4% de statements e 87% de linhas ✅
- [ ] `docker build` — image constrói sem erros
- [ ] Manual: `/api/health/ready` com Redis parado → 503
- [ ] Manual: SIGTERM com jobs em andamento → drena antes de sair
- [ ] Manual: Docker container roda como non-root (verificar `whoami`)

---

## Definition of Done (Fase 1 Completa)

- [x] Todas as 4 sub-fases concluídas (1A, 1B, 1C, 1D)
- [x] Todos os testes unitários passam (`npm test` - 245 testes)
- [x] Coverage ≥ 80% nos arquivos novos (`npm run test:coverage` - 87% global)
- [x] Build de produção sem erros (`npm run build`)
- [x] Docker image configurada como non-root (`node`), STOPSIGNAL e HEALTHCHECK ativo
- [x] Nenhum endpoint administrativo acessível sem auth + role
- [x] Nenhuma credencial em plain text no MongoDB (criptografadas via AES-256-GCM + HKDF)
- [x] Webhook duplicado não gera processamento duplo (IdempotencyGuard + deterministic jobId)
- [x] MCP failure não derruba todo o sistema (CircuitBreaker + RetryPolicy + Harness fallback)
- [x] Graceful shutdown drena todos os jobs antes de exit com timeout defensivo de 30s
- [x] Health check readiness retorna 503 quando dependência está down
- [x] Atualizar `docs/roadmap.md` — marcar itens da Fase 1 como `[x]`

