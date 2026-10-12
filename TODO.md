# TODO — Fase 11: Resiliência contra Timeouts, Anti-Loop Semântico e Síntese Graciosa no AgentHarness

> Checklist operacional de implementação para acompanhamento contínuo da Fase 11 (Mitigação de Timeouts do AgentHarness).  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [harness-timeout-mitigation.md](harness-timeout-mitigation.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 10 Concluída](docs/release-notes-mcp-output-sanitization.md)  

---

## Sub-Fase 11A: Detector de Repetição Semântica & Anti-Loop por Alvo no `AgentHarness`

**Branch:** `fix/harness-timeout-mitigation`  
**Responsável:** `backend-specialist`  
**Status:** Concluída ✅  

### Implementação
- [x] Criar branch dedicada `fix/harness-timeout-mitigation` a partir de `dev`
- [x] Implementar helper de extração de recurso principal `getToolTargetKey(toolCall)` em `src/harness/AgentHarness.ts` (extraindo campos como `table_name`, `query`, `service`, `app`, `endpoint`)
- [x] Atualizar rastreamento de estagnação no loop `while` do `AgentHarness.ts`:
  - [x] Rastrear repetições consecutivas da mesma ferramenta sobre o mesmo alvo principal (`consecutiveTargetCalls`)
  - [x] Bloquear reexecuções redundantes que variem apenas formatação cosmética (ex: `output_format: json` vs `markdown`)
  - [x] Injetar mensagem de sistema instruindo o agente a sintetizar com os dados já obtidos quando o limite for atingido
- [x] Criar testes unitários em `src/harness/AgentHarness.test.ts`:
  - [x] Testar bloqueio de chamadas repetidas da mesma ferramenta com parâmetros cosmetizados sobre o mesmo recurso
  - [x] Garantir que chamadas legítimas a recursos distintos ou ferramentas diferentes não sejam bloqueadas

### Verificação
- [x] `npm test -- src/harness/AgentHarness.test.ts` aprovado (22/22 testes)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 11B: Síntese Graciosa por Proximidade de Timeout Global (`Graceful Timeout Drain`)

**Branch:** `fix/harness-timeout-mitigation`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 11A  
**Status:** Concluída ✅  

### Implementação
- [x] Atualizar `src/harness/ExecutionPolicy.ts`:
  - [x] Adicionar `timeoutDrainMarginMs?: number` (padrão: 20000 ou via variável `TIMEOUT_DRAIN_MARGIN_MS`)
- [x] Atualizar o loop iterativo em `src/harness/AgentHarness.ts`:
  - [x] Calcular `remainingMs = maxRunTimeMs - (Date.now() - startTime)` antes de solicitar nova ferramenta
  - [x] Se `remainingMs <= timeoutDrainMarginMs`, interromper solicitações de novas ferramentas
  - [x] Injetar mensagem de aviso de sistema com instrução de síntese imediata
  - [x] Chamar `generateLlmWithTimeout` com ferramentas vazias `[]` e timeout restrito à margem restante
  - [x] Finalizar o `AgentRun` com status de sucesso/concluído e resposta diagnóstica útil ao operador (evitando status `failed`)
- [x] Criar testes unitários em `src/harness/AgentHarness.test.ts`:
  - [x] Testar acionamento do Graceful Drain por margem de tempo
  - [x] Testar retorno da síntese em vez de falha genérica de timeout

### Verificação
- [x] `npm test -- src/harness/AgentHarness.test.ts` aprovado (25/25 testes)
- [x] `npm test -- src/harness/ExecutionPolicy.test.ts` aprovado (4/4 testes)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 11C: Calibração de Configurações, Documentação de Env & Diretrizes do Prompt

**Branch:** `fix/harness-timeout-mitigation`  
**Responsável:** `backend-specialist` / `prompt-engineer`  
**Depende de:** Sub-Fase 11B  
**Status:** Concluída ✅  

