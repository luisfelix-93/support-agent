# TODO — Fase 4: Support Workflows (Core de Investigação com Playbooks Modulares)

> Checklist operacional de implementação organizado por sub-fases para acompanhamento contínuo da Fase 4.  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [investigation-playbooks.md](investigation-playbooks.md) | Roadmap: [roadmap.md](roadmap.md)  
> Fase anterior: [Fase 3 Concluída](docs/phase3-summary.md)  

---

## Sub-Fase 4A: Setup da Branch & Fundação de Domínio (Contratos e Entidades Core)

**Branch:** `feature/support-workflows-playbooks`  
**Responsável:** `backend-specialist` / `project-planner`  

### Implementação
- [x] Criar e publicar a branch dedicada `feature/support-workflows-playbooks` a partir da `dev`
- [x] Criar `src/domain/workflows/IInvestigationPlaybook.ts`
  - [x] Definir interface `IInvestigationPlaybook`
  - [x] Propriedades: `id: string`, `name: string`, `domain: string`, `description: string`
  - [x] Métodos: `matches(userMessage: string, context?: ChatContext): boolean`
  - [x] Métodos: `getInvestigationPrompt(): string`, `getRecommendedTools(): string[]`
- [x] Criar `src/domain/workflows/EvidenceLedger.ts`
  - [x] Estrutura para consolidação de evidências: logs de erro, métricas de tráfego/erros, traces distribuídos, status de pods e dados de conexões/banco
  - [x] Métodos para adicionar e recuperar evidências por categoria
  - [x] Método para exportar resumo textual formatado para injeção no prompt ou resumo
- [x] Criar `src/domain/workflows/SessionSummary.ts`
  - [x] Value object / entidade do Resumo Executivo estruturado
  - [x] Campos obrigatórios: `runId`, `serviceName`, `incidentWindow`, `rootCauseHypothesis`, `evidence`, `recommendedActions`
  - [x] Método `toMarkdown(): string` para renderização corporativa no chat (Slack/Google Chat)
- [x] Criar `src/domain/workflows/PlaybookRegistry.ts`
  - [x] Catálogo de playbooks extensíveis
  - [x] Métodos: `register(playbook)`, `get(id)`, `getAll()`, `findMatchingPlaybooks(userMessage, context)`

### Testes
- [x] Criar `src/domain/workflows/EvidenceLedger.test.ts`
  - [x] Testar adição cumulativa de evidências por categoria
  - [x] Testar exportação formatada de evidências
- [x] Criar `src/domain/workflows/SessionSummary.test.ts`
  - [x] Testar validação dos campos obrigatórios e instanciação
  - [x] Testar formatação visual gerada pelo `toMarkdown()`
- [x] Criar `src/domain/workflows/PlaybookRegistry.test.ts`
  - [x] Testar registro e recuperação de playbooks
  - [x] Testar seleção de múltiplos playbooks por critérios de correspondência

### Verificação
- [x] `npm test` passa sem regressões (61/61 arquivos, 384/384 testes aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict aprovado)

---

## Sub-Fase 4B: Runtime & Harness Integration (Core SRE Investigation Engine)

**Branch:** `feature/support-workflows-playbooks`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 4A concluída  

### Implementação
- [x] Atualizar `src/domain/ports/IAgentHarness.ts`
  - [x] Estender `AgentRunInput` com campos opcionais:
    - [x] `systemInstructions?: string`
    - [x] `playbookIds?: string[]`
    - [x] `evidenceLedger?: EvidenceLedger`
- [x] Criar `src/harness/InvestigationEngine.ts`
  - [x] Injetar `PlaybookRegistry`
  - [x] Método `evaluate(userMessage: string, context?: ChatContext): InvestigationPlan | null`
  - [x] Protocolo de investigação SRE: *Triagem ➔ Hipótese ➔ Coleta ➔ Correlação ➔ RCA ➔ Resumo*
  - [x] Método para síntese e extração do `SessionSummary` a partir da resposta final do LLM
- [x] Atualizar `src/harness/AgentHarness.ts`
  - [x] Repassar `input.systemInstructions` para o `ContextAssembler.assemble(...)`
  - [x] Registrar `playbookIds` e metadados investigativos na entidade `AgentRun`
- [x] Atualizar `src/usecases/ProcessAgentResponseUseCase.ts`
  - [x] Conectar `InvestigationEngine`: se um incidente operacional for detectado, ativar os playbooks pertinentes
  - [x] Garantir que mensagens conversacionais simples (sem incidente) continuem sem overhead

### Testes
- [x] Criar `src/harness/InvestigationEngine.test.ts`
  - [x] Testar identificação de sintomas operacionais vs mensagens informativas
  - [x] Testar montagem consolidada do prompt investigativo
  - [x] Testar extração do `SessionSummary` estruturado
- [x] Atualizar `src/harness/AgentHarness.test.ts`
  - [x] Testar injeção de `systemInstructions` no contexto
  - [x] Testar persistência dos `playbookIds` no `AgentRun`

### Verificação
- [x] `npm test` passa com 100% de sucesso (62/62 arquivos, 390/390 testes aprovados)
- [x] Cobertura de testes unitários nos novos módulos de runtime e compilação limpa (`npm run build`)

---

## Sub-Fase 4C: Playbooks de Observabilidade (Erros em API & Alta Latência / Traces)

**Branch:** `feature/support-workflows-playbooks`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 4B concluída  

### Implementação
- [x] Criar `src/domain/workflows/playbooks/ApiErrorPlaybook.ts`
  - [x] Heurísticas de detecção (HTTP 5xx, erro em API, exception, endpoint falhando)
  - [x] Protocolo investigativo: consulta de logs no Loki + correlação com métricas de 5xx no Prometheus
  - [x] Identificação da janela temporal do incidente e hipótese de causa raiz
