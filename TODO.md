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

- [ ] Criar `src/api/middlewares/tenantGuard.ts` — Guard de isolamento de tenant
  - [ ] Extrai workspaceId de params ou body
  - [ ] Valida contra `req.user.workspaceIds`
  - [ ] Retorna 403 se user não pertence ao workspace
- [ ] Modificar `src/infrastructure/security/AESEncryptionService.ts`
  - [ ] Extrair interface genérica para encrypt/decrypt
  - [ ] Adicionar HKDF key derivation com contexto separado para MCP
- [ ] Modificar `src/repositories/TenantRepository.ts`
  - [ ] Injetar `IEncryptionService` no construtor
  - [ ] `save()`: criptografar `mcpConfig.apiKey`
  - [ ] `findByWorkspaceId()`: descriptografar `mcpConfig.apiKey`
  - [ ] `findByWorkspaceIdSafe()`: retornar com apiKey mascarada
- [ ] Modificar `src/usecases/ProcessAgentResponseUseCase.ts`
  - [ ] Guard cross-tenant: validar workspaceId do mapping
- [ ] Modificar `src/api/chatConfigRouter.ts`
  - [ ] `GET /chat-configs/:workspaceId` → adicionar `tenantGuard('workspaceId')`
- [ ] Modificar `src/config/container.ts`
  - [ ] Injetar `AESEncryptionService` no `TenantRepository`

### Testes

- [ ] `src/api/middlewares/tenantGuard.test.ts` — permite own workspace, rejeita cross-tenant
- [ ] `src/repositories/TenantRepository.test.ts` — apiKey criptografada/descriptografada/mascarada
- [ ] Integração: tenant A não acessa dados de tenant B

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros
- [ ] Manual: verificar no MongoDB que `mcpConfig.apiKey` está criptografada
- [ ] Manual: GET chat-config com user de outro tenant → 403

---

## Sub-Fase 1C: Reliability Core

**Branch:** `feat/phase1c-reliability`
**Depende de:** Nenhuma (parallelizável com 1A/1B)

### Implementação

- [ ] Criar `src/infrastructure/resilience/CircuitBreaker.ts`
  - [ ] Estados: CLOSED → OPEN → HALF_OPEN → CLOSED
  - [ ] Config: failureThreshold (5), resetTimeoutMs (30s), halfOpenMaxCalls (1)
  - [ ] `execute<T>(fn)` com tracking de falhas e transições
  - [ ] `CircuitBreakerOpenError` para quando circuito está aberto
  - [ ] Métricas Prometheus: `circuit_breaker_state`, `circuit_breaker_failures_total`
- [ ] Criar `src/infrastructure/resilience/RetryPolicy.ts`
  - [ ] Retry com exponential backoff + jitter
  - [ ] Config: maxRetries (3), baseDelayMs (1000), maxDelayMs (10000)
  - [ ] `isRetryable(error)`: apenas erros transitórios (network, 502, 503, 504)
- [ ] Criar `src/infrastructure/resilience/IdempotencyGuard.ts`
  - [ ] `isDuplicate(key)` via Redis SET NX EX
  - [ ] TTL configurável (default: 3600s)
- [ ] Modificar `src/infrastructure/mcp/MCPHttpAdapter.ts`
  - [ ] Aceitar `CircuitBreaker` e `RetryPolicy` no construtor
  - [ ] `executeTool()` → circuit breaker + retry
  - [ ] `listTools()` → circuit breaker + retry
- [ ] Modificar `src/harness/ExecutionPolicy.ts`
  - [ ] Adicionar `maxRunTimeMs` (default: 120000)
  - [ ] Adicionar `llmTimeoutMs` (default: 60000)
- [ ] Modificar `src/harness/AgentHarness.ts`
  - [ ] Timeout global via AbortController + setTimeout
  - [ ] Fallback quando circuit breaker MCP está aberto
  - [ ] Resposta parcial se timeout atingido
- [ ] Modificar `src/controllers/ChatWebhookController.ts`
  - [ ] Injetar `IdempotencyGuard`
  - [ ] Verificar duplicidade antes de enfileirar
- [ ] Modificar `src/controllers/SlackWebhookController.ts`
  - [ ] Injetar `IdempotencyGuard`
  - [ ] Usar `event_id` como chave de idempotência
- [ ] Modificar `src/infrastructure/queue/BullMQAdapter.ts`
  - [ ] `jobId` determinístico com hash + timestamp bucket (5s)
