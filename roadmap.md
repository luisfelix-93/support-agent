# Support Agent — Roadmap de Desenvolvimento

> Roadmap estratégico para evolução do **Support Agent** de um agente de suporte técnico para uma plataforma de **AI Support / AI Operations**, com foco em confiabilidade, observabilidade, avaliação contínua e autonomia controlada.

---

## Visão Geral

O Support Agent já possui uma fundação técnica robusta e validada em produção:

- **Agent Harness**: Runtime desacoplado com loop iterativo LLM ↔ MCP e políticas de execução.
- **Memória Híbrida**: Short-Term Memory no Redis e Long-Term Memory semântica vetorial no MongoDB (1536d / OpenAI embeddings) com promoção assíncrona no BullMQ.
- **Múltiplos Provedores LLM**: OpenAI, Anthropic Claude, DeepSeek e Google Gemini com parametrização dinâmica por tenant.
- **Integração MCP**: Protocolo JSON-RPC 2.0 para execução dinâmica de ferramentas com Circuit Breaker e timeouts.
- **Omnichannel**: Conectores para Slack e Google Chat multi-tenant com verificação criptográfica.
- **Observabilidade**: Métricas Prometheus (`/metrics`), logs JSON estruturados com Pino / Grafana Loki e tracing distribuído OpenTelemetry / Grafana Tempo.
- **Segurança**: Autenticação JWT, API Keys por tenant, RBAC (`admin`, `operator`, `viewer`), senhas seguras (Argon2id/bcrypt) e criptografia AES-256-GCM para segredos em repouso.

---

## Diagrama de Fases

```text
                         ESTADO ATUAL
                              │
                              ▼
                    ┌───────────────────┐
                    │ 1. HARDENING      │  ✅ Concluída
                    │ Segurança         │
                    │ Reliability       │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 2. EVALUATION     │  ✅ Concluída
                    │ Medir qualidade    │
                    │ do Agent          │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 3. AGENT RUNS     │  ✅ Concluída
                    │ Cost & Analytics  │
                    │ Telemetria total  │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 4. SUPPORT        │  ✅ Concluída
                    │ WORKFLOWS         │  (Investigação
                    │ Produto           │   especializada)
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 5. MEMORY 2.0     │  🔄 Próximo Foco
                    │ Contexto híbrido  │
                    │ e ciclo de vida   │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 6. MCP PLATFORM   │  🔄 Planejada
                    │ Registry &        │
                    │ Tool Governance   │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ 7. CONTROL PLANE  │  🔄 Planejada
                    │ Dashboard web,    │
                    │ gestão e métricas │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ FUTURE            │  🔵 Long Term
                    │ Assisted &        │
                    │ Auto-Remediation  │
                    └───────────────────┘
```

---

# Fases Concluídas

## Fase 1 — Production Hardening
**Prioridade: 🔴 P0** | **Status: ✅ Concluída**

Garantir que a fundação do agente seja resiliente, tolerante a falhas e protegida contra vulnerabilidades:

- **Segurança e Acesso**:
  - [x] Autenticação em todos os endpoints REST (JWT e API Key).
  - [x] Autorização baseada em papéis (RBAC: `admin`, `operator`, `viewer`).
  - [x] Isolamento estrito de dados e memória por `tenantId` e `workspaceId`.
  - [x] Criptografia de credenciais e tokens em repouso com AES-256-GCM.
  - [x] Migração de hashing de senhas para algoritmos fortes com salt (Argon2id/bcrypt).
  - [x] Auditoria de operações administrativas.
- **Confiabilidade e Resiliência**:
  - [x] Idempotência com cache Redis para webhooks de chat e processamento de jobs.
  - [x] Políticas de retry com exponential backoff para requisições externas.
  - [x] Circuit breaker para chamadas de ferramentas MCP.
  - [x] Timeouts defensivos por integração e iteração.
  - [x] Graceful shutdown no encerramento de processos e workers.
  - [x] Health checks de liveness e readiness (`/health`).
  - [x] Rate limiting por tenant.