### Implementação
- [x] Atualizar `.env.example`:
  - [x] Documentar `TIMEOUT_DRAIN_MARGIN_MS=20000`
- [x] Atualizar diretrizes operacionais em `src/harness/InvestigationEngine.ts`:
  - [x] Instrução explícita no playbook proibindo redescoberta de schemas já obtidos
- [x] Atualizar testes em:
  - [x] `src/harness/ExecutionPolicy.test.ts` (testar nova propriedade e fallback de env)
  - [x] `src/harness/InvestigationEngine.test.ts` (validar novas diretrizes no prompt montado)

### Verificação
- [x] `npm test -- src/harness/ExecutionPolicy.test.ts` aprovado (4/4 testes)
- [x] `npm test -- src/harness/InvestigationEngine.test.ts` aprovado (11/11 testes)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 11D: Validação E2E, Testes de Regressão & Documentação

**Branch:** `fix/harness-timeout-mitigation`  
**Responsável:** `qa-engineer` / `backend-specialist`  
**Depende de:** Sub-Fases 11A, 11B e 11C concluídas  
**Status:** ⏳ Pendente  

### Implementação & Testes
- [ ] Executar suíte completa de testes:
  - [ ] `npm test` (garantir aprovação de 100% dos testes unitários sem regressão)
  - [ ] `npm run test:integration` (validar integrações do harness e do MCP)
- [ ] Atualizar documentação técnica:
  - [ ] `architecture.md` (documentar fluxo de Graceful Timeout Drain e Anti-Loop Semântico)
  - [ ] `features.md` (documentar a capacidade de síntese defensiva contra timeout)
  - [ ] `TODO.md`
- [ ] Criar release notes técnico em `docs/release-notes-harness-timeout-mitigation.md`

---

## Definition of Done (Fase 11)

- [ ] Repetições da mesma ferramenta para o mesmo recurso com parâmetros cosméticos alternados são interrompidas na 2ª tentativa
- [ ] O `AgentHarness` não é abortado sem resposta útil ao se aproximar de `maxRunTimeMs`; o agente realiza o drain gracioso com resumo das evidências
- [ ] Suíte de testes unitários e de integração 100% aprovada
- [ ] TypeScript strict sem warnings ou erros de compilação (`npm run build`)

---

## Histórico de Fases Anteriores Concluídas

<details>
<summary><b>Fase 10: Sanitização de Saída MCP & Ancoragem de Hipóteses com Disclaimer — Concluída ✅</b></summary>

- [x] Sub-Fase 10A: Componente de Domínio / Harness `ToolOutputSanitizer`
- [x] Sub-Fase 10B: Integração no `AgentHarness` & Parâmetros de Execução
- [x] Sub-Fase 10C: Protocolo de Incerteza & Hipóteses com Disclaimer no `InvestigationEngine`
- [x] Sub-Fase 10D: Auto-Avaliação, Validação E2E & Documentação
- [x] 100% de testes aprovados (93 arquivos unitários, 725 testes / 10 arquivos de integração, 19 testes)
- [x] Documento consolidado: [docs/release-notes-mcp-output-sanitization.md](docs/release-notes-mcp-output-sanitization.md)
</details>

<details>
<summary><b>Fase 9: Otimização de Iterações e Resiliência Anti-Loop do AgentHarness — Concluída ✅</b></summary>

- [x] Sub-Fase 9A: Parametrização e Política de Execução (`ExecutionPolicy` com `maxIterations=12` e `maxIdenticalToolCalls=2`)
- [x] Sub-Fase 9B: Detector de Estagnação & Trava Anti-Loop no `AgentHarness`
- [x] Sub-Fase 9C: Testes de Regressão, Validação Geral & Documentação
- [x] 100% de testes aprovados (92 arquivos, 712 testes unitários / 10 arquivos de integração, 19 testes)
- [x] Documento consolidado: [docs/release-notes-harness-loop-optimization.md](docs/release-notes-harness-loop-optimization.md)
</details>

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
