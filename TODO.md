# TODO — Fase 2: Agent Evaluation

> Checklist de implementação organizado por sub-fase.
> Marque `[x]` conforme cada item for concluído.
> Referência: [agent-evaluation.md](docs/agent-evaluation.md)

---

## Sub-Fase 2A: Passive Metrics & Run Persistence

**Branch:** `feature/agent-evaluation`

### Implementação

- [x] Modificar `src/domain/ports/ILLMProvider.ts` — Adicionar `LLMUsage` ao `LLMResponse`
  - [x] Interface `LLMUsage { inputTokens, outputTokens, totalTokens }`
  - [x] Campo opcional `usage?: LLMUsage` em ambos os tipos de resposta
- [x] Modificar `src/infrastructure/llm/OpenAIAdapter.ts` — Extrair `response.usage`
  - [x] Mapear `prompt_tokens`, `completion_tokens`, `total_tokens`
  - [x] Incluir `usage` no retorno de `generateResponse()`
- [x] Modificar `src/infrastructure/llm/GeminiAdapter.ts` — Extrair `response.usageMetadata`
  - [x] Mapear `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`
- [x] Modificar `src/infrastructure/llm/AnthropicAdapter.ts` — Extrair `response.usage`
  - [x] Mapear `input_tokens`, `output_tokens`
- [x] Criar `src/domain/LLMCallRecord.ts` — Modelo de chamada LLM individual
  - [x] Campos: provider, model, inputTokens, outputTokens, latencyMs, resultType, costUsd
- [x] Criar `src/domain/pricing/LLMPricingTable.ts` — Tabela de preços por modelo
  - [x] Preços para gpt-4o, gpt-4o-mini, gemini-2.0-flash, claude-3-5-sonnet, deepseek-chat
  - [x] Função `calculateCost(model, inputTokens, outputTokens): number`
