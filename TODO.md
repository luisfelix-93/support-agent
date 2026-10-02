# TODO — Fase 9: Otimização de Iterações e Resiliência Anti-Loop do AgentHarness (Opção A)

> Checklist operacional de implementação para acompanhamento contínuo da Fase 9 (Opção A: Limite Dinâmico & Trava Anti-Loop).  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [docs/harness-iterations.md](docs/harness-iterations.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 8 Concluída](docs/phase8-summary.md)  

---

## Sub-Fase 9A: Parametrização e Política de Execução (`ExecutionPolicy`)

**Branch:** `feature/harness-loop-optimization`  
**Responsável:** `backend-specialist`  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar branch dedicada `feature/harness-loop-optimization` a partir de `dev`
- [x] Atualizar interface `ExecutionPolicyConfig` (`src/harness/ExecutionPolicy.ts`):
  - [x] Adicionar `maxIdenticalToolCalls?: number;`
- [x] Atualizar classe `ExecutionPolicy` (`src/harness/ExecutionPolicy.ts`):
  - [x] Alterar valor padrão de `maxIterations` de 5 para 12
  - [x] Adicionar propriedade pública `public readonly maxIdenticalToolCalls: number;` (padrão: 2 ou `Number(process.env.MAX_IDENTICAL_TOOL_CALLS) || 2`)
  - [x] Adicionar método helper ou verificação para validação de limites
- [x] Atualizar `.env.example`:
  - [x] Documentar `MAX_TOOL_ITERATIONS=12`
  - [x] Documentar `MAX_IDENTICAL_TOOL_CALLS=2`

### Testes
- [x] Criar/atualizar testes unitários em `src/harness/ExecutionPolicy.test.ts`:
  - [x] Validar defaults (`maxIterations = 12`, `maxIdenticalToolCalls = 2`)
  - [x] Validar leitura correta a partir de variáveis de ambiente e via injeção customizada

### Verificação
- [x] `npm test` passa sem quebras nos testes existentes (92 arquivos, 708 testes aprovados)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 9B: Detector de Estagnação & Trava Anti-Loop no `AgentHarness`

**Branch:** `feature/harness-loop-optimization`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 9A  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Implementar helper de assinatura canônica de ferramenta em `src/harness/AgentHarness.ts`:
  - [ ] Gerar string normalizada de assinatura (`toolName:sortedArgsJson`)
- [ ] Implementar rastreamento de chamadas consecutivas no laço `while`:
  - [ ] Manter `lastToolSignature` e `consecutiveIdenticalCalls` no escopo da execução
  - [ ] Se a mesma ferramenta for chamada consecutivamente com argumentos idênticos $\ge$ `executionPolicy.maxIdenticalToolCalls`:
    - [ ] Registrar log de warning com métricas de contexto
    - [ ] Interromper o laço de ferramentas antes de esgotar o orçamento global
    - [ ] Injetar mensagem de sistema orientando o LLM a sintetizar as informações coletadas até o momento
    - [ ] Disparar chamada de fallback ao LLM sem ferramentas (`tools: []`)
    - [ ] Definir status da execução apropriado (ex: `loop_detected` ou `max_iterations` com log contextual)
- [ ] Garantir que chamadas com ferramentas diferentes ou argumentos distintos resetem o contador consecutivo

### Testes
- [ ] Atualizar `src/harness/AgentHarness.test.ts`:
  - [ ] Testar execução contínua até 12 iterações quando as chamadas de ferramentas progridem normalmente
  - [ ] Testar interrupção antecipada quando uma ferramenta idêntica é solicitada consecutivamente acima do limite
  - [ ] Testar injeção do aviso de sistema e geração da resposta final via fallback de síntese

### Verificação
- [ ] `npm test -- src/harness/AgentHarness.test.ts` 100% aprovado
- [ ] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 9C: Testes de Regressão, Validação Geral & Documentação

**Branch:** `feature/harness-loop-optimization`  
**Responsável:** `qa-engineer` / `backend-specialist`  
**Depende de:** Sub-Fase 9A e 9B concluídas  
**Status:** ⏳ Pendente  

### Implementação & Testes
- [ ] Executar suíte completa de testes unitários:
  - [ ] `npm test` (garantir zero regressões em todos os use cases e repositórios)
- [ ] Executar testes de integração do harness:
  - [ ] `npm run test:integration`
- [ ] Atualizar status em [docs/harness-iterations.md](docs/harness-iterations.md)
- [ ] Atualizar documentação de arquitetura caso necessário

---

## Definition of Done (Fase 9 - Opção A Completa)

- [ ] `maxIterations` elevado para 12 permitindo investigações aprofundadas sem necessidade de múltiplos "continue"
- [ ] Detector anti-loop bloqueando chamadas repetitivas idênticas com síntese graciosa
- [ ] Variáveis configuráveis no `.env.example`
- [ ] Suíte de testes unitários e de integração 100% aprovada
- [ ] TypeScript strict sem warnings ou erros de compilação

---

## Histórico de Fases Anteriores Concluídas

<details>
<summary><b>Fase 8: Contabilidade e Gestão de Tokens por Sessão — Concluída ✅</b></summary>

- [x] Sub-Fase 8A: Associação de Sessão em `AgentRun` & Persistência
- [x] Sub-Fase 8B: Ledger de Tokens & Contabilidade em `InvestigationSession`
- [x] Sub-Fase 8C: Propagação de Tokens no `AgentHarness` & `ProcessAgentResponseUseCase`
- [x] Sub-Fase 8D: Exposição de Tokens por Sessão na API & Métricas Prometheus
- [x] Sub-Fase 8E: Testes de Integração E2E, Validação & Documentação
- [x] 100% de testes aprovados (91 arquivos unitários, 690 testes / 10 arquivos de integração, 19 testes)
- [x] Documento consolidado: [docs/phase8-summary.md](docs/phase8-summary.md)
</details>

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
