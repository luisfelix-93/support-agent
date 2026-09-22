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
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar entidade `InvestigationSession` (`src/domain/InvestigationSession.ts`):
  - [ ] Adicionar propriedades de contadores à interface `InvestigationSessionProps`:
    - `promptTokens?: number;`
    - `completionTokens?: number;`
    - `totalTokens?: number;`
    - `estimatedCostUsd?: number;`
    - `turnCount?: number;`
  - [ ] Inicializar contadores na classe (padrão 0):
    - `public promptTokens: number;`
    - `public completionTokens: number;`
    - `public totalTokens: number;`
    - `public estimatedCostUsd: number;`
    - `public turnCount: number;`
  - [ ] Adicionar método `recordTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number }): void`
    - Valida que a sessão não está fechada
    - Incrementa os contadores de tokens e custo acumulado
    - Incrementa `turnCount`
    - Atualiza `lastInteractionAt`
- [ ] Atualizar `MongoSessionRepository` (`src/repositories/MongoSessionRepository.ts`):
  - [ ] Atualizar `InvestigationSessionDocument` com os novos campos de contadores
  - [ ] Mapear campos em `toDocument()` e `toDomain()`

### Testes
- [ ] Atualizar `src/domain/InvestigationSession.test.ts`:
  - Testar chamada `recordTokenUsage` acumulando turnos sequenciais
  - Testar bloqueio de registro de tokens em sessões fechadas
  - Testar valores padrão zerados
- [ ] Atualizar `src/repositories/MongoSessionRepository.test.ts` validando salvamento e recuperação dos contadores

### Verificação
- [ ] `npm test` passa sem regressões
- [ ] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8C (Sprint 8.3): Propagação de Tokens no `AgentHarness` & `ProcessAgentResponseUseCase`

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 8B  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar portas e contratos do Harness (`src/domain/ports/IAgentHarness.ts`):
  - [ ] Em `AgentRunInput`, adicionar `sessionId?: string`
  - [ ] Em `AgentRunResult`, adicionar objeto estruturado de tokens:
    ```typescript
    tokens?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        costUsd: number;
    };
    ```
- [ ] Atualizar `AgentHarness` (`src/harness/AgentHarness.ts`):
  - [ ] Passar `input.sessionId` para a instância `AgentRun`
  - [ ] Preencher `tokens` no retorno de sucesso e de erro com os valores acumulados em `run`
- [ ] Atualizar `ProcessAgentResponseUseCase` (`src/usecases/ProcessAgentResponseUseCase.ts`):
  - [ ] Passar `sessionId: session?.id` ao invocar `this.harness.run(...)`
  - [ ] Após o retorno do harness, se houver `session` ativa e `harnessResult.tokens`, registrar tokens:
    ```typescript
    session.recordTokenUsage({
        promptTokens: harnessResult.tokens.inputTokens,
        completionTokens: harnessResult.tokens.outputTokens,
        totalTokens: harnessResult.tokens.totalTokens,
        costUsd: harnessResult.tokens.costUsd,
    });
    ```
  - [ ] Garantir que a persistência `this.sessionRepository.save(session)` ocorra com os contadores atualizados

### Testes
- [ ] Atualizar `src/harness/AgentHarness.test.ts` testando retorno de `tokens` e atribuição de `sessionId`
- [ ] Atualizar `src/usecases/ProcessAgentResponseUseCase.test.ts`:
  - Testar que os tokens retornados pelo harness são acumulados na sessão ativa
  - Testar que a sessão é salva com os tokens atualizados

### Verificação
- [ ] `npm test` passa sem regressões
- [ ] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8D (Sprint 8.4): Enriquecimento do `SessionSummary` & Métricas Prometheus

**Branch:** `feature/session-token-accounting`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 8C  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar `SessionSummary` (`src/domain/workflows/SessionSummary.ts`):
  - [ ] Adicionar campos opcionais `totalTokens?: number` e `estimatedCostUsd?: number`
  - [ ] Atualizar `toMarkdown()` para incluir seção visual `### 💰 Consumo de Recursos & Investimento` com tokens e custo aproximado em USD
- [ ] Atualizar métricas do Prometheus (`src/infrastructure/metrics/AgentMetrics.ts`):
  - [ ] Criar `agentSessionTokensTotal`: Counter (labels: `workspaceId`, `status`, `tokenType`)
  - [ ] Criar `agentSessionCostUsdTotal`: Counter (labels: `workspaceId`, `status`)
- [ ] Atualizar encerramento de sessão em `ProcessAgentResponseUseCase` e `SessionTimeoutSweeper`:
  - [ ] Ao encerrar sessão (por usuário ou por timeout), registrar os tokens e custo nas métricas Prometheus
  - [ ] Injetar os contadores de tokens da sessão no `SessionSummary` gerado

### Testes
- [ ] Atualizar `src/domain/workflows/SessionSummary.test.ts` validando formatação de tokens e custo no markdown
- [ ] Atualizar `src/services/SessionTimeoutSweeper.test.ts` validando emissão de métricas e preservação de tokens no encerramento por timeout
- [ ] Atualizar `src/usecases/ProcessAgentResponseUseCase.test.ts` validando emissão de métricas no fechamento pelo usuário

### Verificação
- [ ] `npm test` passa sem regressões
- [ ] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 8E (Sprint 8.5): Testes de Integração E2E, Validação & Documentação

**Branch:** `feature/session-token-accounting`  
**Responsável:** `qa-engineer` / `backend-specialist`  
**Depende de:** Sub-Fases 8A a 8D concluídas  
**Status:** ⏳ Pendente  

### Implementação & Testes
- [ ] Atualizar `src/harness/HybridSessionLifecycle.integration.test.ts`:
  - [ ] Simular múltiplos turnos na sessão com consumo cumulativo de tokens
  - [ ] Verificar que cada `AgentRun` no repositório aponta para o `sessionId` correspondente
  - [ ] Validar que ao fechar a sessão, o `SessionSummary` final contém os totais consolidados de tokens e custo
- [ ] Executar suíte completa de testes e validação estática:
  - [ ] `npm test`
  - [ ] `npm run test:integration`
  - [ ] `npm run build`
- [ ] Criar documento de consolidação da fase: `docs/phase8-summary.md`
- [ ] Atualizar documentação de arquitetura e APIs (`docs/API_FRONTEND.md` se aplicável)

---

## Definition of Done (Fase 8 Completa)

- [ ] Todas as sub-fases (8A a 8E) concluídas e testadas
- [ ] `AgentRun` vinculado ao `sessionId` de forma auditável
- [ ] `InvestigationSession` com ledger cumulativo de tokens em tempo real ($O(1)$)
- [ ] Resumo executivo (`SessionSummary`) exibindo custos e tokens de forma transparente
- [ ] Métricas de tokens e custo integradas ao Prometheus
- [ ] Suíte de testes com 100% de aprovação e sem regressões

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
