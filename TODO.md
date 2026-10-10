# TODO — Fase 10: Sanitização de Saída MCP & Ancoragem de Hipóteses com Disclaimer (Opção A)

> Checklist operacional de implementação para acompanhamento contínuo da Fase 10 (Sanitização de Payloads MCP & Mitigação de Alucinações).  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [mcp-sanitization-plan.md](mcp-sanitization-plan.md) | Roadmap: [roadmap.md](docs/roadmap.md)  
> Fase anterior: [Fase 9 Concluída](docs/release-notes-harness-loop-optimization.md)  

---

## Sub-Fase 10A: Componente de Domínio / Harness `ToolOutputSanitizer`

**Branch:** `feature/mcp-output-sanitization`  
**Responsável:** `backend-specialist`  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar branch dedicada `feature/mcp-output-sanitization` a partir de `dev`
- [x] Implementar classe e interfaces em `src/harness/ToolOutputSanitizer.ts`:
  - [x] Interface `SanitizationOptions` (`maxLines?: number`, `maxChars?: number`, `pruneKeys?: string[]`)
  - [x] Poda de chaves ruidosas/metadados em objetos JSON (ex: `metadata.managedFields`, `ownerReferences`, valores vazios/nulos)
  - [x] Truncamento seguro de saídas tabulares e streams de logs (`maxLines` com mensagem de supressão)
  - [x] Preservação de campos essenciais (status, mensagens de erro, identificadores chave)
- [x] Criar testes unitários em `src/harness/ToolOutputSanitizer.test.ts`:
  - [x] Testar poda de JSON de K8s e Loki mantendo propriedades relevantes
  - [x] Testar limites de linhas e caracteres com marcador de corte
  - [x] Testar idempotência com payloads já enxutos e tipos primitivos

### Verificação
- [x] `npm test -- src/harness/ToolOutputSanitizer.test.ts` 100% aprovado (9/9 testes)
- [x] `npm run build` compila com 0 erros TypeScript strict

---

## Sub-Fase 10B: Integração no `AgentHarness` & Parâmetros de Execução

**Branch:** `feature/mcp-output-sanitization`  
**Responsável:** `backend-specialist`  
**Depende de:** Sub-Fase 10A  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar `src/harness/ExecutionPolicy.ts`:
  - [ ] Adicionar `maxToolOutputChars?: number` (padrão: 6000 ou `MAX_TOOL_OUTPUT_CHARS`)
  - [ ] Adicionar `maxToolOutputLines?: number` (padrão: 50 ou `MAX_TOOL_OUTPUT_LINES`)
- [ ] Atualizar `.env.example`:
  - [ ] Documentar `MAX_TOOL_OUTPUT_CHARS=6000`
  - [ ] Documentar `MAX_TOOL_OUTPUT_LINES=50`
- [ ] Atualizar `src/harness/AgentHarness.ts`:
  - [ ] Injetar `ToolOutputSanitizer` no fluxo do loop `while` antes de adicionar mensagens a `assembledContext`
  - [ ] Manter auditoria detalhada em `run.recordToolCall(...)`
- [ ] Atualizar testes em `src/harness/AgentHarness.test.ts`:
  - [ ] Validar que payloads de ferramentas adicionados ao contexto respeitam os limites configurados

### Verificação
- [ ] `npm test -- src/harness/AgentHarness.test.ts` 100% aprovado
- [ ] `npm test -- src/harness/ExecutionPolicy.test.ts` 100% aprovado

---

## Sub-Fase 10C: Protocolo de Incerteza & Hipóteses com Disclaimer no `InvestigationEngine`

**Branch:** `feature/mcp-output-sanitization`  
**Responsável:** `prompt-engineer` / `backend-specialist`  
**Depende de:** Sub-Fase 10B  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar diretrizes de sistema em `src/harness/InvestigationEngine.ts`:
  - [ ] Adicionar regra de calibração de certeza (proibir afirmação definitiva sem evidência direta)
  - [ ] Definir formato para cenários inconclusivos com a tag `[HIPÓTESE CONDICIONAL - EVIDÊNCIA INCONCLUSIVA]`
  - [ ] Exigir estrutura com: (1) Verificações normais, (2) Disclaimer de evidência direta ausente, (3) Hipóteses prováveis em cenários análogos, (4) Próximas ferramentas sugeridas
- [ ] Atualizar testes em `src/harness/InvestigationEngine.test.ts`:
  - [ ] Validar presença do protocolo de disclaimer e hipóteses nas instruções do playbook

### Verificação
- [ ] `npm test -- src/harness/InvestigationEngine.test.ts` 100% aprovado

---

## Sub-Fase 10D: Auto-Avaliação, Validação E2E & Documentação

**Branch:** `feature/mcp-output-sanitization`  
**Responsável:** `qa-engineer` / `backend-specialist`  
**Depende de:** Sub-Fases 10A, 10B e 10C concluídas  
**Status:** ⏳ Pendente  

### Implementação & Testes
- [ ] Atualizar prompt de auto-avaliação em `src/evaluation/SelfEvaluationPrompt.ts`:
  - [ ] Calibrar critério de `completeness` e `hallucinationRisk` para validar positivamente o uso de disclaimers honestos
- [ ] Executar suíte completa de testes:
  - [ ] `npm test` (92+ arquivos unitários sem regressão)
  - [ ] `npm run test:integration` (testes de integração do harness e multi-MCP)
- [ ] Atualizar a documentação disponível e, `architecture.md`, `features.md`, `TODO.md`. 
- [ ] Criar release notes técnico em `docs/release-notes-mcp-output-sanitization.md`

---

## Definition of Done (Fase 10 - Opção A Completa)

- [ ] Saídas de ferramentas MCP sanitizadas e truncadas antes da injeção no contexto do LLM
- [ ] Economia perceptível no consumo de tokens em investigações multi-passo
- [ ] Agente instruído a emitir disclaimer explícito ao levantar hipóteses sem evidência direta
- [ ] Suíte de testes unitários e de integração 100% aprovada
- [ ] TypeScript strict sem warnings ou erros de compilação (`npm run build`)

---

## Histórico de Fases Anteriores Concluídas

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