- [ ] Modificar `src/config/container.ts`
  - [ ] Criar e injetar `IdempotencyGuard` nos controllers
  - [ ] Criar `CircuitBreaker` por tenant no `ProcessAgentResponseUseCase`

### Testes

- [ ] `CircuitBreaker.test.ts` — transições de estado, threshold, half-open, reset, métricas
- [ ] `RetryPolicy.test.ts` — retry em transitório, skip em 4xx, exponential, max retries
- [ ] `IdempotencyGuard.test.ts` — primeira → false, segunda → true, TTL expira → false
- [ ] `MCPHttpAdapter.test.ts` — circuit breaker + retry + timeout integrados
- [ ] `AgentHarness.test.ts` — timeout global aborta, fallback sem tools
- [ ] `ChatWebhookController.test.ts` — webhook duplicado → 200 sem enfileirar
- [ ] `SlackWebhookController.test.ts` — event_id duplicado → 200 sem enfileirar

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros
- [ ] Manual: simular falha de MCP 5x → circuit breaker abre → log de transição
- [ ] Manual: enviar mesmo webhook 2x → segundo ignorado
- [ ] Manual: run com MCP lento → timeout global aborta após 2min

---

## Sub-Fase 1D: Operational Readiness

**Branch:** `feat/phase1d-operations`
**Depende de:** ✅ 1A concluída (rate limit por tenant usa auth context)

### Implementação

- [ ] Criar `src/infrastructure/health/HealthChecker.ts`
  - [ ] `checkReadiness()` → verifica MongoDB + Redis
  - [ ] Retorna `{ status: 'ready'|'degraded', checks: {...} }`
- [ ] Modificar `src/app.ts`
  - [ ] Manter `GET /api/health` como liveness (rápido)
  - [ ] Adicionar `GET /api/health/ready` como readiness probe
- [ ] Modificar `src/index.ts`
  - [ ] Shutdown sequence completa: servers → workers → tracing → Redis → MongoDB
  - [ ] Safety timeout: `setTimeout(() => process.exit(1), 30000).unref()`
  - [ ] Log de cada etapa do shutdown
- [ ] Modificar `src/infrastructure/database/MongoConnection.ts`
  - [ ] Adicionar `disconnect()` method
  - [ ] Adicionar `ping()` method para health check
- [ ] Modificar `src/api/middlewares/rateLimiter.ts`
  - [ ] Adicionar `tenantRateLimiter` com key generator customizado
  - [ ] Config: 200 req/15min por tenant
  - [ ] Fallback para IP se user não autenticado
- [ ] Modificar `Dockerfile`
  - [ ] Adicionar `USER node` no stage final
  - [ ] Adicionar `STOPSIGNAL SIGTERM`
  - [ ] Adicionar `HEALTHCHECK` instruction

### Testes

- [ ] `HealthChecker.test.ts` — all ok → ready, MongoDB down → degraded, Redis down → degraded
- [ ] Health API (integração) — `/api/health` → 200, `/api/health/ready` com mocks
- [ ] `rateLimiter.test.ts` — tenant rate limit: 429 após exceder, reset após janela
- [ ] Shutdown (integração) — SIGTERM → drain → exit 0

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros
- [ ] `docker build` — image constrói sem erros
- [ ] Manual: `/api/health/ready` com Redis parado → 503
- [ ] Manual: SIGTERM com jobs em andamento → drena antes de sair
- [ ] Manual: Docker container roda como non-root (verificar `whoami`)

---

## Definition of Done (Fase 1 Completa)

- [ ] Todas as 4 sub-fases concluídas e merged na branch principal
- [ ] Todos os testes unitários passam (`npm test`)
- [ ] Coverage ≥ 80% nos arquivos novos (`npm run test:coverage`)
- [ ] Build de produção sem erros (`npm run build`)
- [ ] Docker image roda como non-root e HEALTHCHECK passa
- [ ] Nenhum endpoint administrativo acessível sem auth + role
- [ ] Nenhuma credencial em plain text no MongoDB
- [ ] Webhook duplicado não gera processamento duplo
- [ ] MCP failure não derruba todo o sistema (circuit breaker)
- [ ] Graceful shutdown drena todos os jobs antes de exit
- [ ] Health check readiness retorna 503 quando dependência está down
- [ ] Atualizar `docs/roadmap.md` — marcar itens da Fase 1 como `[x]`
