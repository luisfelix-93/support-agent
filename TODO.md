# TODO — Fase 3: Agent Runs, Cost & Analytics (Opção B)

> Checklist de implementação organizado por sub-fases para acompanhamento contínuo da Fase 3.  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [agent-runs-costs.md](agent-runs-costs.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 2 Concluída](docs/phase2-summary.md)

---

## Sub-Fase 3A: Domain Ports & Repositório com Aggregations

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist` / `database-architect`

### Implementação
- [x] Atualizar `src/domain/ports/IAgentRunRepository.ts`
  - [x] Adicionar filtros opcionais em `FindRunsOptions`: `status?: AgentRunStatus`, `from?: Date`, `to?: Date`
  - [x] Definir interface `TenantCostSummary`
  - [x] Definir interface `ToolAnalyticsSummary`
  - [x] Definir interface `LLMAnalyticsSummary`
  - [x] Adicionar método `aggregateCostByTenant(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]>`
  - [x] Adicionar método `aggregateToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]>`
  - [x] Adicionar método `aggregateLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]>`
- [x] Atualizar `src/repositories/AgentRunRepository.ts`
  - [x] Adicionar índice composto `{ tenantId: 1, status: 1, startedAt: -1 }` em `createIndexes()`
  - [x] Atualizar `findByTenant()` para aplicar filtros por `status`, `from` e `to`
  - [x] Implementar `aggregateCostByTenant()` com MongoDB Aggregation Pipeline
  - [x] Implementar `aggregateToolAnalytics()` com `$unwind: "$toolCalls"` e `$group`
  - [x] Implementar `aggregateLLMAnalytics()` com `$unwind: "$llmCalls"` e `$group`

### Testes
- [x] Atualizar `src/repositories/AgentRunRepository.test.ts`
  - [x] Testar busca com filtros de status e intervalo de datas
  - [x] Testar pipeline de agregação de custo por tenant
  - [x] Testar pipeline de agregação de analytics de ferramentas
  - [x] Testar pipeline de agregação de analytics de modelos LLM

### Verificação
- [x] `npm test` passa sem regressões (326/326 aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict aprovado)

---

## Sub-Fase 3B: Analytics Service Layer

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 3A concluída

### Implementação
- [x] Criar `src/services/RunAnalyticsService.ts`
  - [x] Injetar `IAgentRunRepository`
  - [x] Método `getRunById(runId: string): Promise<AgentRun | null>`
  - [x] Método `listRuns(tenantId: string, options: FindRunsOptions): Promise<AgentRun[]>`
  - [x] Método `getCostAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]>`
  - [x] Método `getToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]>`
  - [x] Método `getLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]>`
  - [x] Tratamento de edge cases (datas inválidas, paginação fora dos limites)

### Testes
- [x] Criar `src/services/RunAnalyticsService.test.ts`
  - [x] Testar delegação correta para o repositório
  - [x] Testar validação e normalização de parâmetros
  - [x] Testar cenários sem dados e com filtros parciais

### Verificação
- [x] `npm test` passa com 100% de sucesso (345/345 aprovados)
- [x] Cobertura ≥ 90% no `RunAnalyticsService.ts` (100% lines, 95.34% branches)

---

## Sub-Fase 3C: REST Controller, Router & Container Wiring

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 3B concluída

### Implementação
- [x] Criar `src/controllers/AgentRunController.ts`
  - [x] Injetar `RunAnalyticsService`
  - [x] Handler `getById(req, res)`
  - [x] Handler `list(req, res)`
  - [x] Handler `getCostAnalytics(req, res)`
  - [x] Handler `getToolAnalytics(req, res)`
  - [x] Handler `getLLMAnalytics(req, res)`
  - [x] Validação segura de query parameters e sanitização
- [x] Criar `src/api/agentRunRouter.ts`
  - [x] Configurar rotas Express:
    - `GET /api/runs/:runId`
    - `GET /api/runs`
    - `GET /api/runs/analytics/cost`
    - `GET /api/runs/analytics/tools`
    - `GET /api/runs/analytics/llm`
  - [x] Aplicar middlewares: `authMiddleware`, `tenantRateLimiter`, `requireRole(Role.ADMIN)`, `auditLogger`
- [x] Modificar `src/config/container.ts`
  - [x] Instanciar `RunAnalyticsService` com `agentRunRepository`
  - [x] Instanciar `AgentRunController` com `runAnalyticsService`
- [x] Modificar `src/app.ts`
  - [x] Importar `agentRunRouter`
  - [x] Montar `app.use('/api', agentRunRouter)`

### Testes
- [x] Criar `src/api/agentRunRouter.test.ts` e `src/controllers/AgentRunController.test.ts`
  - [x] Retornar 401 para requisições não autenticadas
  - [x] Retornar 403 para usuários sem role ADMIN
  - [x] Retornar 200 e dados para requisições válidas de cada endpoint
  - [x] Retornar 404 quando o `runId` não for encontrado
  - [x] Validar query parameters obrigatórios e limites de paginação

### Verificação
- [x] `npm test` passa sem erros (370/370 aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict aprovado)
- [x] Endpoints testados com sucesso via supertest / fetch integration

---

## Sub-Fase 3D: Documentação, Roadmap & Phase 3 Sign-off

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist` / `project-planner`  
**Depende de:** ✅ 3C concluída

### Implementação
- [x] Atualizar `docs/api.md` com os endpoints `/api/runs` e exemplos de requests/responses
- [x] Atualizar `docs/roadmap.md` marcando a Fase 3 como concluída `[x]` e apontando para `phase3-summary.md`
- [x] Criar `docs/phase3-summary.md` consolidando a entrega da Fase 3
- [x] Atualizar checklist final no `agent-runs-costs.md`
- [x] Atualizar `README.md` com as novas capacidades da Fase 3

### Verificação Final (Phase X)
- [x] `npm test` — 100% dos testes aprovados (58 arquivos, 370 testes)
- [x] `npm run build` — compilação TypeScript limpa (0 avisos/erros)
- [x] `npm run test:coverage` — cobertura global mantida e ≥ 90% nos módulos novos
- [x] Git branch `feature/costs` pronta para PR / merge

---

## Definition of Done (Fase 3 Completa)

- [x] Todas as sub-fases (3A, 3B, 3C, 3D) marcadas como concluídas
- [x] `AgentRun` consultável individualmente com todos os seus detalhes (tools, LLMs, tokens, custo, status)
- [x] Relatórios analíticos de custo por tenant disponíveis via REST API
- [x] Análise de tempo e taxa de sucesso por MCP/Tool disponível via REST API
- [x] Análise de volume e custos por modelo LLM disponível via REST API
- [x] Todos os novos endpoints protegidos por autenticação, rate limiting e RBAC `ADMIN`
- [x] Suíte de testes automatizados com 100% de aprovação (370/370 testes)