- [x] Modificar `src/domain/AgentRun.ts` — Enriquecer com métricas
  - [x] Adicionar `llmCalls: LLMCallRecord[]`
  - [x] Adicionar `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `costUsd`
  - [x] Adicionar `memoriesInjected`, `contextUtilization`
  - [x] Adicionar `agentVersion`, `finalResponse`, `userMessage`
  - [x] Método `recordLLMCall(record)` e `computeTotals()`
- [x] Criar `src/domain/ports/IAgentRunRepository.ts` — Interface de persistência
  - [x] `save(run)`, `findByRunId(runId)`, `findByTenant(tenantId, options)`
- [x] Criar `src/repositories/AgentRunRepository.ts` — Implementação MongoDB
  - [x] Collection `agent_runs`
  - [x] Indexes: `{ tenantId: 1, startedAt: -1 }`, `{ runId: 1 }` (unique)
- [x] Modificar `src/harness/AgentHarness.ts`
  - [x] Acumular `LLMCallRecord` a cada `generateLlmWithTimeout()`
  - [x] Registrar `memoriesInjected` e `contextUtilization`
  - [x] Guardar `finalResponse` e `userMessage` no AgentRun
  - [x] Persistir AgentRun via `IAgentRunRepository`
  - [x] Disparar job de self-evaluation via `IQueueService.dispatchEvaluation()`
- [x] Modificar `src/domain/ports/IQueueService.ts` — Adicionar `dispatchEvaluation()`
- [x] Modificar `src/infrastructure/queue/BullMQAdapter.ts` — Implementar `dispatchEvaluation()`
  - [x] Criar queue `agent-evaluation`
- [x] Modificar `src/config/container.ts`
  - [x] Instanciar `AgentRunRepository`
  - [x] Injetar no `AgentHarness`
- [x] Criar `src/infrastructure/metrics/EvaluationMetrics.ts`
  - [x] `agent_llm_tokens_total { tenantId, provider, model, direction }`
  - [x] `agent_run_cost_usd { tenantId, provider, model }`
  - [x] `agent_context_utilization { tenantId }`

### Testes

- [x] `OpenAIAdapter.test.ts` — Retorna `usage` quando presente, `undefined` quando ausente
- [x] `GeminiAdapter.test.ts` — Retorna `usage` de `usageMetadata`
- [x] `AnthropicAdapter.test.ts` — Retorna `usage` de `response.usage`
- [x] `AgentRun.test.ts` — `recordLLMCall()`, `computeTotals()` soma tokens/cost
- [x] `LLMPricingTable.test.ts` — Cálculo correto, modelo desconhecido → 0
- [x] `AgentRunRepository.test.ts` — Save, findByRunId, findByTenant
- [x] `AgentHarness.test.ts` — LLM calls registrados, run persistido, eval dispatched

### Verificação

- [x] `npm test` — todos os testes passam (271/271)
- [x] `npm run build` — build sem erros
- [x] Verificar no MongoDB que `agent_runs` recebe documentos com token counts

---

## Sub-Fase 2B: Self-Evaluation Worker

**Branch:** `feat/phase2b-self-evaluation`
**Depende de:** ✅ 2A concluída

### Implementação

- [ ] Criar `src/domain/EvaluationResult.ts` — Modelo do resultado
  - [ ] `SelfEvalScores { confidence, hallucinationRisk, contextRelevance, completeness, toolSelectionQuality }`
  - [ ] `PassiveMetrics { durationMs, iterations, toolCallsTotal, toolCallsFailed, toolSuccessRate, ... }`
  - [ ] `EvaluationResult { runId, tenantId, passive, selfEval, compositeScore, evaluatedAt }`
- [ ] Criar `src/domain/ports/IEvaluationRepository.ts` — Interface de persistência
  - [ ] `save(result)`, `findByRunId(runId)`, `findByTenant(tenantId, options)`
- [ ] Criar `src/repositories/EvaluationRepository.ts` — Implementação MongoDB
  - [ ] Collection `evaluation_results`
  - [ ] Indexes: `{ runId: 1 }` (unique), `{ tenantId: 1, evaluatedAt: -1 }`, `{ agentVersion: 1 }`
- [ ] Criar `src/evaluation/SelfEvaluationPrompt.ts` — Prompt de auto-avaliação
  - [ ] Recebe userMessage, toolCalls, finalResponse, memoriesUsed
  - [ ] Retorna prompt instruindo LLM a devolver JSON com 5 scores (0-1)
  - [ ] Inclui few-shot examples para calibração
- [ ] Criar `src/evaluation/ScoreCalculator.ts` — Cálculo do composite score
  - [ ] Pesos: confidence (0.20), hallucinationRisk invertido (0.25), completeness (0.20), toolSelectionQuality (0.15), contextRelevance (0.10), performance (0.10)
  - [ ] Função `calculateCompositeScore(passive, selfEval): number`
- [ ] Criar `src/infrastructure/queue/EvaluationWorker.ts` — Worker BullMQ
  - [ ] Queue: `agent-evaluation`
  - [ ] Busca config do tenant → cria LLM provider
  - [ ] Chama LLM com prompt de self-evaluation
  - [ ] Parse JSON com retry (1x) se malformado
  - [ ] Calcula composite score
  - [ ] Persiste `EvaluationResult` no MongoDB
- [ ] Modificar `src/config/container.ts`
  - [ ] Instanciar `EvaluationRepository`
  - [ ] Instanciar `EvaluationWorker`
  - [ ] Registrar start do worker
- [ ] Modificar `src/index.ts` — Adicionar `evaluationWorker.stop()` no graceful shutdown

### Testes

- [ ] `SelfEvaluationPrompt.test.ts` — Prompt gerado corretamente, escapa caracteres especiais
- [ ] `ScoreCalculator.test.ts` — Pesos corretos, normalização, edge cases (todos 0, todos 1)
- [ ] `EvaluationRepository.test.ts` — Save, findByRunId, findByTenant com filtros
- [ ] `EvaluationWorker.test.ts` — Processa job, persiste resultado, retry JSON malformado, skip tenant inativo

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros
- [ ] Verificar no MongoDB que `evaluation_results` recebe documentos com composite score
- [ ] Verificar que resposta ao usuário NÃO é atrasada pela avaliação

---

## Sub-Fase 2C: Aggregation & Version Comparison

**Branch:** `feat/phase2c-aggregation`
**Depende de:** ✅ 2A + 2B concluídas

### Implementação

- [ ] Criar `src/evaluation/types.ts` — Types de agregação
  - [ ] `VersionStats`, `ComparisonResult`, `RegressionReport`, `TenantEvalSummary`
- [ ] Criar `src/evaluation/AggregationService.ts` — Serviço de agregação
  - [ ] `getVersionStats(version)` — média de scores por versão
  - [ ] `compareVersions(versionA, versionB)` — deltas e regressões
  - [ ] `getTenantSummary(tenantId, from, to)` — resumo por tenant
  - [ ] `detectRegression(currentVersion, previousVersion)` — threshold > 10%
- [ ] Modificar `src/domain/ports/IEvaluationRepository.ts`
  - [ ] Adicionar `aggregateByVersion(version)`
  - [ ] Adicionar `aggregateByTenant(tenantId, from, to)`
- [ ] Modificar `src/repositories/EvaluationRepository.ts`
  - [ ] Implementar MongoDB aggregation pipelines

### Testes

- [ ] `AggregationService.test.ts` — Médias corretas, regressão detectada, sem dados → vazio
- [ ] `EvaluationRepository.test.ts` — Aggregation pipelines retornam formatos esperados

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros

---

## Sub-Fase 2D: Evaluation API & Observability

**Branch:** `feat/phase2d-evaluation-api`
**Depende de:** ✅ 2C concluída

### Implementação

- [ ] Criar `src/api/evaluationRouter.ts` — Endpoints REST
  - [ ] `GET /api/evaluations/:runId` — resultado por runId
  - [ ] `GET /api/evaluations?tenantId=X` — lista por tenant (paginado)
  - [ ] `GET /api/evaluations/stats/:version` — stats agregados
  - [ ] `GET /api/evaluations/compare?versionA=X&versionB=Y` — comparação
  - [ ] `GET /api/evaluations/regression` — detecção de regressão
  - [ ] Todos com `authMiddleware` + `requireRole(ADMIN)`
- [ ] Modificar `src/app.ts` — Registrar `evaluationRouter`
- [ ] Modificar `src/infrastructure/metrics/EvaluationMetrics.ts` — Adicionar gauges
  - [ ] `agent_evaluation_composite_score { tenantId, version }`
  - [ ] `agent_evaluation_confidence_avg { tenantId, version }`
  - [ ] `agent_evaluation_hallucination_avg { tenantId, version }`
  - [ ] `agent_evaluation_runs_evaluated { tenantId, version }`
- [ ] Modificar `src/config/container.ts` — Instanciar controller e AggregationService

### Testes

- [ ] `evaluationRouter.test.ts` — 401 sem auth, 403 sem ADMIN, 200 com dados, 404 não encontrado

### Verificação

- [ ] `npm test` — todos os testes passam
- [ ] `npm run build` — build sem erros
- [ ] `npm run test:coverage` — cobertura ≥ 80% nos arquivos novos
- [ ] Endpoints retornam dados corretos via Postman/curl

---

## Definition of Done (Fase 2 Completa)

- [ ] Todas as 4 sub-fases concluídas (2A, 2B, 2C, 2D)
- [ ] Todos os testes unitários passam (`npm test`)
- [ ] Coverage ≥ 80% nos arquivos novos (`npm run test:coverage`)
- [ ] Build de produção sem erros (`npm run build`)
- [ ] Cada `AgentHarness.run()` persiste AgentRun com token counts no MongoDB
- [ ] Cost per run calculado para todos os 4 providers (OpenAI, Gemini, Anthropic, DeepSeek)
- [ ] Self-evaluation roda em background sem impactar latência
- [ ] EvaluationResult com composite score persistido para cada run
- [ ] API de comparação responde "versão X é melhor que Y?" com dados
- [ ] Regression detection identifica queda > 10% no composite score
- [ ] Métricas de avaliação expostas no Prometheus
- [ ] Atualizar `docs/roadmap.md` — marcar itens da Fase 2 como `[x]`
