# TODO — Fase 7: Ciclo de Vida Híbrido de Sessão de Investigação (Session Lifecycle)

> Checklist operacional de implementação organizado por sprints/sub-fases para acompanhamento contínuo da Fase 7.  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [session-lifecycle.md](session-lifecycle.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 6 Concluída](docs/phase6-summary.md)  

---

## Sub-Fase 7A (Sprint 7.1): Core Domain & Entidade `InvestigationSession`

**Branch:** `feature/session-lifecycle`  
**Responsável:** `backend-specialist`  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar branch dedicada `feature/session-lifecycle`
- [x] Definir enum de status em `src/domain/SessionStatus.ts`:
  - [x] `ACTIVE`, `AWAITING_CLOSURE_CONFIRMATION`, `CLOSED_BY_USER`, `CLOSED_BY_TIMEOUT`
- [x] Criar entidade de domínio `InvestigationSession` em `src/domain/InvestigationSession.ts`:
  - [x] Campos: `id`, `workspaceId`, `threadId`, `channelId`, `status`, `startedAt`, `lastInteractionAt`, `closedAt`, `idleTimeoutMs`, `evidenceLedger`, `sessionSummary`, `metadata`
  - [x] Método `touch()`: atualiza `lastInteractionAt` e valida que a sessão está ativa
  - [x] Método `proposeClosure()`: transita `ACTIVE` -> `AWAITING_CLOSURE_CONFIRMATION`
  - [x] Método `confirmClosure(summary?: SessionSummary)`: transita para `CLOSED_BY_USER` e define `closedAt`
  - [x] Método `cancelClosureProposal()`: reverte de `AWAITING_CLOSURE_CONFIRMATION` de volta para `ACTIVE`
  - [x] Método `expireByTimeout(summary?: SessionSummary)`: transita para `CLOSED_BY_TIMEOUT` e define `closedAt`
  - [x] Método `isExpired(referenceDate?: Date)`: cálculo defensivo de `(referenceDate - lastInteractionAt) >= idleTimeoutMs`

### Testes
- [x] Criar `src/domain/InvestigationSession.test.ts`:
  - [x] Testar instanciação com valores padrão (timeout padrão de 1 hora = 3.600.000 ms)
  - [x] Testar ciclo completo de transições de estado válidas
  - [x] Testar bloqueio de transições inválidas (ex: tentar reativar sessão fechada)
  - [x] Testar verificação de expiração por inatividade com datas mockadas
  - [x] Testar atualização de timestamps ao executar `touch()`

