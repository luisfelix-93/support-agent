# TODO — Fase 8: Contabilidade e Gestão de Tokens por Sessão (Session Token Accounting)

> Checklist operacional de implementação organizado por sprints/sub-fases para acompanhamento contínuo da Fase 8 (Opção C).  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [session-token-accounting.md](session-token-accounting.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 7 Concluída](docs/phase7-summary.md)  

---

## Sub-Fase 8A (Sprint 8.1): Associação de Sessão em `AgentRun` & Persistência

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist` / `database-architect`  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar branch dedicada `feature/session-token-accounting` a partir de `dev`
- [x] Atualizar entidade `AgentRun` (`src/domain/AgentRun.ts`):
  - [x] Adicionar propriedade opcional `public sessionId?: string;`
  - [x] Atualizar construtor / factory para aceitar `sessionId?: string`
- [x] Atualizar repositório MongoDB `AgentRunRepository` (`src/repositories/AgentRunRepository.ts`):
  - [x] Atualizar interface `AgentRunDocument` com campo `sessionId?: string`
  - [x] Persistir `sessionId` no método `save()`
  - [x] Mapear `sessionId` no método `toDomain()`
  - [x] Adicionar índice composto `{ workspaceId: 1, sessionId: 1 }`
  - [x] Criar método `findBySessionId(sessionId: string): Promise<AgentRun[]>` na interface `IAgentRunRepository` e na implementação

### Testes
- [x] Atualizar `src/domain/AgentRun.test.ts` com testes unitários para `sessionId`
- [x] Atualizar `src/repositories/AgentRunRepository.test.ts` testando persistência e busca com `findBySessionId`

### Verificação
- [x] `npm test` passa sem regressões (91/91 arquivos, 664/664 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8B (Sprint 8.2): Ledger de Tokens & Contabilidade em `InvestigationSession`

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 8A  
**Status:** ✅ Concluída  

### Implementação
- [x] Atualizar entidade `InvestigationSession` (`src/domain/InvestigationSession.ts`):
  - [x] Adicionar propriedades de contadores à interface `InvestigationSessionProps`:
    - `promptTokens?: number;`
    - `completionTokens?: number;`
    - `totalTokens?: number;`
    - `estimatedCostUsd?: number;`
    - `turnCount?: number;`
  - [x] Inicializar contadores na classe (padrão 0):
    - `public promptTokens: number;`
    - `public completionTokens: number;`
    - `public totalTokens: number;`
    - `public estimatedCostUsd: number;`
    - `public turnCount: number;`
  - [x] Adicionar método `recordTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number }): void`
    - Valida que a sessão não está fechada
    - Incrementa os contadores de tokens e custo acumulado
    - Incrementa `turnCount`
    - Atualiza `lastInteractionAt`
- [x] Atualizar `MongoSessionRepository` (`src/repositories/MongoSessionRepository.ts`):
  - [x] Atualizar `InvestigationSessionDocument` com os novos campos de contadores
  - [x] Mapear campos em `toDocument()` e `toDomain()`

### Testes
- [x] Atualizar `src/domain/InvestigationSession.test.ts`:
  - Testar chamada `recordTokenUsage` acumulando turnos sequenciais
  - Testar bloqueio de registro de tokens em sessões fechadas
  - Testar valores padrão zerados
- [x] Atualizar `src/repositories/MongoSessionRepository.test.ts` validando salvamento e recuperação dos contadores

### Verificação
- [x] `npm test` passa sem regressões (91/91 arquivos, 670/670 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8C (Sprint 8.3): Propagação de Tokens no `AgentHarness` & `ProcessAgentResponseUseCase`

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 8B  
**Status:** ✅ Concluída  

### Implementação
- [x] Atualizar portas e contratos do Harness (`src/domain/ports/IAgentHarness.ts`):
  - [x] Em `AgentRunInput`, adicionar `sessionId?: string`
  - [x] Em `AgentRunResult`, adicionar objeto estruturado de tokens:
    ```typescript
    tokens?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        costUsd: number;
    };
    ```
- [x] Atualizar `AgentHarness` (`src/harness/AgentHarness.ts`):
  - [x] Passar `input.sessionId` para a instância `AgentRun`
  - [x] Preencher `tokens` no retorno de sucesso e de erro com os valores acumulados em `run`
- [x] Atualizar `ProcessAgentResponseUseCase` (`src/usecases/ProcessAgentResponseUseCase.ts`):
  - [x] Passar `sessionId: session?.id` ao invocar `this.harness.run(...)`
  - [x] Após o retorno do harness, se houver `session` ativa e `harnessResult.tokens`, registrar tokens:
    ```typescript
    session.recordTokenUsage({
        promptTokens: harnessResult.tokens.inputTokens,
        completionTokens: harnessResult.tokens.outputTokens,
        totalTokens: harnessResult.tokens.totalTokens,
        costUsd: harnessResult.tokens.costUsd,
    });
    ```
  - [x] Garantir que a persistência `this.sessionRepository.save(session)` ocorra com os contadores atualizados

### Testes
- [x] Atualizar `src/harness/AgentHarness.test.ts` testando retorno de `tokens` e atribuição de `sessionId`
- [x] Atualizar `src/usecases/ProcessAgentResponseUseCase.test.ts`:
  - Testar que os tokens retornados pelo harness são acumulados na sessão ativa
  - Testar que a sessão é salva com os tokens atualizados

### Verificação
- [x] `npm test` passa sem regressões (91/91 arquivos, 672/672 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8D (Sprint 8.4): Exposição de Tokens por Sessão na API & Métricas Prometheus

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 8C  
**Status:** ✅ Concluída  

### Implementação
- [x] Atualizar `RunAnalyticsService` (`src/services/RunAnalyticsService.ts`):
  - [x] Injetar `ISessionRepository` no construtor
  - [x] Implementar método `listRunsBySession(sessionId: string): Promise<AgentRun[]>`
  - [x] Implementar método `getSessionAccounting(sessionId: string): Promise<SessionAccountingSummary | null>`
- [x] Atualizar `AgentRunController` (`src/controllers/AgentRunController.ts`):
  - [x] Suportar query param opcional `sessionId` no método `list()`
  - [x] Implementar método `getSessionAccounting(req, res)`
- [x] Atualizar rotas em `agentRunRouter` (`src/api/agentRunRouter.ts`):
  - [x] Adicionar rota `GET /api/runs/session/:sessionId` protegida com `authMiddleware`, `tenantRateLimiter`, `requireRole(ADMIN)` e `auditLogger`
- [x] Atualizar injeção de dependência em `src/config/container.ts`:
  - [x] Passar `sessionRepository` ao instanciar `runAnalyticsService`
- [x] Atualizar métricas do Prometheus (`src/infrastructure/metrics/AgentMetrics.ts`):
  - [x] Criar `agentSessionTokensTotal`: Counter (labels: `workspaceId`, `status`, `tokenType`)
  - [x] Criar `agentSessionCostUsdTotal`: Counter (labels: `workspaceId`, `status`)
  - [x] Criar helper `recordSessionClosureMetrics`
- [x] Atualizar encerramento de sessão em `ProcessAgentResponseUseCase` e `SessionTimeoutSweeper`:
  - [x] Registrar tokens acumulados e custo estimado nas métricas Prometheus ao fechar a sessão (por operador ou por timeout)
  - [x] Manter o `SessionSummary` limpo no chat, sem adicionar blocos de custo/tokens

### Testes
- [x] Atualizar `src/services/RunAnalyticsService.test.ts` cobrindo `listRunsBySession` e `getSessionAccounting`
- [x] Atualizar `src/controllers/AgentRunController.test.ts` cobrindo o filtro `sessionId` e `getSessionAccounting`
- [x] Atualizar `src/api/agentRunRouter.test.ts` testando o endpoint `GET /api/runs/session/:sessionId`
- [x] Atualizar `src/services/SessionTimeoutSweeper.test.ts` validando emissão de métricas de tokens no encerramento por timeout
- [x] Atualizar `src/usecases/ProcessAgentResponseUseCase.test.ts` validando emissão de métricas de tokens no encerramento pelo usuário

### Verificação
- [x] `npm test` passa sem regressões (91/91 arquivos, 689/689 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8E (Sprint 8.5): Testes de Integração E2E, Validação & Documentação

**Branch:** `feature/session-token-accounting`  
**Responsável:** `qa-engineer` / `backend-specialist`  
**Depende de:** Sub-Fases 8A a 8D concluídas  
**Status:** ✅ Concluída  

### Implementação & Testes
- [x] Atualizar `src/harness/HybridSessionLifecycle.integration.test.ts`:
  - [x] Simular múltiplos turnos na sessão com consumo cumulativo de tokens
  - [x] Verificar que cada `AgentRun` no repositório aponta para o `sessionId` correspondente
  - [x] Validar que a consulta de contabilidade por sessão retorna os totais acumulados com precisão
- [x] Executar suíte completa de testes e validação estática:
  - [x] `npm test` (91 arquivos, 690 testes aprovados)
  - [x] `npm run test:integration` (10 arquivos, 19 testes aprovados)
  - [x] `npm run build` (0 erros TypeScript strict)
- [x] Atualizar documentação de APIs em `docs/API_FRONTEND.md`:
  - [x] Documentar o query param `sessionId` em `GET /api/runs`
  - [x] Documentar o novo endpoint `GET /api/runs/session/:sessionId`
- [x] Criar documento de consolidação da fase: [docs/phase8-summary.md](docs/phase8-summary.md)

---

## Definition of Done (Fase 8 Completa)

- [x] Todas as sub-fases (8A a 8E) concluídas e testadas
- [x] `AgentRun` vinculado ao `sessionId` de forma auditável
- [x] `InvestigationSession` com ledger cumulativo de tokens em tempo real ($O(1)$)
- [x] Métricas de tokens e custo integradas ao Prometheus
- [x] Suíte de testes com 100% de aprovação e sem regressões

---

## Histórico de Fases Anteriores Concluídas

<details>
<summary><b>Fase 7: Ciclo de Vida Híbrido de Sessão de Investigação — Concluída ✅</b></summary>

- [x] Sub-Fase 7A: Fundação de Domínio (`InvestigationSession` & `SessionStatus`)
- [x] Sub-Fase 7B: Repositório & Persistência MongoDB (`MongoSessionRepository`)
- [x] Sub-Fase 7C: Detecção Semântica & Encerramento Conversacional (`ClosureIntentDetector`)
- [x] Sub-Fase 7D: Sweeper de Inatividade & Background Worker (`SessionTimeoutSweeper`)
- [x] Sub-Fase 7E: Integração E2E, Métricas Prometheus & Documentação
- [x] 100% de testes aprovados (91 arquivos unitários, 629 testes / 10 arquivos de integração, 40 testes)
- [x] Documento consolidado: [docs/phase7-summary.md](docs/phase7-summary.md)
</details>

<details>
<summary><b>Fase 6: Multi-MCP Platform & Governança de Ferramentas — Concluída ✅</b></summary>

- [x] Sub-Fase 6A: Core Composite MCP Client & Namespacing
- [x] Sub-Fase 6B: Configuração Multi-Tenant & Persistência Criptografada
- [x] Sub-Fase 6C: Tool Governance & Política de Risco
- [x] Sub-Fase 6D: Tool Discovery Contextual, Integração E2E & Documentação
- [x] 100% de testes aprovados (82 arquivos, 528 testes)
- [x] Documento consolidado: [docs/phase6-summary.md](docs/phase6-summary.md)
</details>

<details>
<summary><b>Fase 5: Memory 2.0 (Recuperação Híbrida & Ciclo de Vida) — Concluída ✅</b></summary>

- [x] Sub-Fase 5A: Setup da Branch & Fundação de Domínio (Contratos e Entidades Core)
- [x] Sub-Fase 5B: Motor de Recuperação Híbrida & Algoritmo RRF (Reciprocal Rank Fusion)
- [x] Sub-Fase 5C: Contextual Reranker Service & Integração com o Harness
- [x] Sub-Fase 5D: API REST de Governança de Memória (`/api/memories`)
- [x] Sub-Fase 5E: Teste de Integração E2E, Cobertura, Documentação & Fechamento
- [x] 100% de testes aprovados (78 arquivos, 471 testes)
- [x] Documento consolidado: [docs/phase5-summary.md](docs/phase5-summary.md)
</details>