---

## Fase 2 — Agent Evaluation
**Prioridade: 🔴 P0** | **Status: ✅ Concluída**

Mensuração contínua e automatizada da qualidade e precisão das respostas do agente:

- **Métricas e Avaliação Analítica**:
  - [x] Pipeline assíncrono de auto-avaliação via fila BullMQ (`agent-evaluation`).
  - [x] Prompt avaliador (*LLM Judge*) comparando entrada, contexto e resposta final.
  - [x] Cálculo de pontuação composta ponderada (0 a 1.0):
    - Answer Correctness (40%)
    - Tool Selection Accuracy (25%)
    - Context Relevance (15%)
    - Hallucination Freedom (10%)
    - Memory Usefulness (10%)
  - [x] Exportação de métricas de qualidade via Gauges do Prometheus.
- **Detecção de Regressão**:
  - [x] Agregação de notas por versão de prompt e código (`AggregationService`).
  - [x] Comparação histórica e detecção automatizada de regressões em novos deploys.
  - [x] Endpoints REST administrativos protegidos com RBAC para consulta de avaliações.

---

## Fase 3 — Agent Runs, Cost & Analytics
**Prioridade: 🔴 P0** | **Status: ✅ Concluída**

Transformação de cada ciclo do agente em uma unidade observável, mensurável e auditável financeiramente:

- **Entidade `AgentRun` Persistente**:
  - [x] Armazenamento no MongoDB com `runId`, `tenantId`, `workspaceId`, `threadId`, `input`, `status`, `durationMs`, iterações e resposta final.
  - [x] Rastreamento de chamadas MCP: ferramenta executada, duração, argumentos, resultado e erros.
  - [x] Rastreamento de chamadas LLM: provedor, modelo, input tokens, output tokens, total de tokens e latência.
- **Rastreamento Financeiro de Custos**:
  - [x] Tabela de preços por milhão de tokens por provedor/modelo.
  - [x] Cálculo exato do custo em USD por execução.
- **API REST de Analytics (`/api/agent-runs`)**:
  - [x] Consulta individual por `runId` e listagem paginada com múltiplos filtros.
  - [x] Agregação financeira de custos e volume por tenant.
  - [x] Relatório analítico de ferramentas mais utilizadas, erros e latência por MCP.
  - [x] Métricas de volume de tokens e custos por provedor/modelo LLM.

---

## Fase 4 — Support Workflows (Investigação Especializada)
**Prioridade: 🔴 P1** | **Status: ✅ Concluída**

Evolução do Support Agent de um bot de perguntas e respostas para um **investigador autônomo de incidentes de TI**, combinando um **Core SRE Investigation Engine** com **Playbooks Modulares Conectáveis**:

- **Core de Investigação SRE**:
  - [x] Motor de triagem universal de sintomas operacionais (`InvestigationEngine`).
  - [x] Protocolo de investigação SRE (*Triagem ➔ Hipótese ➔ Coleta de Evidências ➔ Correlação Cruzada ➔ Causa Raiz / RCA ➔ Session Summary*).
  - [x] Não-invasividade: perguntas comuns de suporte são atendidas sem overhead de protocolos de incidente (`NonIncidentConversation`).
