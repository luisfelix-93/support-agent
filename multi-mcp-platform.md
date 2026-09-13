# Support Agent — Plano de Implementação da Fase 6: MCP Platform (Multi-Server & Tool Governance)

> **Documento de Planejamento Arquitetural & Execução da Fase 6**  
> **Status:** 📝 Planejado  
> **Branch sugerida:** `feature/phase-6-multi-mcp-platform`  
> **Responsáveis:** `project-planner`, `backend-specialist`, `security-auditor`  
> **Referência Roadmap:** [roadmap.md](roadmap.md#fase-6--mcp-platform--governança-de-ferramentas) | Fase anterior: [Fase 5 Concluída](docs/phase5-summary.md)

---

## 1. Visão Geral & Oportunidade

Atualmente, o **Support Agent** suporta a conexão com apenas **um único servidor MCP** por tenant (`tenant.mcpConfig`), instanciando um cliente HTTP direto (`MCPHttpAdapter`) injetado no `AgentHarness`.

Em cenários reais de **AI Support & AI Ops Corporativo**, um agente de suporte investigativo precisa interagir com ecossistemas heterogêneos e especializados:
1. **Observabilidade MCP:** Logs (Grafana Loki), Métricas (Prometheus), Spans/Traces (Grafana Tempo).
2. **Infraestrutura & Orquestração MCP:** Kubernetes (Pods, Deployments, Events), Cloud Providers (AWS, GCP, Azure).
3. **Banco de Dados MCP:** PostgreSQL, MongoDB, Redis (Pool de conexões, Slow queries, Locks).
4. **Colaboração & Incident Management MCP:** Jira, PagerDuty, GitHub, ServiceNow.

Permitir múltiplos servidores MCP desbloqueia investigações autônomas e completas de ponta a ponta.

---

## 2. Desafios de Engenharia & Decisões Arquiteturais

### 2.1 Colisão de Nomes de Ferramentas (Tool Name Collision)
- **Problema:** Dois servidores distintos podem registrar ferramentas com o mesmo nome (ex: `query`, `status`, `health`).
- **Decisão:** Adotar **Namespacing transparente**:
  - Schema exportado para o LLM: `<serverId>__<toolName>` (ex: `k8s__get_pods`, `loki__query_logs`).
  - Ao despachar para o servidor MCP upstream correspondente, o prefixo é desempacotado e o nome original da ferramenta é enviado.

### 2.2 Preservação de Interfaces & Retrocompatibilidade (Zero-Breaking Changes)
- **Problema:** O `AgentHarness` e mais de 20 suítes de testes esperam receber um objeto compatível com `IMCPClient`.
- **Decisão:** Implementar o padrão **Composite Pattern** através da classe `CompositeMCPClient` que implementa `IMCPClient`. Para o `AgentHarness`, o composite parece ser um único cliente MCP transparente.

### 2.3 Resiliência e Isolamento de Falhas (Circuit Breaker por Servidor)
- **Problema:** Se o servidor MCP do banco de dados cair ou der timeout, os servidores de Kubernetes e Observabilidade não devem ser penalizados ou interrompidos.
- **Decisão:** Cada servidor gerenciado pelo composite possui seu próprio `CircuitBreaker` dedicado e timeout configurável.

### 2.4 Contextual Tool Discovery (Economia de Tokens e Precisão do LLM)
- **Problema:** Injetar esquemas de 100 ferramentas de 5 servidores satura a janela de contexto e confunde o LLM na seleção de ferramentas.
- **Decisão:** Integrar o composite com os `playbookIds` e domínios avaliados pelo `InvestigationEngine` (Fase 4), enviando apenas ferramentas relevantes para o sintoma detectado.

### 2.5 Tool Governance & Segurança Operacional (Risk Policies)
- **Problema:** Ferramentas destrutivas (ex: `delete_namespace`, `drop_database`) nunca devem ser executadas livremente por um agente autônomo.
- **Decisão:** Política formal de classificação de ferramentas:
  - `READ_ONLY`: Execução direta liberada (default para investigação SRE).
  - `LOW_RISK`: Execução permitida com auditoria estrita.
  - `HIGH_RISK` / `REQUIRE_APPROVAL`: Bloqueada em modo autônomo, exigindo confirmação humana ou flag explícita.
  - `FORBIDDEN`: Bloqueio imediato no gate de execução.

---

## 3. Arquitetura Proposta: `CompositeMCPClient` & `MCPRegistry`

```text
                               ┌─────────────────────────────────────────┐
                               │              AgentHarness               │
                               │  (executa loop iterativo LLM ↔ Ferram.) │
                               └────────────────────┬────────────────────┘
                                                    │ IMCPClient
                                                    ▼
                               ┌─────────────────────────────────────────┐
                               │           CompositeMCPClient            │
                               │  - Roteamento por namespace (<id>__<t>) │
                               │  - Tool Discovery contextual            │
                               │  - Governança de Risco (ToolGovernance) │
                               └───────┬──────────────┬──────────────┬───┘
                                       │              │              │
                    ┌──────────────────┘              │              └──────────────────┐
                    ▼                                 ▼                                 ▼
      ┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
      │  MCPHttpAdapter (K8s)     │     │  MCPHttpAdapter (Loki)    │     │  MCPHttpAdapter (Database)│
      │  CB: Fechado | Timeout 15s│     │  CB: Fechado | Timeout 10s│     │  CB: Fechado | Timeout 20s│
      └───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

---

## 4. Plano de Tarefas & Quebra em Sprints (Fases 6.1 a 6.4)

### Sprint 6.1: Core Composite MCP Client & Namespacing (Backend Specialist)
- [ ] Criar entidade `MCPServerRegistration`:
  - `id: string` (slug único, ex: `k8s`, `observability`, `database`)
  - `name: string`
  - `client: IMCPClient`
  - `domains?: string[]` (ex: `['kubernetes', 'infra']`, `['metrics', 'logs']`)
  - `isDefault?: boolean`
- [ ] Criar classe `CompositeMCPClient` implementando `IMCPClient`:
  - `registerServer(registration: MCPServerRegistration): void`
  - `connect()`: Conecta em paralelo (`Promise.allSettled`) a todos os servidores registrados, tolerando falhas parciais.
  - `listTools(filterOptions?)`: Agrega ferramentas de todos os servidores saudáveis, prefixando `name` com `<id>__<toolName>` e mantendo mapa reverso.
  - `executeTool(toolCall)`: Identifica o `serverId` pelo prefixo, sanitiza o nome da ferramenta (`toolName`) e encaminha a chamada para o adapter correto.
  - `close()`: Fecha todas as conexões filhas.
- [ ] Testes unitários com mocks no Vitest (`CompositeMCPClient.test.ts`).

### Sprint 6.2: Configuração Multi-Tenant & Persistência Criptografada (Database Architect)
- [ ] Atualizar entidade `Tenant`:
  - Suporte a `mcpServers?: MCPServerConfig[]` mantendo `mcpConfig?: MCPConfig` com compatibilidade legada.
  - `MCPServerConfig`: `{ id: string; name: string; url: string; apiKey?: string; domains?: string[]; timeoutMs?: number; enabled?: boolean; }`
- [ ] Atualizar `TenantRepository`:
  - Criptografia AES-256-GCM para as API Keys de todos os servidores da lista em repouso no MongoDB.
  - Descriptografia segura e mascaramento (`maskApiKey`) em consultas administrativas.
- [ ] Atualizar `OnboardingController` e `RegisterTenantUseCase` para aceitar múltiplos servidores MCP.
- [ ] Testes de repositório e regressão (`TenantRepository.test.ts`).

### Sprint 6.3: Tool Governance & Política de Risco (Security Auditor)
- [ ] Criar serviço de governança `ToolGovernanceService`:
  - Enums de risco: `ToolRiskLevel { READ_ONLY, LOW_RISK, HIGH_RISK, FORBIDDEN }`.
  - Regras regex/padrões: ex: `delete_*`, `drop_*`, `truncate_*` $\to$ `FORBIDDEN`.
  - Configuração de políticas de override por tenant no MongoDB.
- [ ] Interceptar chamadas no `AgentHarness` / `CompositeMCPClient`:
  - Se a ferramenta for `FORBIDDEN`, rejeitar imediatamente com mensagem de segurança auditada.
  - Se for `HIGH_RISK` e sem permissão de execução autônoma, suspender ou rejeitar instruindo abertura de chamado/aprovação humana.
- [ ] Testes unitários de governança e segurança (`ToolGovernanceService.test.ts`).

### Sprint 6.4: Tool Discovery Contextual & Integração com Playbooks (Backend Specialist)
- [ ] No `ProcessAgentResponseUseCase`, instanciar o `CompositeMCPClient` com os servidores do tenant.
- [ ] Integrar seleção de ferramentas com o `InvestigationEngine`:
  - Se o playbook ativo for `KubernetesPlaybook`, priorizar e filtrar ferramentas dos servidores de domínios `kubernetes` e `observability`.
- [ ] Testes E2E de integração com múltiplos servidores MCP mockados (`MultiMCPInvestigation.integration.test.ts`).

---

## 5. Matriz de Riscos & Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Latência acumulada no handshake (`connect`) de múltiplos servidores** | Médio | Execução concorrente com `Promise.allSettled` e cache de conexões ativas em memória (`Map<tenantKey, CompositeMCPClient>`). |
| **Queda de 1 servidor MCP paralisar os demais** | Alto | Isolamento total de Circuit Breaker. Se um servidor cair, suas ferramentas são temporariamente omitidas ou retornam erro isolado sem derrubar os outros. |
| **Consumo excessivo de contexto por excesso de schemas** | Alto | Tool Discovery contextual por playbook/intenção, ativando apenas os servidores necessários para a investigação em curso. |
| **Quebra de testes legados** | Alto | `CompositeMCPClient` implementa a interface estrita `IMCPClient`, mantendo 100% de compatibilidade com o `AgentHarness`. |

---

## 6. Critérios de Aceite & Verificação

1. **Testes Unitários:** `CompositeMCPClient` roteia corretamente chamadas para 2 ou mais servidores MCP mockados com prefixos `<id>__<tool>`.
2. **Isolamento de Circuit Breaker:** Falha forçada em um servidor não afeta a execução de ferramentas no outro servidor.
3. **Multi-Tenant:** Tenant com múltiplos servidores persiste credenciais criptografadas e carrega-os adequadamente.
4. **Governança:** Ferramentas configuradas como `FORBIDDEN` ou destrutivas são bloqueadas e registradas em auditoria.
5. **Integração E2E:** Suíte de testes automatizados executa uma investigação completa (ex: Kubernetes + Grafana Loki) consumindo 2 servidores MCP simultâneos com sucesso.