### Verificação
- [x] `npm test` passa sem regressões (86/86 arquivos, 556/556 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict


---

## Sub-Fase 7B (Sprint 7.2): Persistência MongoDB & `ISessionRepository`

**Branch:** `feature/session-lifecycle`  
**Responsável:** `database-architect` / `backend-specialist`  
**Depende de:** ✅ Sub-Fase 7A concluída  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar contrato em `src/domain/ports/ISessionRepository.ts`:
  - [x] `save(session: InvestigationSession): Promise<void>`
  - [x] `findById(id: string): Promise<InvestigationSession | null>`
  - [x] `findActiveByThreadId(threadId: string, workspaceId: string): Promise<InvestigationSession | null>`
  - [x] `findInactiveSessions(cutoffDate: Date, limit?: number): Promise<InvestigationSession[]>`
- [x] Implementar repositório `MongoSessionRepository` em `src/repositories/MongoSessionRepository.ts`:
  - [x] Collection `investigation_sessions`
  - [x] Mapeamento bidirecional entre documentos MongoDB e a entidade `InvestigationSession`
  - [x] Serialização e deserialização do `EvidenceLedger` e `SessionSummary`
  - [x] Criação de índices: `{ id: 1 }` (único), `{ workspaceId: 1, threadId: 1, status: 1 }` e `{ status: 1, lastInteractionAt: 1 }`

### Testes
- [x] Criar `src/repositories/MongoSessionRepository.test.ts` (8 testes unitários):
  - [x] Testar criação e atualização de sessão com upsert
  - [x] Testar busca de sessão ativa por `threadId` e isolamento multi-workspace
  - [x] Testar consulta `findInactiveSessions` filtrando sessões ativas com `lastInteractionAt <= cutoffDate`
  - [x] Testar hidratação correta de `EvidenceLedger` e `SessionSummary`

### Verificação
- [x] `npm test` passa sem falhas (87/87 arquivos, 564/564 testes aprovados)
- [x] `npm run build` compila limpo (TypeScript strict 0 erros)


---

## Sub-Fase 7C (Sprint 7.3): Detecção Conversacional & Proposta Ativa de Encerramento

**Branch:** `feature/phase-7-session-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 7B  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Criar serviço `src/services/ClosureIntentDetector.ts`:
  - [ ] Detecção de respostas afirmativas ("sim", "pode encerrar", "fechar", "resolvido", "concluído")
  - [ ] Detecção de respostas de continuação ("não", "quero ver mais", "ainda não", perguntas adicionais)
  - [ ] Reconhecimento de comando explícito (`/encerrar`, `/close`, `/finalizar`)
- [ ] Integrar fluxo no `InvestigationEngine` ou `ProcessAgentResponseUseCase`:
  - [ ] Proposta de encerramento ao entregar hipótese de causa raiz/ações recomendadas
  - [ ] Tratamento quando a sessão está em `AWAITING_CLOSURE_CONFIRMATION`
  - [ ] Emissão do `SessionSummary` formatado ao confirmar o fechamento
  - [ ] Associação da `InvestigationSession` durante a execução da mensagem

### Testes
- [ ] Criar `src/services/ClosureIntentDetector.test.ts`:
  - [ ] Testar detecção de confirmações explícitas e comandos
  - [ ] Testar detecção de continuação da investigação
  - [ ] Testar neutralidade diante de mensagens genéricas
- [ ] Atualizar `src/usecases/ProcessAgentResponseUseCase.test.ts`:
  - [ ] Testar transição de sessão com confirmação pelo usuário
  - [ ] Testar continuidade da investigação quando o usuário rejeita o encerramento

### Verificação
- [ ] `npm test` passa com 100% de sucesso
- [ ] `npm run build` compila sem erros

---

## Sub-Fase 7D (Sprint 7.4): Sweeper de Inatividade & Background Job

**Branch:** `feature/phase-7-session-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 7C  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Criar serviço `src/services/SessionTimeoutSweeper.ts`:
  - [ ] Método `sweepExpiredSessions(referenceDate?: Date): Promise<SweepResult>`
  - [ ] Para cada sessão inativa:
    - [ ] Transitar para `CLOSED_BY_TIMEOUT`
    - [ ] Compilar `SessionSummary` a partir das evidências do `EvidenceLedger`
    - [ ] Persistir atualização no repositório
    - [ ] Enviar notificação de encerramento na thread via `IChatProvider`
- [ ] Criar agendamento periódico ou job BullMQ:
  - [ ] Configurar timer/worker defensivo em `src/infrastructure/queue/SessionTimeoutWorker.ts`
  - [ ] Tratar tolerância a falhas (uma falha de envio não trava o lote)

### Testes
- [ ] Criar `src/services/SessionTimeoutSweeper.test.ts`:
  - [ ] Testar identificação e encerramento em lote de sessões inativas
  - [ ] Testar envio de mensagem de encerramento com `SessionSummary`
  - [ ] Testar tolerância caso o envio ao chat falhe
- [ ] Criar `src/infrastructure/queue/SessionTimeoutWorker.test.ts`

### Verificação
- [ ] `npm test` passa sem erros
- [ ] `npm run build` compila limpo

---

## Sub-Fase 7E (Sprint 7.5): Integração E2E, Métricas & Fechamento de Fase

**Branch:** `feature/phase-7-session-lifecycle`  
**Responsável:** `qa-automation-engineer` / `project-planner`  
**Depende de:** Sub-Fase 7D  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Criar teste de integração E2E em `src/harness/HybridSessionLifecycle.integration.test.ts`:
  - [ ] Cenário 1: Fechamento Conversacional Ativo (Início -> Investigação -> Proposta -> Confirmação -> SessionSummary -> Fechado)
  - [ ] Cenário 2: Fechamento por Inatividade (Início -> Investigação -> Abandono de 1h -> Sweeper -> SessionSummary -> Fechado)
- [ ] Adicionar métricas Prometheus em `src/infrastructure/metrics/AgentMetrics.ts`:
  - [ ] `agent_sessions_total` (contador)
  - [ ] `agent_sessions_closed_total` (labels: `reason="user|timeout"`)
  - [ ] `agent_session_duration_seconds` (histograma)
- [ ] Atualizar documentações:
  - [ ] Atualizar `docs/roadmap.md` adicionando a Fase 7 detalhada
  - [ ] Atualizar `architecture.md` com a máquina de estados do ciclo de vida da sessão
  - [ ] Criar `docs/phase7-summary.md`

### Verificação Final
- [ ] `npm test` — 100% dos testes aprovados
- [ ] `npm run test:integration` — 100% dos testes de integração passando
- [ ] `npm run build` — 0 erros de compilação TypeScript strict

---

## Definition of Done (Fase 7 Completa)

- [ ] Todas as sub-fases (7A a 7E) concluídas e testadas
- [ ] Máquina de estados de `InvestigationSession` robusta com isolamento multi-tenant
- [ ] Fechamento ativo conversacional funcionando fluidamente no chat
- [ ] Sweeper de inatividade encerrando sessões órfãs após 1 hora de inatividade
- [ ] `SessionSummary` gerado e entregue confiavelmente em ambos os caminhos de fechamento
- [ ] Métricas de sessões integradas ao Prometheus
- [ ] Suíte de testes automatizados com 100% de aprovação e sem regressões

---

## Histórico de Fases Anteriores Concluídas

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