- [x] Criar `src/domain/workflows/playbooks/LatencyTracePlaybook.ts`
  - [x] Heurísticas de detecção (lentidão, timeout, p95/p99 elevado)
  - [x] Protocolo investigativo: consulta de traces no Grafana Tempo + localização do span gargalo
  - [x] Correlação com deploys recentes
- [x] Registrar os novos playbooks no container de injeção de dependências / `PlaybookRegistry`

### Testes
- [x] Criar `src/domain/workflows/playbooks/ApiErrorPlaybook.test.ts`
  - [x] Testar gatilhos de ativação para mensagens de erro em API
  - [x] Validar instruções e ferramentas recomendadas
- [x] Criar `src/domain/workflows/playbooks/LatencyTracePlaybook.test.ts`
  - [x] Testar gatilhos de ativação para problemas de latência e timeout
  - [x] Validar instruções e ferramentas recomendadas
- [x] Criar `src/harness/ApiErrorInvestigation.integration.test.ts`
  - [x] Simular incidente real de erro 500 com ferramentas MCP simuladas (Loki + Prometheus)
  - [x] Verificar geração correta da hipótese de RCA e do Session Summary
- [x] Criar `src/harness/LatencyInvestigation.integration.test.ts`
  - [x] Simular diagnóstico de alta latência identificando span no Tempo

### Verificação
- [x] `npm test` passa sem falhas (66/66 arquivos, 402/402 testes aprovados)
- [x] Validação do fluxo de correlação de logs e métricas comprovada em testes de integração

---

## Sub-Fase 4D: Playbooks de Infraestrutura (Kubernetes & Banco de Dados)

**Branch:** `feature/support-workflows-playbooks`  
**Responsável:** `backend-specialist` / `devops-engineer`  
**Depende de:** ✅ 4C concluída  

### Implementação
- [ ] Criar `src/domain/workflows/playbooks/KubernetesPlaybook.ts`
  - [ ] Heurísticas de detecção (pod reiniciando, CrashLoopBackOff, OOMKilled, deployment quebrado)
  - [ ] Protocolo investigativo: inspeção de status de pods, eventos de cluster e limites de recursos
- [ ] Criar `src/domain/workflows/playbooks/DatabasePlaybook.ts`
  - [ ] Heurísticas de detecção (pool de conexões esgotado, slow query, table lock, deadlock)
  - [ ] Protocolo investigativo: métricas de pool vs conexões ativas e detecção de queries em execução anômala
- [ ] Registrar os playbooks de infraestrutura no `PlaybookRegistry`

### Testes
- [ ] Criar `src/domain/workflows/playbooks/KubernetesPlaybook.test.ts`
  - [ ] Testar gatilhos de ativação para pods e cluster
- [ ] Criar `src/domain/workflows/playbooks/DatabasePlaybook.test.ts`
  - [ ] Testar gatilhos de ativação para banco e pools
- [ ] Criar `src/harness/KubernetesInvestigation.integration.test.ts`
  - [ ] Simular diagnóstico de pod reiniciando por OOMKilled
- [ ] Criar `src/harness/DatabaseInvestigation.integration.test.ts`
  - [ ] Simular diagnóstico de pool de conexões saturado e slow queries

### Verificação
- [ ] `npm test` passa sem erros
- [ ] Testes de integração de infraestrutura validados

---

## Sub-Fase 4E: Investigação Cruzada (Cross-Domain), Não-Regressão & Fechamento

**Branch:** `feature/support-workflows-playbooks`  
**Responsável:** `backend-specialist` / `project-planner`  
**Depende de:** ✅ 4D concluída  

### Implementação
- [ ] Criar teste de integração ponta a ponta `src/harness/CrossDomainInvestigation.integration.test.ts`
  - [ ] Simular cenário real cross-domain: erro 500 na API desencadeado por pool de conexões saturado no banco
  - [ ] Validar que múltiplos playbooks colaboram gerando um `SessionSummary` unificado
- [ ] Criar teste de Não-Regressão `src/harness/NonIncidentConversation.test.ts`
  - [ ] Garantir que perguntas gerais ou comandos sem incidentes não ativam playbooks indevidamente
- [ ] Atualizar documentações:
  - [ ] Atualizar `roadmap.md` marcando a Fase 4 como concluída `[x]`
  - [ ] Atualizar `architecture.md` com a camada de Workflows & Playbooks Modulares
  - [ ] Criar `docs/phase4-summary.md` com os resultados consolidados da Fase 4

### Verificação Final
- [ ] `npm test` — 100% dos testes aprovados (65+ arquivos de teste, zero falhas)
- [ ] `npm run build` — compilação limpa em TypeScript strict (0 erros)
- [ ] `npm run test:coverage` — cobertura mantida alta nos módulos de domínio e harness

---

## Definition of Done (Fase 4 Completa)

- [ ] Todas as sub-fases (4A, 4B, 4C, 4D, 4E) marcadas como concluídas
- [ ] Core de investigação SRE plenamente operacional no runtime do agente
- [ ] Catálogo de 4 playbooks funcionais: API Errors, Latency & Traces, Kubernetes, Database
- [ ] Suporte comprovado a investigações isoladas e investigações cruzadas (cross-domain)
- [ ] Resumo Executivo (`Session Summary`) gerado de forma padronizada com `runId` e evidências correlacionadas
- [ ] Conversas informativas preservadas sem sobrecarga ou ativações indevidas
- [ ] Suíte de testes automatizados com 100% de aprovação sem nenhuma regressão