- **Playbooks de Domínio Entregues**:
  - [x] **Investigação de Erro em API (`ApiErrorPlaybook`)**: Identificação de serviços, consulta de logs no Grafana Loki, correlação com taxas de erro HTTP 5xx no Prometheus e apontamento de timestamps de início.
  - [x] **Investigação de Alta Latência (`LatencyTracePlaybook`)**: Percentis de latência p95/p99 no Prometheus, análise de traces distribuídos no Grafana Tempo para isolamento de spans gargalos e correlação com deploys.
  - [x] **Investigação de Kubernetes (`KubernetesPlaybook`)**: Diagnóstico de pods em `CrashLoopBackOff`, eventos de `OOMKilled` (Exit Code 137), histórico de restarts e limites de CPU/Memória.
  - [x] **Investigação de Banco de Dados (`DatabasePlaybook`)**: Mapeamento de esgotamento de pool de conexões (HikariCP), consultas ativas lentas (*slow queries*) e contenção por *locks*.
  - [x] **Investigação Cruzada (Cross-Domain)**: Orquestração cooperativa entre múltiplos playbooks (ex: erro 500 decorrente de timeout de conexão no banco de dados).
- **Evidências & Relatórios Executivos**:
  - [x] Caderno de Evidências (`EvidenceLedger`) para agregação de logs, métricas, traces, eventos e estado do cluster.
  - [x] Resumo Executivo de Sessão (`SessionSummary`): Resumo estruturado ao final da investigação (problema, evidências, causa raiz fundamentada, recomendações e `runId`).

---

# Fases Futuras

---

## Fase 5 — Memory 2.0 (Recuperação Híbrida & Ciclo de Vida)
**Prioridade: 🟠 P1**

Aprimorar o contexto e a qualidade do conhecimento retido pelo agente:

- **Busca Híbrida (Hybrid Retrieval)**:
  - Combinação de busca vetorial (similaridade de cosseno) com busca textual exata (BM25/Regex) para códigos de erro, IDs de transação e nomes de microsserviços.
  - Reranker de relevância contextual.
- **Ciclo de Vida de Memórias**:
  - Estados de memória: `candidate` → `validated` → `active` → `updated` → `expired`.
  - Expiração configurável (TTL) para fatos transitórios.
  - Interface para exclusão ou invalidação manual de memórias obsoletas por tenant.

---

## Fase 6 — MCP Platform & Governança de Ferramentas
**Prioridade: 🟠 P1**

Transformar o MCP de integrações pontuais em uma plataforma extensível e governada:

- **MCP Registry**:
  - Catálogo centralizado de servidores MCP (Observabilidade, Infraestrutura, Banco de Dados, CI/CD).
  - Configuração dinâmica de servidores MCP por tenant.
- **Tool Discovery Contextual**:
  - Em vez de enviar dezenas de ferramentas simultaneamente para o LLM, injetar apenas as ferramentas pertinentes ao domínio do problema.
- **Governança e Política de Risco (Tool Governance)**:
  - Classificação de ferramentas: `READ_ONLY`, `LOW_RISK`, `HIGH_RISK`, `FORBIDDEN`.
  - Bloqueio de ferramentas destrutivas e exigência de aprovação manual para ações críticas (`REQUIRE_APPROVAL`).

---

## Fase 7 — Control Plane & UI Administrativa
**Prioridade: 🟡 P2**

Desenvolvimento de um dashboard web unificado para operadores e administradores:

- Visão consolidada de execuções (`Agent Runs`), taxa de sucesso e custos em USD em tempo real.
- Gestão visual de tenants, usuários, chaves de API e conexões com Slack/Google Chat.
- Consulta e auditoria do histórico de memórias extraídas.
- Inspeção detalhada de traces e pontuações de auto-avaliação.

---

## Futuro — Assisted & Autonomous Remediation
**Prioridade: 🔵 Long Term**

Evolução gradual dos níveis de autonomia do agente:

```text
Nível 0: Chat e esclarecimento de dúvidas
   ↓
Nível 1: Leitura de dados e telemetria (Read-only)
   ↓
Nível 2: Investigação autônoma e correlação de evidências
   ↓
Nível 3: Recomendação fundamentada de ação de suporte
   ↓
Nível 4: Remediação com aprovação humana (Human-in-the-loop)
   ↓
Nível 5: Remediação autônoma para padrões operacionais conhecidos e seguros
```
