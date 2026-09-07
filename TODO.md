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
- [ ] Criar `src/services/RunAnalyticsService.ts`
  - [ ] Injetar `IAgentRunRepository`
  - [ ] Método `getRunById(runId: string): Promise<AgentRun | null>`
  - [ ] Método `listRuns(tenantId: string, options: FindRunsOptions): Promise<AgentRun[]>`
  - [ ] Método `getCostAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]>`
  - [ ] Método `getToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]>`
  - [ ] Método `getLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]>`
  - [ ] Tratamento de edge cases (datas inválidas, paginação fora dos limites)

### Testes
- [ ] Criar `src/services/RunAnalyticsService.test.ts`
  - [ ] Testar delegação correta para o repositório
  - [ ] Testar validação e normalização de parâmetros
  - [ ] Testar cenários sem dados e com filtros parciais

### Verificação
- [ ] `npm test` passa com 100% de sucesso
- [ ] Cobertura ≥ 90% no `RunAnalyticsService.ts`

---

## Sub-Fase 3C: REST Controller, Router & Container Wiring

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 3B concluída

### Implementação
- [ ] Criar `src/controllers/AgentRunController.ts`
  - [ ] Injetar `RunAnalyticsService`
  - [ ] Handler `getById(req, res)`
  - [ ] Handler `list(req, res)`
  - [ ] Handler `getCostAnalytics(req, res)`
  - [ ] Handler `getToolAnalytics(req, res)`
  - [ ] Handler `getLLMAnalytics(req, res)`
  - [ ] Validação segura de query parameters e sanitização
- [ ] Criar `src/api/agentRunRouter.ts`
  - [ ] Configurar rotas Express:
    - `GET /api/runs/:runId`
    - `GET /api/runs`
    - `GET /api/runs/analytics/cost`
    - `GET /api/runs/analytics/tools`
    - `GET /api/runs/analytics/llm`
  - [ ] Aplicar middlewares: `authMiddleware`, `tenantRateLimiter`, `requireRole(Role.ADMIN)`, `auditLogger`
- [ ] Modificar `src/config/container.ts`
  - [ ] Instanciar `RunAnalyticsService` com `agentRunRepository`
  - [ ] Instanciar `AgentRunController` com `runAnalyticsService`
- [ ] Modificar `src/app.ts`
  - [ ] Importar `agentRunRouter`
  - [ ] Montar `app.use('/api', agentRunRouter)`

### Testes
- [ ] Criar `src/api/agentRunRouter.test.ts`
  - [ ] Retornar 401 para requisições não autenticadas
  - [ ] Retornar 403 para usuários sem role ADMIN
  - [ ] Retornar 200 e dados para requisições válidas de cada endpoint
  - [ ] Retornar 404 quando o `runId` não for encontrado
  - [ ] Validar query parameters obrigatórios e limites de paginação

### Verificação
- [ ] `npm test` passa sem erros
- [ ] `npm run build` compila sem erros
- [ ] Endpoints testados com sucesso via supertest

---

## Sub-Fase 3D: Documentação, Roadmap & Phase 3 Sign-off

**Branch:** `feature/costs`  
**Responsável:** `backend-specialist` / `project-planner`  
**Depende de:** ✅ 3C concluída

### Implementação
- [ ] Atualizar `docs/api.md` com os endpoints `/api/runs` e exemplos de requests/responses
- [ ] Atualizar `docs/roadmap.md` marcando a Fase 3 como concluída `[x]` e apontando para `phase3-summary.md`
- [ ] Criar `docs/phase3-summary.md` consolidando a entrega da Fase 3
- [ ] Atualizar checklist final no `agent-runs-costs.md`

### Verificação Final (Phase X)
- [ ] `npm test` — 100% dos testes aprovados (todas as suítes)
- [ ] `npm run build` — compilação TypeScript limpa (0 avisos/erros)
- [ ] `npm run test:coverage` — cobertura global mantida e ≥ 80% nos módulos novos
- [ ] Git branch `feature/costs` pronta para PR / merge

---

## Definition of Done (Fase 3 Completa)

- [ ] Todas as sub-fases (3A, 3B, 3C, 3D) marcadas como concluídas
- [ ] `AgentRun` consultável individualmente com todos os seus detalhes (tools, LLMs, tokens, custo, status)
- [ ] Relatórios analíticos de custo por tenant disponíveis via REST API
- [ ] Análise de tempo e taxa de sucesso por MCP/Tool disponível via REST API
- [ ] Análise de volume e custos por modelo LLM disponível via REST API
- [ ] Todos os novos endpoints protegidos por autenticação, rate limiting e RBAC `ADMIN`
- [ ] Suíte de testes automatizados com 100% de aprovação
