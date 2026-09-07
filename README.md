# Support Agent

Agente de suporte inteligente baseado em LLMs (Large Language Models) com integração ao protocolo MCP (Model Context Protocol) para execução dinâmica de ferramentas. O sistema segue princípios de **Clean Architecture / Hexagonal Architecture** para garantir desacoplamento entre a lógica de negócio e os provedores de infraestrutura.

---

## Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Camada Agent Harness (Runtime)](#camada-agent-harness-runtime)
  - [Short-Term Memory (Redis)](#short-term-memory-redis)
  - [Long-Term Memory & Busca Vetorial (MongoDB + Embeddings)](#long-term-memory--busca-vetorial-mongodb--embeddings)
  - [Promoção Assíncrona de Memória (BullMQ Worker)](#promoção-assíncrona-de-memória-bullmq-worker)
- [Camada de Avaliação e Telemetria (Fase 2)](#camada-de-avaliação-e-telemetria-fase-2)
  - [Telemetria de Execuções e Custos (`AgentRun`)](#telemetria-de-execuções-e-custos-agentrun)
  - [Worker de Auto-Avaliação e Pontuação Composta](#worker-de-auto-avaliação-e-pontuação-composta)
  - [Agregação, Comparação e Detecção de Regressão](#agregação-comparação-e-detecção-de-regressão)
  - [Endpoints REST de Avaliação](#endpoints-rest-de-avaliação)
- [Camada de Agent Runs & Analytics (Fase 3)](#camada-de-agent-runs--analytics-fase-3)
  - [Consulta Individual e Listagem Paginada](#consulta-individual-e-listagem-paginada)
  - [Análise Financeira e Consumo por Tenant](#análise-financeira-e-consumo-por-tenant)
  - [Analytics de Desempenho de Ferramentas / MCPs](#analytics-de-desempenho-de-ferramentas--mcps)
  - [Métricas de Consumo e Custo por Provedor/Modelo LLM](#métricas-de-consumo-e-custo-por-provedormodelo-llm)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Camadas](#camadas)
  - [Domain](#domain)
  - [Harness Layer](#harness-layer)
  - [Ports (Interfaces)](#ports-interfaces)
  - [Infrastructure](#infrastructure)
  - [Repositories](#repositories)
  - [Use Cases](#use-cases)
- [Camada de API (REST Reference)](#camada-de-api-rest-reference)
- [Observabilidade](#observabilidade)
  - [Coleta de Logs (Pino & Loki)](#coleta-de-logs)
  - [Métricas Prometheus](#métricas-prometheus)
  - [Tracing Distribuído (OpenTelemetry & Grafana Tempo)](#tracing-distribuído-opentelemetry--grafana-tempo)
- [Autenticação, Autorização e Segurança (Fase 1)](#autenticação-autorização-e-segurança-fase-1)
- [Onboarding](#onboarding)
- [Gestão de Configurações de Chat (Multi-Tenant Slack)](#gestão-de-configurações-de-chat-multi-tenant-slack)
- [Multi-Tenant](#multi-tenant)
- [Provedores LLM Suportados](#provedores-llm-suportados)
- [Integração MCP](#integração-mcp)
- [Integração Slack](#integração-slack)
- [Fluxo de Processamento](#fluxo-de-processamento)
- [Stack Tecnológica](#stack-tecnológica)
- [Testes](#testes)
- [Pré-requisitos](#pré-requisitos)
- [Instalação e Execução](#instalação-e-execução)
- [Configuração e Injeção de Dependências](#configuração-e-injeção-de-dependências)
- [Resiliência e Confiabilidade (Reliability Core)](#resiliência-e-confiabilidade-reliability-core)
- [Saúde Operacional e Ciclo de Vida (Operational Readiness)](#saúde-operacional-e-ciclo-de-vida-operational-readiness)
- [Status do Projeto](#status-do-projeto)

---

## Visão Geral

O **Support Agent** é um bot de atendimento que atua como intermediário entre o usuário final e sistemas internos. Ele utiliza LLMs para interpretar perguntas em linguagem natural e, quando necessário, invoca ferramentas externas via MCP para buscar dados concretos (logs, base de conhecimento, etc.) antes de formular uma resposta final.

**Principais capacidades:**

- 🤖 Processamento de linguagem natural via múltiplos provedores de LLM (`OpenAI`, `Anthropic`, `DeepSeek`, `Google`)
- ⚡ **Agent Harness Layer**: Runtime desacoplado (`IAgentHarness`) que gerencia o loop iterativo LLM ↔ MCP, tratamento de resiliência e medições de execução com `runId` único
- 🧠 **Short-Term Memory**: Cache de contexto de sessão em Redis (`memory:short:{workspaceId}:{threadId}`) com TTL configurável
- 🏛️ **Long-Term Memory**: Persistência de memórias estruturadas e fatos no MongoDB (`memories`) com isolamento estrito por `tenantId` e `workspaceId`
- 🔍 **Busca Vetorial & Embeddings**: Recuperação semântica de memórias relevantes por similaridade de cosseno usando vetores OpenAI (`text-embedding-3-small` / 1536 dimensões)
- 🚀 **Promoção Assíncrona de Memória**: Extração em background de fatos e preferências do diálogo via fila dedicada no BullMQ (`memory-promotion`), com zero acréscimo na latência de resposta ao usuário
- 📊 **Token Budgeting & Assembly**: Montagem explícita de contexto com contagem precisa de tokens (`ITokenCounter`) e truncagem inteligente
- 📈 **Camada de Avaliação e Telemetria de Custos (Fase 2)**: Rastreamento persistente de cada execução (`AgentRun`), cálculo exato de custos de inferência (OpenAI, Gemini, Anthropic, DeepSeek), auto-avaliação analítica assíncrona via BullMQ (`EvaluationWorker`), pontuação composta (0-1.0), detecção de regressão em releases e API REST protegida com RBAC
- 🔧 Descoberta e execução dinâmica de ferramentas via MCP (JSON-RPC 2.0)
- 📊 Observabilidade nativa via Prometheus, Grafana Loki e Tracing Distribuído com Grafana Tempo (OpenTelemetry)
- 💬 Suporte multi-plataforma de chat: **Google Chat** e **Slack** prontos para uso

---

## Arquitetura

O projeto adota uma arquitetura hexagonal (Ports & Adapters), com uma **Camada Harness desacoplada** para o runtime de execução agentic e um subsistema desacoplado de memória e vetores:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Use Cases                                       │
│                     ProcessAgentResponseUseCase                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ (Delega execução ao Runtime Harness)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Harness Layer                               │
│           AgentHarness  ──► ContextAssembler ──► ExecutionPolicy            │
│                 │                │                                          │
│                 │                ▼                                          │
│                 │        TiktokenAdapter (BPE)                              │
└─────────┬───────┴──────────────┬──────────────────┬─────────────────┬───────┘
          │                      │                  │                 │
    ┌─────▼───────┐        ┌─────▼──────┐     ┌─────▼─────────┐ ┌─────▼─────────┐
    │ ILLMProvider│        │ IMCPClient │     │IShortTermMem. │ │IMemoryRepos.  │
    └─────┬───────┘        └─────┬──────┘     └─────┬─────────┘ └─────┬─────────┘
          │                      │                  │                 │
    ┌─────▼───────┐        ┌─────▼──────┐     ┌─────▼─────────┐ ┌─────▼─────────┐
    │   OpenAI    │        │    MCP     │     │  Redis STM    │ │ MongoMemory   │
    │   Adapter   │        │   HTTP     │     │  (ioredis)    │ │ (Cosine/Vector│
    ├─────────────┤        │  Adapter   │     └───────────────┘ └───────────────┘
    │  Anthropic  │        └────────────┘                             ▲
    │   Adapter   │                                                   │
    ├─────────────┤        ┌────────────────────────────────────┐     │
    │   DeepSeek  │        │       BullMQ Queue Service         │     │
    ├─────────────┤        │     ('memory-promotion' queue)     │     │
    │   Google    │        └─────────────────┬──────────────────┘     │
    └─────────────┘                          │                        │
          │                                  ▼                        │
          │ (Persiste Run) ┌────────────────────────────────────┐     │
          ▼                │      MemoryPromotionWorker         │     │
    ┌───────────────┐      │   - LLMMemoryExtractor             │     │
    │AgentRunRepos. │      │   - OpenAIEmbeddingProvider (1536d)├─────┘
    │(MongoDB: runs)│      │   - Deduplicação & Idempotência    │
    └───────┬───────┘      └────────────────────────────────────┘
            │
            │ (Enfileira auto-avaliação)
            ▼
    ┌────────────────────────────────────┐
    │       BullMQ Queue Service         │
    │     ('agent-evaluation' queue)     │
    └─────────────────┬──────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────┐
    │        EvaluationWorker            │
    │   - SelfEvaluationPrompt (LLM)     │
    │   - ScoreCalculator (Composite)    │
    │   - Prometheus Metrics Gauges      │
    └─────────────────┬──────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────┐
    │       EvaluationRepository         │
    │    (MongoDB: 'evaluations')        │
    └─────────────────┬──────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────┐
    │        AggregationService          │
    │   - Versões, Comparação & Regressão│
    └─────────────────┬──────────────────┘
                      │
                      ▼
    ┌────────────────────────────────────┐
    │     EvaluationController (API)     │
    │       GET /api/evaluations/*       │
    └────────────────────────────────────┘
```

---

## Camada Agent Harness (Runtime)

A **Camada Agent Harness** é o motor de execução do agente. Ela abstrai e orquestra o ciclo iterativo entre o provedor de LLM (`ILLMProvider`) e o servidor MCP (`IMCPClient`), retirando essa responsabilidade do UseCase e promovendo alta testabilidade, observabilidade e gerenciamento de estado de curto e longo prazo.

### Por que um Harness?

1. **Desacoplamento do UseCase**: O `ProcessAgentResponseUseCase` lida apenas com a resolução de infraestrutura (busca tenant, recupera histórico do banco e envia mensagem ao chat), enquanto a execução agentic fica sob responsabilidade do `IAgentHarness`.
2. **Short-Term Memory (Redis)**: As iterações intermediárias da conversa (chamadas e respostas de ferramentas) são mantidas em um cache de memória de curto prazo com TTL configurável em Redis (`memory:short:{workspaceId}:{threadId}`).
3. **Long-Term Memory & Vector Search (MongoDB + Embeddings)**: Fatos duradouros e preferências do usuário são recuperados semanticamente e injetados de forma resumida no início do contexto.
4. **Token Budgeting (Orçamento de Tokens)**: Garantia estrita de que o contexto enviado para o LLM nunca ultrapassa a janela de contexto permitida (`maxTokens`), utilizando contagem de tokens baseada em BPE/ChatML (`TiktokenAdapter`).
5. **Resiliência e Recuperação de Erros**: Se uma ferramenta MCP falhar ou estourar tempo limite, o erro é injetado como mensagem de contexto para o LLM. Se o número limite de iterações for atingido, o Harness intercepta e exige uma resposta final de síntese.
6. **Observabilidade Granular**: Cada execução gera um `runId` único (UUID v4) que é injetado nos logs estruturados do Pino/Loki, além de incrementar contadores e histogramas no Prometheus.

### Componentes Principais

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             AgentHarness                                 │
│  - Controla o loop iterativo LLM ↔ MCP                                   │
│  - Realiza busca semântica vetorial pré-execução via IMemoryRepository   │
│  - Atribui runId e mede duração da execução                              │
│  - Captura erros de ferramentas como contexto                            │
│  - Armazena histórico recente na Short-Term Memory                        │
│  - Enfileira job de promoção de memória de longo prazo (BullMQ)          │
└──────────────┬─────────────────────────────┬─────────────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌─────────────────────────────────────────┐
│       ContextAssembler       │ │             ExecutionPolicy             │
│ - Aplica systemInstructions  │ │ - Regras de limite (máx 5 iterações)    │
│ - Injeta memórias de longo   │ │ - Timeouts globais e de iteração        │
│   prazo no prompt de sistema │ │ - Thresholds de alerta                  │
│ - Calcula orçamentos de token│ └─────────────────────────────────────────┘
│ - Executa truncagem inteligente│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       TiktokenAdapter        │
│ - Contagem precisa de tokens │
│ - Algoritmo BPE / ChatML     │
└──────────────────────────────┘
```

| Componente | Localização | Função |
|---|---|---|
| **`IAgentHarness`** | `src/domain/ports/IAgentHarness.ts` | Interface principal do runtime agentic (`run(input): Promise<AgentRunResult>`). |
| **`AgentHarness`** | `src/harness/AgentHarness.ts` | Implementação do loop agentic, busca vetorial, orquestração MCP, resiliência e métricas. |
| **`IContextAssembler`** | `src/domain/ports/IContextAssembler.ts` | Contrato para montagem e orçamentação de contexto. |
| **`ContextAssembler`** | `src/harness/ContextAssembler.ts` | Montagem de contexto com injeção de memórias de longo prazo, system prompt e truncamento. |
| **`ITokenCounter`** | `src/domain/ports/ITokenCounter.ts` | Interface para cálculo de tokens. |
| **`TiktokenAdapter`** | `src/infrastructure/tokenizer/TiktokenAdapter.ts` | Adaptador baseado no `tiktoken` (cl100k_base / ChatML) para contagem exata de tokens. |
| **`IShortTermMemory`** | `src/domain/ports/IShortTermMemory.ts` | Interface de armazenamento temporário de sessão. |
| **`RedisShortTermMemory`** | `src/infrastructure/memory/RedisShortTermMemory.ts` | Short-Term Memory com Redis (chave: `memory:short:{workspaceId}:{threadId}`). |
| **`IMemoryRepository`** | `src/domain/ports/IMemoryRepository.ts` | Contrato para persistência e busca vetorial/textual de memórias no MongoDB. |
| **`MongoMemoryRepository`** | `src/repositories/MongoMemoryRepository.ts` | Repositório de memórias com cálculo de similaridade por cosseno e isolamento multi-tenant. |
| **`IEmbeddingProvider`** | `src/domain/ports/IEmbeddingProvider.ts` | Contrato para geração de embeddings vetoriais. |
| **`OpenAIEmbeddingProvider`** | `src/infrastructure/llm/OpenAIEmbeddingProvider.ts` | Adaptador OpenAI (`text-embedding-3-small` / 1536 dimensões) com spans e métricas. |
| **`IMemoryExtractor`** | `src/domain/ports/IMemoryExtractor.ts` | Contrato para extração estruturada de memórias via LLM. |
| **`LLMMemoryExtractor`** | `src/infrastructure/memory/LLMMemoryExtractor.ts` | Extrator estruturado com parsing defensivo e fallback gracioso. |
| **`MemoryPromotionWorker`** | `src/infrastructure/queue/MemoryPromotionWorker.ts` | Worker BullMQ em segundo plano que extrai memórias, gera embeddings e salva no MongoDB. |
| **`ExecutionPolicy`** | `src/harness/ExecutionPolicy.ts` | Guardrails de execução: máximo de 5 iterações de ferramentas, timeout por iteração e limite de tokens. |
| **`AgentMetrics`** | `src/infrastructure/metrics/AgentMetrics.ts` | Coletores de métricas Prometheus para execução, memória e embeddings. |

---

### Long-Term Memory & Busca Vetorial (MongoDB + Embeddings)

O subsistema de **Long-Term Memory** permite que o agente mantenha conhecimento persistente entre diferentes sessões e dias de atendimento:

1. **Estrutura da Memória (`Memory`)**:
   - `id`: Identificador único (UUID v4)
   - `tenantId` e `workspaceId`: Chaves de partição e isolamento multi-tenant
   - `type`: Categoria (`fact`, `preference`, `summary`, `instruction`)
   - `content`: Conteúdo textual conciso extraído do diálogo
   - `importance`: Peso de relevância (0.0 a 1.0)
   - `embedding`: Vetor numérico (1536 dimensões)
   - `createdAt` e `updatedAt`: Timestamps

2. **Busca Semântica por Similaridade de Cosseno**:
   - Quando o usuário envia uma nova mensagem, o `AgentHarness` gera o embedding da query via `IEmbeddingProvider`.
   - O `MongoMemoryRepository.searchRelevant` filtra os documentos do tenant e calcula a similaridade por cosseno entre o vetor da query e os vetores armazenados:
     $$\text{Cosine Similarity} = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}$$
   - Memórias com similaridade $\ge 0.65$ (configurável) são ordenadas por relevância e retornadas para o `ContextAssembler`.
   - Se a busca vetorial não estiver habilitada ou o provedor falhar, o repositório aplica busca textual com regex como fallback.

---

### Promoção Assíncrona de Memória (BullMQ Worker)

Para que a extração de memórias não aumente a latência percebida pelo usuário final, a promoção é 100% desacoplada e assíncrona:

```
[AgentHarness] ────(Após responder ao usuário)────► [Fila: memory-promotion (BullMQ)]
                                                                  │
                                                                  ▼
                                                      [MemoryPromotionWorker]
                                                                  │
                                                  ┌───────────────┴───────────────┐
                                                  ▼                               ▼
                                       [LLMMemoryExtractor]          [OpenAIEmbeddingProvider]
                                       (Extrai fatos/JSON)             (Gera embeddings 1536d)
                                                  │                               │
                                                  └───────────────┬───────────────┘
                                                                  ▼
                                                    [MongoMemoryRepository.saveBatch]
                                                    (Deduplicado por tenant e workspace)
```

1. **Publicação Sem Bloqueio**: Ao concluir a resposta com sucesso, o `AgentHarness` despacha um job na fila `memory-promotion` contendo as mensagens da rodada atual e o contexto de rastreamento (`traceContext`).
2. **Extração Especializada**: O worker aciona o `LLMMemoryExtractor`, instruindo o LLM a identificar exclusivamente fatos novos, regras de negócio ou preferências explícitas do usuário.
3. **Deduplicação & Idempotência**: O worker consulta o repositório para verificar se uma memória com o mesmo significado já existe antes de salvá-la.
4. **Enriquecimento com Vetores**: As memórias aprovadas têm seus embeddings gerados pelo `OpenAIEmbeddingProvider` e são persistidas no MongoDB.

---

```
support-agent/
├── Dockerfile                           # Build multi-stage para produção
├── src/
│   ├── domain/                          # Núcleo de domínio (entidades + regras de negócio)
│   │   ├── AgentRun.ts                 # Entidade de rastreamento de execução agentic (runId, duration, status)
│   │   ├── ChatConfig.ts               # Entidade de configuração de bot (workspaceId, teamId, tokens sensíveis)
│   │   ├── ChatContext.ts               # Contexto de conversação (thread + mensagens)
│   │   ├── LLMConfig.ts                # Tipagem de configuração do provedor LLM
│   │   ├── MCPServerCapabilities.ts     # Tipos do handshake MCP
│   │   ├── Memory.ts                   # Modelo de memória estruturada e vetorial (Short-Term & Long-Term)
│   │   ├── Message.ts                  # Entidade de mensagem
│   │   ├── Password.ts                 # Value object — hash SHA-256 na criação, compare em login
│   │   ├── SpaceMapping.ts             # Mapeamento spaceId → workspaceId
│   │   ├── Tenant.ts                   # Entidade de tenant (workspaceId, llmConfig, mcpConfig)
│   │   ├── ToolCall.ts                 # Entidade de chamada de ferramenta
│   │   ├── User.ts                     # Entidade de usuário (id, name, email, password, role)
│   │   └── ports/                      # Interfaces (contratos de fronteira)
│   │       ├── IAgentHarness.ts        # Contrato principal da camada Harness
│   │       ├── IChatConfigRepository.ts # Interface do repositório de ChatConfig
│   │       ├── IChatProvider.ts
│   │       ├── IChatRepository.ts
│   │       ├── IContextAssembler.ts    # Contrato para montagem de contexto e token budget
│   │       ├── IEmbeddingProvider.ts   # [NOVO] Contrato para geração de embeddings vetoriais
│   │       ├── IEncryptionService.ts   # Interface do serviço de criptografia
│   │       ├── ILLMProvider.ts
│   │       ├── IMCPClient.ts
│   │       ├── IMemoryExtractor.ts     # [NOVO] Contrato para extração de memórias via LLM
│   │       ├── IMemoryRepository.ts    # [NOVO] Contrato para persistência e busca de memórias
│   │       ├── IQueueService.ts        # Enfileiramento de processamento e promoção de memória
│   │       ├── IShortTermMemory.ts     # Contrato para cache de sessão temporária
│   │       ├── ISpaceMappingRepository.ts
│   │       ├── ITenantRepository.ts
│   │       ├── ITokenCounter.ts        # Contrato para contagem de tokens (BPE)
│   │       └── IUserRepository.ts
│   │
│   ├── harness/                         # Motor de execução e orquestração agentic
│   │   ├── AgentHarness.ts             # Loop iterativo LLM ↔ MCP, busca vetorial e métricas
│   │   ├── AgentHarness.test.ts
│   │   ├── AgentHarness.integration.test.ts # [NOVO] Teste E2E do ciclo completo de memória
│   │   ├── ContextAssembler.ts         # Assembly de contexto com injeção de memórias e truncamento
│   │   ├── ContextAssembler.test.ts
│   │   └── ExecutionPolicy.ts          # Guardrails de execução (máx iterações, timeouts)
│   │
│   ├── infrastructure/                  # Implementações concretas dos ports
│   │   ├── chat/
│   │   │   ├── ChatProviderFactory.ts  # Fábrica dinâmica de ChatProviders por workspaceId
│   │   │   ├── GoogleChatAdapter.ts
│   │   │   └── SlackChatAdapter.ts
│   │   ├── database/
│   │   │   └── MongoConnection.ts
│   │   ├── llm/
│   │   │   ├── AnthropicAdapter.ts
│   │   │   ├── OpenAIAdapter.ts
│   │   │   ├── OpenAIEmbeddingProvider.ts # [NOVO] Provedor de embeddings OpenAI (1536d)
│   │   │   └── LLMFactory.ts
│   │   ├── mcp/
│   │   │   └── MCPHttpAdapter.ts
│   │   ├── memory/                     # Memória de curto prazo e extratores
│   │   │   ├── RedisShortTermMemory.ts
│   │   │   ├── RedisShortTermMemory.test.ts
│   │   │   ├── LLMMemoryExtractor.ts   # [NOVO] Extrator estruturado de memórias
│   │   │   └── LLMMemoryExtractor.test.ts
│   │   ├── metrics/                    # Métricas Prometheus
│   │   │   └── AgentMetrics.ts
│   │   ├── queue/
│   │   │   ├── BullMQAdapter.ts            # Producer — enfileira mensagens e promoções de memória
│   │   │   ├── BullMQWorker.ts             # Consumer — processa mensagens de chat
│   │   │   ├── MemoryPromotionWorker.ts    # [NOVO] Consumer — extrai, vetoriza e salva memórias
│   │   │   └── QStashAdapter.ts            # Adapter legado para QStash (Upstash)
│   │   ├── security/
│   │   │   └── AESEncryptionService.ts     # Implementação AES-256-GCM para criptografia em repouso
│   │   ├── tokenizer/                  # Adaptador de contagem de tokens
│   │   │   └── TiktokenAdapter.ts
│   │   └── tracing/                    # Tracing distribuído e propagação de contexto
│   │       ├── TraceContext.ts         # Injeção e extração de contexto W3C (traceparent)
│   │       ├── TracerProvider.ts       # Helpers tipados de tracing (withSpan, withContext)
│   │       ├── TraceContext.test.ts
│   │       └── TracerProvider.test.ts
│   │
│   ├── repositories/                    # Implementações concretas dos repositórios
│   │   ├── ChatConfigRepository.ts     # Coleção chat_configs (criptografia transparente de tokens)
│   │   ├── ChatRepository.ts
│   │   ├── MongoMemoryRepository.ts    # [NOVO] Coleção memories (busca textual e vetorial por cosseno)
│   │   ├── SpaceMappingRepository.ts    # Coleção space_mappings
│   │   ├── TenantRepository.ts
│   │   └── UserRepository.ts           # Coleção users
│   │
│   ├── usecases/                        # Orquestração de lógica de aplicação
│   │   ├── AssociateTenantToUserUseCase.ts
│   │   ├── GetChatConfigUseCase.ts
│   │   ├── LoginUserUseCase.ts
│   │   ├── ProcessAgentResponseUseCase.ts
│   │   ├── RegisterChatConfigUseCase.ts
│   │   ├── RegisterSpaceUseCase.ts
│   │   ├── RegisterTenantUseCase.ts
│   │   └── RegisterUserUseCase.ts
│   │
│   ├── api/
│   │   ├── middlewares/
│   │   │   └── authMiddleware.ts        # Valida Bearer JWT e injeta req.user
│   │   ├── types/
│   │   │   └── express.d.ts            # Module augmentation — tipagem de req.user
│   │   ├── authRouter.ts               # POST /api/auth/login
│   │   ├── chatConfigRouter.ts         # POST /api/chat-configs, GET /api/chat-configs/:workspaceId
│   │   ├── onboardingRouter.ts         # POST /api/onboarding/*
│   │   ├── slackRouter.ts              # POST /api/slack/events
│   │   ├── webhookRouter.ts
│   │   └── workerRouter.ts
│   │
│   ├── config/
│   │   ├── container.ts               # Composition Root com DI de memória e embeddings
│   │   ├── logger.ts                  # Logger Pino com mixin OpenTelemetry (trace_id / span_id)
│   │   ├── metrics.ts                 # Registry e métricas Prometheus
│   │   └── tracing.ts                 # Inicialização do OpenTelemetry SDK e OTLP Exporter
│   │
│   ├── controllers/
│   │   ├── AuthController.ts
│   │   ├── ChatConfigController.ts     # Endpoints de cadastro e consulta de ChatConfig
│   │   ├── ChatWebhookController.ts
│   │   ├── OnboardingController.ts
│   │   ├── SlackWebhookController.ts   # Valida assinatura Slack buscando signingSecret por team_id
│   │   └── WorkerController.ts
│   │
│   ├── app.ts
│   └── index.ts
│
├── api/
│   └── index.ts                       # Entry point para Vercel Serverless Functions
├── harness-long-term-memory.md        # [NOVO] Especificação e status de desenvolvimento do Harness
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

---

## Camadas

### Domain

Contém as entidades centrais e as regras de negócio do sistema. Não possui dependência de nenhuma biblioteca externa.

| Entidade | Descrição |
|---|---|
| `Message` | Representa uma mensagem individual com `id`, `role` (user/assistant/system), `content` e `timestamp`. |
| `ChatContext` | Agrupa um `threadID`, `workspaceId` e o histórico de `Message[]`. |
| `Tenant` | Workspace configurado com `workspaceId`, `llmConfig`, `mcpConfig` e `isActive`. |
| `AgentRun` | Modelo de domínio de rastreamento da execução agentic (`runId`, `tenantId`, `workspaceId`, `threadId`, `status`, `durationMs`, `toolCalls`). |
| `Memory` | Modelo de domínio de memória estruturada e semântica (`id`, `tenantId`, `workspaceId`, `type`, `content`, `importance`, `embedding?: number[]`). |
| `User` | Usuário do sistema com `id`, `name`, `email`, `password` (value object) e `workspaceId: string[]`. |
| `Password` | Value object que encapsula senha hasheada (SHA-256). Criado via `Password.create(plain)` no entry point; comparado via `password.compare(plain)` no login. |
| `SpaceMapping` | Mapeia um `spaceId` do Google Chat ao `workspaceId` do tenant correspondente. |
| `ChatConfig` | Entidade que armazena credenciais do Slack (`botToken`, `appToken`, `signingSecret`) por tenant (`workspaceId` e `teamId`). |
| `ToolCall` | Requisição de execução de ferramenta com `name` e `parameters`. |
| `LLMConfig` | Interface com `provider`, `apiKey` e `model` opcional. Suporta: `openai`, `anthropic`, `google`, `deepseek`. |

### Harness Layer

Motor desacoplado responsável pela orquestração iterativa do agente:

- **`AgentHarness`**: Runtime que gerencia o loop iterativo LLM ↔ MCP, busca vetorial de memórias, captura exceções em ferramentas, gera o `runId` e atualiza métricas Prometheus.
- **`ContextAssembler`**: Monta o contexto para o LLM adicionando instruções de sistema, memórias de longo prazo e truncando histórico de forma inteligente com base no limite de tokens.
- **`ExecutionPolicy`**: Define regras de parada (limite de 5 iterações, timeouts e orçamentos de token).

### Ports (Interfaces)

Contratos que definem as fronteiras do domínio — implementados pela camada de infraestrutura.

| Port | Responsabilidade |
|---|---|
| `IAgentHarness` | Interface do runtime desacoplado do agente (`run(input): Promise<AgentRunResult>`). |
| `IContextAssembler` | Interface para montagem de contexto com orçamento de tokens e injeção de memórias. |
| `ITokenCounter` | Interface para contagem precisa de tokens (BPE/ChatML). |
| `IShortTermMemory` | Interface para gerenciamento de memória temporária de sessão com TTL. |
| `IMemoryRepository` | Interface para persistência e busca textual/vetorial de memórias de longo prazo. |
| `IMemoryExtractor` | Interface para extração estruturada de fatos e preferências a partir de diálogos. |
| `IEmbeddingProvider` | Interface para geração de vetores de embedding individuais ou em lote (*batch*). |
| `ILLMProvider` | Gera respostas a partir do `ChatContext`. Retorna `{ type: 'text' }` ou `{ type: 'tool_call' }`. |
| `IMCPClient` | Handshake MCP, listagem e execução de ferramentas. |
| `IChatProvider` | Envia mensagens ao canal de chat do usuário final. |
| `IQueueService` | Despacha mensagens e jobs de promoção assíncrona de memória (`dispatchMemoryPromotion`). |
| `IChatRepository` | Persiste e recupera `ChatContext` por `threadId` + `workspaceId`. |
| `ITenantRepository` | Persiste e recupera `Tenant` por `workspaceId`. |
| `ISpaceMappingRepository` | Persiste e recupera mapeamentos `spaceId → workspaceId`. |
| `IUserRepository` | Persiste e recupera `User` por `id` ou `email`; adiciona `workspaceId` ao array. |
| `IChatConfigRepository` | Persiste e recupera `ChatConfig` por `workspaceId` ou `teamId`. |
| `IEncryptionService` | Criptografa e descriptografa dados sensíveis em repouso. |

### Infrastructure

Implementações concretas dos ports:

#### LLM & Embedding Adapters

- **`OpenAIAdapter`** — Integra com a API da OpenAI (Chat Completions) e provedores compatíveis via `baseURL` (ex: DeepSeek).
- **`AnthropicAdapter`** — Integra com a API da Anthropic (Messages), separando system prompts e mapeando `tool_use`.
- **`OpenAIEmbeddingProvider`** — Gera vetores de embedding via OpenAI SDK (`text-embedding-3-small` / 1536 dimensões) com spans OpenTelemetry e métricas Prometheus.
- **`LLMFactory`** — Factory Method que instancia o adapter correto (`openai`, `deepseek`, `anthropic`, `google`).

#### MCP Adapter

- **`MCPHttpAdapter`** — Cliente HTTP JSON-RPC 2.0 com handshake de 3 etapas (`initialize` → capabilities → `notifications/initialized`), listagem e execução de ferramentas.

#### Memory & Queue Workers

- **`RedisShortTermMemory`** — Armazenamento de curto prazo em Redis (`memory:short:{workspaceId}:{threadId}`).
- **`LLMMemoryExtractor`** — Extração estruturada de memórias via LLM com prompt de alta precisão e validação defensiva.
- **`MemoryPromotionWorker`** — Worker BullMQ em background que consome jobs da fila `memory-promotion`, extrai memórias, gera embeddings e salva no MongoDB sem bloquear a resposta ao usuário.
- **`BullMQAdapter`** — Producer BullMQ para filas `message-processing` e `memory-promotion`.
- **`BullMQWorker`** — Consumer BullMQ para processamento principal de mensagens.

#### Database

- **`MongoConnection`** — Singleton de conexão com MongoDB nativo.

### Repositories

Implementações concretas dos ports de repositório utilizando MongoDB:

| Repositório | Coleção | Operações |
|---|---|---|
| `MongoMemoryRepository` | `memories` | `save`, `saveBatch`, `searchRelevant` (busca semântica por cosseno e textual regex), `findByWorkspaceId`, `delete` |
| `ChatRepository` | `threads` | `findById`, `save` |
| `TenantRepository` | `tenants` | `findByWorkspaceId`, `save` |
| `UserRepository` | `users` | `findById`, `findByEmail`, `save`, `addWorkspaceId` |
| `SpaceMappingRepository` | `space_mappings` | `findBySpaceId`, `save` |
| `ChatConfigRepository` | `chat_configs` | `findByWorkspaceId`, `findByTeamId`, `save` (Criptografia AES-256-GCM) |
| `AgentRunRepository` | `agent_runs` | `save`, `findById`, `listByTenant`, `findByVersion` |
| `EvaluationRepository` | `evaluations` | `save`, `findByRunId`, `listByTenant`, `getVersionStats`, `getTenantSummary` |

### Use Cases

| Use Case | Descrição |
|---|---|
| `ProcessAgentResponseUseCase` | Fluxo principal do agente: resolve tenant via `spaceId`, delega execução ao `AgentHarness` e envia resposta ao chat. |
| `RegisterUserUseCase` | Cria um novo usuário. Valida unicidade do email e aplica `Password.create()` antes de persistir. |
| `LoginUserUseCase` | Valida credenciais e emite um JWT assinado com `jose` (HS256). Expõe `verify()` estático para o middleware. |
| `RegisterTenantUseCase` | Registra um novo tenant (workspace). Valida duplicidade de `workspaceId`. |
| `RegisterChatConfigUseCase` | Registra/atualiza as credenciais de um bot de chat (Slack) associadas a um tenant. |
| `GetChatConfigUseCase` | Recupera as configurações de bot de um tenant (sem expor segredos sensíveis na resposta da API). |
| `RegisterSpaceUseCase` | Registra um espaço do Google Chat e associa ao tenant via `workspaceId`. Exige que o tenant exista. |
| `AssociateTenantToUserUseCase` | Vincula um `workspaceId` de tenant a um usuário existente via `addWorkspaceId()`. |

---

## Camada de API (REST Reference)

A aplicação expõe uma API REST robusta sob o prefixo `/api`, organizada por domínio, com suporte a autenticação JWT, controle de acesso baseado em papéis (RBAC), auditoria estruturada e limitação de taxa por tenant.

> 📖 **Documentação Completa da API:** Para payloads detalhados de requisição/resposta, schemas JSON, códigos de status e exemplos via cURL, consulte o arquivo [docs/api.md](docs/api.md).

### Resumo dos Endpoints

| Categoria | Método | Rota | Autenticação & Autorização | Descrição |
|---|---|---|---|---|
| **Health** | `GET` | `/api/health` | Pública | Liveness probe do processo Node.js |
| **Health** | `GET` | `/api/health/ready` | Pública | Readiness probe (MongoDB + Redis pings) |
| **Auth** | `POST` | `/api/auth/register` | Pública | Registro de novos usuários |
| **Auth** | `POST` | `/api/auth/login` | Pública | Autenticação e emissão de JWT |
| **Onboarding** | `POST` | `/api/onboarding/tenant` | `ADMIN` + `auditLogger` | Cadastro de novos tenants/workspaces |
| **Onboarding** | `POST` | `/api/onboarding/space` | `ADMIN` + `auditLogger` | Mapeamento de Google Chat Space para Tenant |
| **Onboarding** | `POST` | `/api/onboarding/user/tenant` | `ADMIN` + `auditLogger` | Associação de tenant a usuário |
| **Chat Configs** | `POST` | `/api/chat-configs` | `ADMIN` + `rateLimiter` + `auditLogger` | Registro/atualização de credenciais de bot (Slack) |
| **Chat Configs** | `GET` | `/api/chat-configs/:workspaceId` | JWT + `tenantGuard` + `rateLimiter` | Consulta segura de configs (chaves mascaradas) |
| **Webhooks** | `POST` | `/api/webhook` | Verificação de token Google Chat | Recebimento de mensagens do Google Chat |
| **Webhooks** | `POST` | `/api/webhooks/slack/events` | HMAC-SHA256 Slack Signing Secret | Recebimento de eventos e menções do Slack |
| **Evaluations** | `GET` | `/api/evaluations/:runId` | `ADMIN` + `rateLimiter` + `auditLogger` | Resultado de avaliação de um run individual |
| **Evaluations** | `GET` | `/api/evaluations?tenantId=X` | `ADMIN` + `rateLimiter` + `auditLogger` | Listagem histórica paginada de avaliações |
| **Evaluations** | `GET` | `/api/evaluations/stats/:version` | `ADMIN` + `rateLimiter` + `auditLogger` | Estatísticas agregadas de uma versão |
| **Evaluations** | `GET` | `/api/evaluations/compare` | `ADMIN` + `rateLimiter` + `auditLogger` | Comparativo analítico entre versões (A vs B) |
| **Evaluations** | `GET` | `/api/evaluations/regression` | `ADMIN` + `rateLimiter` + `auditLogger` | Detecção automatizada de regressão de qualidade |
| **Evaluations** | `GET` | `/api/evaluations/summary/:tenantId` | `ADMIN` + `rateLimiter` + `auditLogger` | Visão executiva de qualidade do tenant |
| **Agent Runs** | `GET` | `/api/runs/:runId` | `ADMIN` + `rateLimiter` + `auditLogger` | Detalhes completos de execução (status, durações, tools, LLMs) |
| **Agent Runs** | `GET` | `/api/runs?tenantId=X` | `ADMIN` + `rateLimiter` + `auditLogger` | Listagem paginada e filtrada de execuções |
| **Agent Runs** | `GET` | `/api/runs/analytics/cost` | `ADMIN` + `rateLimiter` + `auditLogger` | Agregação financeira de custos e tokens por tenant |
| **Agent Runs** | `GET` | `/api/runs/analytics/tools` | `ADMIN` + `rateLimiter` + `auditLogger` | Estatísticas e taxa de sucesso por ferramenta/MCP |
| **Agent Runs** | `GET` | `/api/runs/analytics/llm` | `ADMIN` + `rateLimiter` + `auditLogger` | Estatísticas consolidadas por provedor e modelo LLM |
| **Metrics** | `GET` | `/metrics` | Opcional (`METRICS_TOKEN`) | Métricas em formato Prometheus (porta 9090 ou 3000) |

---

## Camada de Avaliação e Telemetria (Fase 2)

A **Camada de Avaliação e Telemetria** (Fase 2 do Roadmap) transforma o Support Agent em uma plataforma de IA observável, quantitativa e orientada a dados, medindo acurácia das respostas, consumo de tokens, custos operacionais e estabilidade entre releases.

### 1. Telemetria de Execuções e Custos (`AgentRun` & `CostCalculator`)
- **Entidade `AgentRun`**: Captura cada execução do `AgentHarness` com `runId`, tempos de início/conclusão, modelo, provedor, prompt tokens, completion tokens, etapas de execução de ferramentas e custo em USD.
- **Tabela de Precificação Multi-Provider**: O `CostCalculator` computa automaticamente o custo por run para os 4 provedores integrados:
  - **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, etc.
  - **Google Gemini:** `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`.
  - **Anthropic:** `claude-3-5-sonnet`, `claude-3-opus`, `claude-3-haiku`.
  - **DeepSeek:** `deepseek-chat`, `deepseek-coder`, `deepseek-reasoner`.
- **Persistência Assíncrona**: O `AgentRunRepository` grava os runs no MongoDB (`agent_runs`) com índices compostos otimizados (`tenantId + createdAt`, `version + createdAt`), sem penalizar a latência de entrega ao usuário final.

### 2. Worker de Auto-Avaliação e Pontuação Composta
- **Fila BullMQ `agent-evaluation`**: Ao concluir um run, um job assíncrono é despachado para a fila de avaliação.
- **`EvaluationWorker`**: Executa em background sob concorrência controlada. Utiliza o `SelfEvaluationPrompt` para avaliar analiticamente a resposta gerada.
- **Fórmula do Composite Score (`ScoreCalculator`)**:
  $$\text{Composite Score} = (0.35 \times \text{Correctness}) + (0.25 \times \text{Tool Accuracy}) + (0.20 \times (1 - \text{Hallucination})) + (0.20 \times \text{Context Relevance})$$
- Gera notas parciais, score composto (0.0 a 1.0), confiança estimada e penalidade por risco de alucinação.
- Os resultados são armazenados no MongoDB na coleção `evaluations` via `EvaluationRepository`.

### 3. Agregação, Comparação e Detecção de Regressão (`AggregationService`)
- **Pipelines Otimizadas**: Agregações com `$facet`, `$group` e `$match` para calcular médias de score, latência e custo por versão e tenant.
- **Comparação de Versões (`compareVersions`)**: Informa se a `versionB` é superior à `versionA` com deltas de qualidade, latência e custo.
- **Detecção de Regressão (`detectRegression`)**: Alerta imediatamente se uma nova versão apresentar queda superior a 10% no composite score ou aumento de 15% em alucinações em relação ao baseline.

---

## Camada de Agent Runs & Analytics (Fase 3)

A **Camada de Agent Runs, Cost & Analytics** (Fase 3 do Roadmap) transforma cada execução do agente em uma unidade observável, persistente e auditável, permitindo responder com precisão matemática a perguntas de custos operacionais e desempenho técnico.

### 1. Consulta Individual e Listagem Paginada
- **`GET /api/runs/:runId`**: Recupera todos os dados de uma execução (`status`, `durationMs`, `iterations`, `userMessage`, `finalResponse`, `toolCalls`, `llmCalls`, tokens e `costUsd`).
- **`GET /api/runs?tenantId=X`**: Lista histórica de execuções paginada e filtrada por `status` e intervalo de datas (`from` e `to`).

### 2. Análise Financeira e Consumo por Tenant
- **`GET /api/runs/analytics/cost`**: Consolida o total de runs executados, custo total e médio em USD, tokens totais/entrada/saída e latência média por tenant.
- Permite monitoramento granular de consumo multi-tenant e identificação imediata de contas com maior uso de recursos.

### 3. Analytics de Desempenho de Ferramentas / MCPs
- **`GET /api/runs/analytics/tools`**: Pipeline que desdobra as ferramentas invocadas (`$unwind: "$toolCalls"`), contabilizando:
  - Total de chamadas por tool/MCP.
  - Chamadas com sucesso vs falhas.
  - Taxa de sucesso (`successRate`, de 0 a 1.0).
  - Duração média em milissegundos (`avgDurationMs`).

### 4. Métricas de Consumo e Custo por Provedor/Modelo LLM
- **`GET /api/runs/analytics/llm`**: Agrupamento por `provider` e `model`, informando:
  - Volume de invocações.
  - Total de tokens de prompt e completion.
  - Custo financeiro consolidado em USD.
  - Latência média por requisição (`avgLatencyMs`).

---

## Observabilidade

### Coleta de Logs

A aplicação usa Pino como logger central. Em produção, os logs são emitidos em JSON no `stdout`, para coleta pelo runtime do container ou por um agente do cluster. Em desenvolvimento, a saída é formatada para leitura local.

Quando `LOKI_HOST` está configurada, os mesmos logs também são enviados ao Grafana Loki em lotes de 5 segundos, com os labels `app="support-agent"` e `environment="<NODE_ENV>"`. Falhas nesse envio não interrompem a aplicação nem removem os logs do `stdout`.

| Variável | Descrição | Padrão |
|---|---|---|
| `LOG_LEVEL` | Nível mínimo de log do Pino | `info` em produção; `debug` nos demais ambientes |
| `LOKI_HOST` | URL do endpoint Loki; habilita o envio remoto | Não definido |
| `LOKI_USER` | Usuário para autenticação básica no Loki | Não definido |
| `LOKI_PASSWORD` | Senha para autenticação básica no Loki | Não definido |

### Métricas Prometheus

O endpoint `GET /metrics` expõe métricas no formato Prometheus. Em processos Node executados com `src/index.ts`, ele está disponível no listener dedicado `http://<host>:9090/metrics`; a porta pode ser alterada com `METRICS_PORT`. A mesma rota também permanece disponível no servidor principal, em `http://<host>:<PORT>/metrics`.

| Métrica | Tipo | Labels | Descrição |
|---|---|---|---|
| Métricas padrão do Node.js | Vários | `app`, `environment` | CPU, memória, event loop e garbage collection |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Volume de requisições HTTP |
| `agent_runs_total` | Counter | `tenantId`, `status` | Total de execuções do Agent Harness |
| `agent_runs_failed_total` | Counter | `tenantId`, `reason` | Total de falhas na execução do Harness |
| `agent_run_duration_seconds` | Histogram | `tenantId`, `status` | Duração das execuções do Agent Harness |
| `agent_tool_calls_total` | Counter | `tenantId`, `tool` | Total de ferramentas executadas pelo Agent Harness |
| `agent_memory_search_duration_seconds` | Histogram | `tenantId`, `type` | Latência da consulta de memórias de longo prazo (vetorial/textual) |
| `agent_memory_promoted_total` | Counter | `tenantId`, `type` | Total de memórias de longo prazo promovidas e salvas |
| `agent_embedding_duration_seconds` | Histogram | `provider`, `model` | Duração das chamadas à API de geração de embeddings |
| `agent_evaluation_composite_score` | Gauge | `tenantId`, `version` | Pontuação composta de qualidade da resposta (0.0 a 1.0) |
| `agent_evaluation_confidence_avg` | Gauge | `tenantId`, `version` | Grau médio de confiança estimado da resposta gerada |
| `agent_evaluation_hallucination_avg` | Gauge | `tenantId`, `version` | Grau médio de risco de alucinação detectado |
| `agent_evaluation_runs_evaluated` | Counter | `tenantId`, `version` | Total de avaliações processadas pelo worker em background |

As rotas `/metrics`, `/api/health` e `/favicon.ico` não são contabilizadas nas métricas HTTP. As demais rotas usam o padrão do Express como label, evitando cardinalidade por URL dinâmica.

Defina `METRICS_TOKEN` para exigir o header `Authorization: Bearer <token>` durante o scrape:

```bash
curl http://localhost:9090/metrics
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:9090/metrics
```

Exemplo de configuração de scrape sem autenticação:

```yaml
scrape_configs:
  - job_name: support-agent
    static_configs:
      - targets: ["support-agent:9090"]
```

| Variável | Descrição | Padrão |
|---|---|---|
| `METRICS_PORT` | Porta do listener dedicado de métricas | `9090` |
| `METRICS_TOKEN` | Token Bearer opcional para proteger `GET /metrics` | Não definido |

### Tracing Distribuído (OpenTelemetry & Grafana Tempo)

A aplicação utiliza o **OpenTelemetry Node SDK** para rastreamento distribuído de ponta a ponta, exportando spans via **OTLP/HTTP** (protocolo protobuf) diretamente para o **Grafana Tempo** ou para um OpenTelemetry Collector intermediário.

#### Escopo do Rastreamento:
1. **Auto-Instrumentação de Infraestrutura:**
   - **Express / HTTP:** Rastreia latência de todas as rotas e requisições HTTP de entrada e saída.
   - **MongoDB & Redis (ioredis):** Spans automáticos para operações de banco e cache de memória de curto prazo.
2. **Spans Semânticos no Agent Harness & Memória:**
   - `agent.execute` — Span raiz do ciclo de vida da execução com atributos `app.tenant_id`, `app.workspace_id`, `app.thread_id`, `agent.run_id`, `agent.status` e `agent.iterations`.
   - `agent.long_term_memory.search` — Latência de consulta ao MongoDB, filtragem por similaridade de cosseno e quantidade de memórias retornadas.
   - `agent.context_assembly` — Latência de montagem e aplicação de token budgeting no contexto da conversa.
   - `agent.llm_call` — Duração de cada chamada de inferência ao LLM e contagem de iterações.
   - `agent.tool_execution:<tool_name>` — Tempo de execução e metadados de chamadas a ferramentas MCP.
   - `agent.short_term_memory.save` — Tempo de gravação do estado no Redis.
   - `embedding.generate` — Tempo de resposta e geração de vetores semânticos com atributos `embedding.model`, `embedding.provider` e `embedding.batch_size`.
3. **Propagação de Contexto em Filas (BullMQ):**
   - Injeção e extração transparente do cabeçalho padrão W3C (`traceparent`) no payload dos jobs.
   - `bullmq.process_job` — Worker principal de chat mantendo o `trace_id` de origem.
   - `bullmq.process_memory_promotion` — Worker de promoção assíncrona executando sob o mesmo trace da sessão de chat.
4. **Correlação Bidirecional (Trace ⇄ Log):**
   - O mixin do Pino injeta automaticamente `trace_id`, `span_id` e `trace_flags` em cada entrada de log. No Grafana, isso habilita a navegação com um clique entre o Grafana Tempo e o Grafana Loki.

| Variável | Descrição | Padrão |
|---|---|---|
| `OTEL_SERVICE_NAME` | Nome identificador do serviço nos traces | `support-agent` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Endpoint HTTP OTLP do Grafana Tempo ou OTEL Collector | `http://localhost:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers OTLP adicionais (ex.: autenticação no Grafana Cloud) | Não definido |
| `OTEL_LOG_LEVEL` | Nível de log de diagnóstico do OpenTelemetry SDK (`debug`, `info`) | `info` |
| `OTEL_ENABLED` | Força a ativação do tracing mesmo sem endpoint explícito | `false` |

---

## Autenticação, Autorização e Segurança (Fase 1)

O sistema utiliza **JWT (JSON Web Tokens)** assinados com HS256 via biblioteca [`jose`](https://github.com/panva/jose) (ESM-native), **hashing de senhas seguro via `crypto.scrypt`**, **RBAC (Role-Based Access Control)** e **isolamento multi-tenant estrito**.

### Modelo de Papéis (RBAC)

Definido no enum `Role`:
- `ADMIN`: Acesso total a cadastros de tenants, espaços e credenciais de bots.
- `OPERATOR`: Permissão para consultar configurações e operar workspaces atribuídos.
- `VIEWER`: Acesso somente leitura a dashboards e metadados.

### Fluxo de Autenticação & Hashing Seguro

```
POST /api/auth/login
  → valida email + senha (crypto.scrypt com salt aleatório de 16 bytes e timingSafeEqual)
  → re-hash automático transparente de senhas legadas (SHA-256) para scrypt
  → emite JWT com payload { sub, email, role, workspaceIds }
  → token expira conforme JWT_EXPIRES_IN (padrão: 8h)
```

### Middlewares de Segurança

- **`authMiddleware`**: Extrai e valida o Bearer token JWT injetando `req.user` (`sub`, `email`, `role`, `workspaceIds`). Retorna `401 Unauthorized` se inválido/ausente.
- **`requireRole(Role.ADMIN)`**: Garante que o usuário possua a role necessária para endpoints administrativos, retornando `403 Forbidden` caso contrário.
- **`tenantGuard('workspaceId')`**: Valida se o usuário pertence ao workspace solicitado na rota, impedindo ataques de acesso cruzado entre organizações (cross-tenant).
- **`auditLogger(action)`**: Registra operações administrativas no log estruturado com dados de contexto do usuário.
- **`tenantRateLimiter`**: Controla cota de 200 requisições a cada 15 minutos por tenant (ou fallback por IP).

### Criptografia de Segredos em Repouso

Credenciais sensíveis de integrações (como a `apiKey` de servidores MCP e `botToken` do Slack) são armazenadas no MongoDB de forma criptografada usando **AES-256-GCM com derivação de chave via HKDF** (`AESEncryptionService`), evitando exposição de segredos em texto puro.

### Variáveis de Ambiente

```env
JWT_SECRET=sua_chave_secreta_aqui   # mínimo 32 caracteres recomendado
JWT_EXPIRES_IN=8h                   # aceita: 8h | 1d | 7d | etc.
ENCRYPTION_KEY=sua_chave_hex_aqui   # 32 bytes (64 caracteres hex ou 32 ASCII)
```

---

## Onboarding

O fluxo de onboarding configura o agente para um novo cliente em 4 etapas independentes.

### Endpoints

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/auth/login` | Público | Autentica e retorna JWT |
| `POST` | `/api/onboarding/users` | Público | Cria usuário (sem tenant) |
| `POST` | `/api/onboarding/tenants` | Público | Registra tenant (workspace Google) |
| `POST` | `/api/onboarding/spaces` | Público | Registra espaço Google Chat |
| `POST` | `/api/onboarding/associate-tenant` | 🔒 JWT | Vincula tenant ao usuário autenticado |

### Fluxo Recomendado

```mermaid
sequenceDiagram
    participant Cliente
    participant API

    Cliente->>API: POST /onboarding/users<br/>{ name, email, password }
    API-->>Cliente: 201 { id }

    Cliente->>API: POST /auth/login<br/>{ email, password }
    API-->>Cliente: 200 { token }

    Cliente->>API: POST /onboarding/tenants<br/>{ workspaceId, llmConfig, mcpConfig }
    API-->>Cliente: 201 { workspaceId }

    Cliente->>API: POST /onboarding/spaces<br/>{ spaceId, workspaceId }
    API-->>Cliente: 201 { spaceId }

    Cliente->>API: POST /onboarding/associate-tenant<br/>Authorization: Bearer <token><br/>{ workspaceId }
    API-->>Cliente: 200 { message: "Tenant associated successfully." }
```

### Payloads de Exemplo

**Criar usuário**
```json
POST /api/onboarding/users
{
  "name": "Luis Felix",
  "email": "luis@empresa.com",
  "password": "senha123"
}
```

**Registrar tenant**
```json
POST /api/onboarding/tenants
{
  "workspaceId": "spaces/AAAAxxxx",
  "llmConfig": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  },
  "mcpConfig": {
    "url": "https://mcp.example.com",
    "apiKey": "mcp-key-..."
  }
}
```

**Registrar espaço Google Chat**
```json
POST /api/onboarding/spaces
{
  "spaceId": "spaces/AAAAxxxx",
  "workspaceId": "spaces/AAAAxxxx"
}
```

**Associar tenant ao usuário** *(requer Bearer token)*
```json
POST /api/onboarding/associate-tenant
Authorization: Bearer <jwt>

{
  "workspaceId": "spaces/AAAAxxxx"
}
```

### Respostas de Erro

| Código | Situação |
|---|---|
| `400` | Campos obrigatórios ausentes |
| `401` | Token JWT ausente ou inválido |
| `404` | Tenant ou usuário não encontrado |
| `409` | Email ou `workspaceId` já cadastrado |
| `500` | Erro interno |

---

## Gestão de Configurações de Chat (Multi-Tenant Slack)

O sistema permite cadastrar e consultar as credenciais de bots do Slack dinamicamente por tenant (`workspaceId`), garantindo isolamento completo de dados e criptografia em repouso.

### Endpoints

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/chat-configs` | Público | Cadastra ou atualiza as credenciais de bot de chat (Slack) |
| `GET` | `/api/chat-configs/:workspaceId` | Público | Consulta os metadados de configuração por `workspaceId` (sem expor segredos) |

### Cadastrar/Atualizar Configuração do Slack

```json
POST /api/chat-configs
{
  "workspaceId": "tenant-123",
  "provider": "slack",
  "teamId": "T01234567",
  "botToken": "xoxb-123456789-987654321-example",
  "appToken": "xapp-123456789-example",
  "signingSecret": "5ac624f5376600d692e2b161e1ea6275"
}
```

**Resposta de Sucesso (201):**
```json
{
  "message": "Configuração do Slack cadastrada com sucesso.",
  "config": {
    "workspaceId": "tenant-123",
    "provider": "slack",
    "teamId": "T01234567",
    "isActive": true,
    "botTokenConfigured": true,
    "appTokenConfigured": true,
    "signingSecretConfigured": true,
    "updatedAt": "2026-08-14T11:00:00.000Z"
  }
}
```

### Consultar Configuração por WorkspaceId

```http
GET /api/chat-configs/tenant-123?provider=slack
```

**Resposta de Sucesso (200):**
```json
{
  "workspaceId": "tenant-123",
  "provider": "slack",
  "teamId": "T01234567",
  "isActive": true,
  "botTokenConfigured": true,
  "appTokenConfigured": true,
  "signingSecretConfigured": true,
  "updatedAt": "2026-08-14T11:00:00.000Z"
}
```

---

## Multi-Tenant

Cada workspace do Google Chat é tratado como um **tenant independente**. As configurações de LLM (provedor, modelo, chave de API) e MCP (URL do servidor, chave de API) são armazenadas por tenant no MongoDB (coleção `tenants`).

### Estrutura do Documento Tenant

```json
{
  "workspaceId": "spaces/AAAAxxxx",
  "llmConfig": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  },
  "mcpConfig": {
    "url": "https://mcp.example.com",
    "apiKey": "..."
  },
  "isActive": true
}
```

- O campo `isActive` permite desativar o bot para um tenant sem remover seus dados
- O `ProcessAgentResponseUseCase` busca o tenant dinamicamente a cada requisição
- Provedores LLM e MCP são instanciados sob demanda — não há dependência fixa do container global

---

## Provedores LLM Suportados

| Provedor | Adapter | Modelo Padrão | Observações |
|---|---|---|---|
| **OpenAI** | `OpenAIAdapter` | `gpt-4o` | API oficial OpenAI |
| **DeepSeek** | `OpenAIAdapter` | `deepseek-chat` | Usa a mesma interface da OpenAI com `baseURL` customizada |
| **Anthropic** | `AnthropicAdapter` | `claude-3-5-sonnet` | Tratamento separado de system prompt + mapeamento de `tool_use` blocks |
| **Google** | — | — | Tipo declarado em `LLMConfig`, adapter ainda não implementado |

---

## Integração MCP

A comunicação com o servidor MCP segue o protocolo **JSON-RPC 2.0** sobre HTTP. Antes de qualquer operação, o cliente executa um **handshake de 3 etapas**:

```jsonc
// Etapa 1 — Client → Server: initialize (request com id)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "support-agent", "version": "1.0.0" }
  }
}

// Etapa 2 — Server → Client: resposta com capabilities e serverInfo

// Etapa 3 — Client → Server: notifications/initialized (notification sem id)
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

Após o handshake, as operações regulares podem ser executadas:

```jsonc
// Listar ferramentas
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }

// Executar ferramenta
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "query_loki_logs",
    "arguments": { "query": "{app=\"api\"}", "since_minutes": 30 }
  }
}
```

O adapter trata respostas de erro HTTP (401, 403, 429) e erros no nível JSON-RPC (`data.error`). Caso `listTools()` ou `executeTool()` sejam chamados sem `connect()` prévio, o adapter executa o handshake automaticamente.

### Descoberta Dinâmica de Ferramentas para LLMs

No fluxo de processamento de mensagens (`ProcessAgentResponseUseCase`), a busca por ferramentas disponíveis no servidor MCP é feita de forma inteiramente dinâmica:
1. O `ProcessAgentResponseUseCase` faz uma chamada ao `mcpClient.listTools()` para recuperar a lista de ferramentas declaradas pelo servidor MCP.
2. Essa lista de ferramentas (incluindo parâmetros em formato JSON Schema / `inputSchema`) é repassada para o método `generateResponse(context, tools)` do provedor de LLM correspondente (`OpenAIAdapter`, `GeminiAdapter` ou `AnthropicAdapter`).
3. Cada adaptador de LLM faz o mapeamento dinâmico das ferramentas para o formato proprietário do provedor correspondente (ex: `tools` no OpenAI, `functionDeclarations` no Gemini, e `tools` com `input_schema` no Anthropic).
4. Se nenhuma ferramenta for retornada pelo servidor MCP, os adaptadores omitem o campo de ferramentas na chamada da API da LLM, evitando erros comuns causados por arrays vazios de ferramentas.

### Resiliência e Tratamento de Timeouts

Para evitar que o agente fique travado ("mudo") durante execuções de longa duração ou diante de quedas bruscas de conexão do servidor MCP, o sistema adota as seguintes estratégias:

1. **Timeout do Cliente MCP (`Promise.race`)**:
   - Um timeout (padrão de `25s`, configurável via construtor) foi implementado para todas as requisições JSON-RPC via POST. Caso o servidor não responda a tempo, a promessa é rejeitada e uma exceção de tempo limite é lançada.
2. **Reutilização de Conexões (Cache de Adaptadores)**:
   - Para evitar reconexões e handshakes frequentes a cada mensagem do webhook, o `ProcessAgentResponseUseCase` mantém um cache de instâncias de `MCPHttpAdapter` com base na configuração do Tenant. A conexão SSE permanece aberta em segundo plano para reutilização.
3. **Auto-reconexão robusta**:
   - O `MCPHttpAdapter` monitora ativamente o encerramento do stream SSE. Caso a conexão SSE seja encerrada pelo servidor (por inatividade ou reinicialização do proxy), a leitura do stream é finalizada, e o estado interno do adapter é redefinido para não-inicializado (`initialized = false`). No próximo request, o handshake é efetuado novamente de forma automática e transparente.
4. **Rejeição Automática ao Fechar Stream**:
   - Ao detectar o encerramento prematuro da conexão SSE, todas as promessas pendentes no mapa `pendingRequests` são imediatamente rejeitadas, impedindo vazamentos de memória e travamento indefinido do fluxo de execução.
5. **Tratamento de Exceções no Use Case**:
   - A chamada `mcpClient.executeTool` dentro do `ProcessAgentResponseUseCase` é envolvida por um bloco `try-catch`.
   - Se a execução falhar ou estourar o timeout de 25s, o erro é capturado e enviado de volta no histórico da conversa como uma mensagem de sistema (`system`). O LLM é acionado de novo com esse contexto de erro, podendo explicar a falha para o usuário ou tentar caminhos alternativos de resposta, mantendo o agente sempre ativo.
6. **Loop Iterativo de Ferramentas (máximo 5 iterações)**:
   - O `ProcessAgentResponseUseCase` agora suporta até 5 chamadas consecutivas de ferramentas em um único fluxo de processamento. A cada iteração, o resultado da ferramenta é adicionado ao contexto e o LLM é consultado novamente. Se o limite for atingido, uma mensagem de sistema instrui o LLM a resumir os dados coletados e fornecer uma resposta ao usuário.
   - Isso resolve o cenário onde o LLM precisava de múltiplas consultas (ex: buscar logs no Loki, depois buscar métricas) mas a resposta era silenciosamente descartada na segunda iteração.
7. **Timeout Estendido de Fila (QStash)**:
   - Adicionamos o cabeçalho `'Upstash-Timeout': '90s'` no envio de mensagens de fila para o QStash. Isso garante que o Upstash não encerre prematuramente a conexão HTTP com o worker local antes de a chamada da ferramenta (25s) e a re-análise do LLM terem finalizado.

---

## Integração Slack

O Support Agent suporta o **Slack** como plataforma de chat. A integração utiliza a [Slack Events API](https://api.slack.com/events) para receber mensagens e a [Web API](https://api.slack.com/web) (`chat.postMessage`) para enviar respostas.

### Segurança — Verificação de Assinatura

Todo request do Slack inclui o header `x-slack-signature` (HMAC-SHA256). O `SlackWebhookController` valida esse header usando o `SLACK_SIGNING_SECRET` antes de processar qualquer evento:

```
Sig base string: "v0:{timestamp}:{rawBody}"
HMAC-SHA256 → comparação com timingSafeEqual (anti timing-attack)
Timestamp > 5 min → rejeitado (anti replay-attack)
```

### Endpoint

```
POST /api/slack/events
```

### Fluxo de Eventos

| Tipo de evento | Comportamento |
|---|---|
| `url_verification` | Responde com `{ challenge }` imediatamente (instalação do app) |
| `event_callback` com `message` | Valida assinatura → filtra bots → enfileira no BullMQ |
| Mensagem com `bot_id` ou `subtype: bot_message` | Ignorada (evita loops) |

### Convenção de `threadId`

A interface `IChatProvider.sendMessage(threadId, content)` é agnóstica à plataforma. Para o Slack, `threadId` é codificado como `"CHANNEL_ID:thread_ts"` pelo controller e decodificado pelo adapter ao enviar.

### Como Configurar o App no Slack

1. Acesse [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. Em **Event Subscriptions**, habilite e defina a **Request URL**: `https://<seu-dominio>/api/slack/events`
3. Adicione o evento `message.channels` (canais) ou `message.im` (DMs)
4. Em **OAuth & Permissions**, adicione o scope `chat:write` e instale o app
5. Copie o **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
6. Em **Basic Information > App Credentials**, copie o **Signing Secret** → `SLACK_SIGNING_SECRET`

### Variáveis de Ambiente

```env
SLACK_BOT_TOKEN=xoxb-...          # Bot token (começa com xoxb-)
SLACK_SIGNING_SECRET=...           # Signing Secret do app
```

### Troubleshooting — `challenge_failed` no Event Subscriptions

Ao cadastrar a **Request URL** no painel do Slack, o Slack envia um POST com o seguinte body para verificar o endpoint:

```json
{
  "type": "url_verification",
  "token": "...",
  "challenge": "..."
}
```

O endpoint deve responder imediatamente com `{ "challenge": "<valor>" }`. Se o Slack retornar o erro `challenge_failed` com o body da resposta vazio `{}`, a causa mais comum em deploys na **Vercel** é o **body parser automático da plataforma**.

**Causa raiz:** A Vercel consome o stream do body da requisição antes de repassar o request ao handler Express. Com o stream já lido, o `express.json()` não consegue parsear o body, fazendo com que `req.body` fique `{}`. Sem o body, o `SlackWebhookController` não identifica `payload.type === 'url_verification'` e falha em retornar o `challenge`.

**Correção aplicada em `api/index.ts`:**

```typescript
// Desabilita o body parser automático da Vercel.
// Sem isso, req.body fica {} e o url_verification falha com challenge_failed.
export const config = {
    api: {
        bodyParser: false,
    },
};

export default app;
```

Isso garante que o `express.json()` (configurado em `app.ts` com o callback `verify` que captura `req.rawBody`) seja o único responsável pelo parsing — necessário tanto para o `url_verification` quanto para a validação de assinatura HMAC-SHA256 dos eventos subsequentes.

---

## Fluxo de Processamento

```mermaid
sequenceDiagram
    participant User as Usuário
    participant Chat as ChatProvider
    participant UC as ProcessAgentResponse
    participant Harness as AgentHarness
    participant MCP as MCP Server
    participant LLM as LLM Provider
    participant Queue as BullMQ (memory-promotion)

    User->>Chat: Envia mensagem
    Chat->>UC: execute(workspaceId, threadId, text)
    UC->>Harness: run(input)
    
    rect rgb(240, 248, 255)
        Note over Harness: 1. Busca Memórias Semânticas (MongoDB + Cosine)
        Note over Harness: 2. Context Assembly com Token Budgeting
    end

    Harness->>LLM: generateResponse(context, tools)
    
    loop Até 5 iterações (enquanto LLM retornar tool_call)
        LLM-->>Harness: { type: 'tool_call', tool }
        Harness->>MCP: executeTool(tool)
        MCP-->>Harness: resultado da ferramenta
        Harness->>Harness: Adiciona resultado ao contexto (role: system)
        Harness->>LLM: generateResponse(context atualizado, tools)
    end
    
    LLM-->>Harness: { type: 'text', content }
    Harness->>Harness: Salva Short-Term Memory (Redis)
    Harness-->>Queue: dispatchMemoryPromotion (Assíncrono)
    Harness-->>UC: AgentRunResult (resposta final)
    UC->>Chat: sendMessage(threadId, content)
    Chat-->>User: Resposta do agente
```

---

## Stack Tecnológica

| Tecnologia | Versão | Função |
|---|---|---|
| **TypeScript** | 6.x | Linguagem principal |
| **Node.js** | ≥ 20 | Runtime (ESM nativo) |
| **OpenAI SDK** | ^6.45.0 | Client para APIs compatíveis com OpenAI e Embeddings |
| **Anthropic SDK** | ^0.110.0 | Client para API da Anthropic |
| **google-auth-library** | ^10.9.0 | Autenticação OAuth2 para Google APIs |
| **Express** | ^5.2.1 | Framework HTTP |
| **helmet** | ^8.2.0 | Segurança HTTP (headers) |
| **cors** | ^2.8.6 | Liberação de CORS |
| **dotenv** | ^17.4.2 | Variáveis de ambiente em dev |
| **MongoDB Driver** | ^7.4.0 | Driver nativo MongoDB para persistência de threads, tenants e memórias |
| **jose** | ^6.x | JWT ESM-native (assinar e verificar tokens HS256) |
| **BullMQ** | ^5.80.2 | Gerenciamento de filas baseado em Redis para chat e promoção de memória |
| **Redis** | — | Backend de filas do BullMQ e Short-Term Memory (ioredis) |
| **Tiktoken** | ^1.0.20 | Contagem precisa de tokens (BPE / ChatML) |
| **@opentelemetry/sdk-node** | ^0.221.0 | OpenTelemetry Node.js SDK central |
| **@opentelemetry/auto-instrumentations-node** | ^0.79.0 | Auto-instrumentações de HTTP, DB e Redis |
| **@opentelemetry/exporter-trace-otlp-http** | ^0.221.0 | Exportador OTLP via HTTP para Grafana Tempo |
| **tsx** | ^4.23.0 | Execução direta de TypeScript em dev |
| **Vitest** | ^4.1.10 | Runner de testes unitários e de integração |
| **@vitest/coverage-v8** | ^4.1.10 | Relatório de cobertura de código |

### Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Desenvolvimento com hot-reload (`tsx watch src/index.ts`) |
| `npm run build` | Compilação TypeScript (`tsc`) |
| `npm start` | Execução do build compilado (`node dist/index.js`) |
| `npm test` | Executa testes unitários e de integração (`vitest run`) |
| `npm run test:watch` | Modo watch (`vitest`) |
| `npm run test:coverage` | Relatório de cobertura (`vitest run --coverage`) |

---

## Testes

O projeto utiliza **Vitest** como framework de testes. Os testes estão organizados lado a lado com o código-fonte (`*.test.ts`) seguindo o padrão de co-locação.

### Cobertura e Suite Atual

| Camada / Componente | Arquivos testados | Testes |
|---|---|---|
| **Domínio** | `Password`, `ChatConfig` | 16 |
| **Agent Harness & Context** | `AgentHarness`, `ContextAssembler`, `AgentHarness.integration` (E2E) | 9 |
| **Memória & Embeddings** | `MongoMemoryRepository`, `RedisShortTermMemory`, `LLMMemoryExtractor`, `OpenAIEmbeddingProvider` | 20 |
| **Filas & Workers** | `BullMQAdapter`, `BullMQWorker`, `MemoryPromotionWorker` | 9 |
| **Infraestrutura & LLM** | `GoogleChatAdapter`, `SlackChatAdapter`, `ChatProviderFactory`, `MCPHttpAdapter`, `GeminiAdapter`, `TiktokenAdapter` | 28 |
| **Tracing & Context** | `TraceContext`, `TracerProvider` | 6 |
| **Controllers & Middlewares** | `SlackWebhookController`, `ChatConfigController`, `rateLimiter` | 16 |
| **Use Cases** | Todos os 8 use cases | 37 |
| **Total** | **32 arquivos** | **161 testes (100% passing)** |

### Estrutura

```
src/
├── domain/
│   ├── ChatConfig.test.ts
│   └── Password.test.ts
├── harness/
│   ├── AgentHarness.test.ts
│   ├── AgentHarness.integration.test.ts # Fluxo ponta a ponta com busca vetorial
│   └── ContextAssembler.test.ts
├── infrastructure/
│   ├── chat/
│   │   ├── ChatProviderFactory.test.ts
│   │   ├── GoogleChatAdapter.test.ts
│   │   └── SlackChatAdapter.test.ts
│   ├── llm/
│   │   ├── GeminiAdapter.test.ts
│   │   └── OpenAIEmbeddingProvider.test.ts
│   ├── mcp/
│   │   └── MCPHttpAdapter.test.ts
│   ├── memory/
│   │   ├── LLMMemoryExtractor.test.ts
│   │   └── RedisShortTermMemory.test.ts
│   ├── queue/
│   │   ├── BullMQAdapter.test.ts
│   │   ├── BullMQWorker.test.ts
│   │   └── MemoryPromotionWorker.test.ts
│   └── tracing/
│       ├── TraceContext.test.ts
│       └── TracerProvider.test.ts
├── repositories/
│   ├── ChatConfigRepository.test.ts
│   └── MongoMemoryRepository.test.ts
├── controllers/
│   ├── ChatConfigController.test.ts
│   └── SlackWebhookController.test.ts
└── usecases/
    ├── AssociateTenantToUserUseCase.test.ts
    ├── GetChatConfigUseCase.test.ts
    ├── LoginUserUseCase.test.ts
    ├── ProcessAgentResponseUseCase.test.ts
    ├── RegisterChatConfigUseCase.test.ts
    ├── RegisterSpaceUseCase.test.ts
    ├── RegisterTenantUseCase.test.ts
    └── RegisterUserUseCase.test.ts
```

### Práticas

- **Mocks**: repositórios mockados com `vi.fn()`, HTTP global mockado com `vi.stubGlobal('fetch', ...)`, JWT testado com `process.env` temporário
- **Isolamento**: sem dependência de banco de dados ou serviços externos
- **Factory functions**: funções reutilizáveis (`makeUserRepo`, `makeTenantRepo`, etc.) para criar mocks tipados
- **Cobertura**: configurada com `@vitest/coverage-v8` nos diretórios `usecases`, `infrastructure`, `harness` e `domain`

### CI/CD

O pipeline do **GitHub Actions** (`.github/workflows/ci-cd.yml`) executa duas etapas:

1. **Testes unitários e de integração** — `npm test` em todo PR para a branch `dev`
2. **Build & Push Docker** — Constrói a imagem Docker multi-stage e publica no Docker Hub com as tags `latest` e o SHA do commit (apenas em push para `dev`, após testes passarem)

---

## Pré-requisitos

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- **MongoDB** ≥ 6.x (local ou Atlas) — para persistência de conversas, memórias e tenants
- **Redis** ≥ 7.x — backend de filas do BullMQ e memória de curto prazo
- Chaves de API para pelo menos um provedor LLM (OpenAI, Anthropic ou DeepSeek)
- URL de um servidor MCP ativo (para integração com ferramentas)
- Google Cloud service account com escopo `chat.messages.create` (para Google Chat)
- Token de API do **QStash (Upstash)** e URL pública de um worker (opcional, para fila legada)

---

## Instalação e Execução

```bash
# Clonar o repositório
git clone https://github.com/luisfelix-93/support-agent support-agent
cd support-agent

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# (Edite o arquivo .env com suas chaves)

# Iniciar servidor local
npm run dev
```

### Execução com Docker

```bash
# Construir a imagem
docker build -t support-agent .

# Executar o container
docker run -p 3000:3000 -p 9090:9090 --env-file .env support-agent
```

O Dockerfile usa **build multi-stage** para reduzir o tamanho da imagem final (~130 MB), com três estágios: `builder` (compilação TypeScript), `runner-deps` (dependências de produção) e `runner` (imagem final Alpine).

---

## Configuração e Injeção de Dependências

O sistema utiliza um **Composition Root** (`src/config/container.ts`) para injetar todas as dependências automaticamente usando variáveis de ambiente. Você não precisa instanciar os adapters manualmente.

As configurações são carregadas via `dotenv` no ambiente local, e injetadas pela Vercel no ambiente de produção.

Variáveis essenciais (`.env`):
- `PORT`: Porta do servidor local (ex: 3000)
- `METRICS_PORT`: Porta do listener dedicado de métricas (padrão: `9090`)
- `METRICS_TOKEN`: Token Bearer opcional exigido em `GET /metrics`
- `LOG_LEVEL`: Nível mínimo de logs (`info` em produção e `debug` nos demais ambientes)
- `LOKI_HOST`, `LOKI_USER` e `LOKI_PASSWORD`: Endpoint e credenciais opcionais para envio de logs ao Grafana Loki
- `MONGODB_URI` e `MONGODB_DB_NAME`: Conexão com MongoDB
- `REDIS_URL`: String de conexão com Redis (ex: `redis://localhost:6379`) — usado pelo BullMQ e Short-Term Memory
- `START_WORKER`: Habilita os workers BullMQ na inicialização (`true`/`false`, padrão: `true`)
- `QUEUE_CONCURRENCY`: Número de jobs processados em paralelo pelo worker principal (padrão: `5`)
- `MEMORY_WORKER_CONCURRENCY`: Concorrência do worker de promoção de memória (padrão: `2`)
- `LONG_TERM_MEMORY_ENABLED`: Habilita o subsistema de memória de longo prazo (`true`/`false`, padrão: `true`)
- `VECTOR_MEMORY_ENABLED`: Habilita a busca vetorial semântica por cosseno (`true`/`false`, padrão: `true`)
- `OPENAI_EMBEDDING_API_KEY`: Chave de API para geração de embeddings da OpenAI
- `OPENAI_EMBEDDING_MODEL`: Modelo de embeddings (padrão: `text-embedding-3-small`)
- `MCP_SERVER_URL` e `MCP_API_KEY`: Comunicação com o servidor MCP
- `LLM_PROVIDER`, `LLM_API_KEY` e `LLM_MODEL`: Configurações de LLM principal
- `JWT_SECRET`: Chave secreta para assinar tokens JWT (mínimo 32 caracteres recomendado)
- `JWT_EXPIRES_IN`: Tempo de expiração do token (ex: `8h`, `1d`, `7d`)
- `ENCRYPTION_KEY`: Chave secreta de 32 bytes (64 caracteres hex ou 32 ASCII) para criptografia AES-256-GCM dos tokens de chat em repouso
- `SLACK_BOT_TOKEN`: Bot token global/fallback do app Slack (começa com `xoxb-`)
- `SLACK_SIGNING_SECRET`: Signing secret global/fallback para validação de assinatura HMAC-SHA256

A arquitetura foi adaptada para rodar de forma stateless via **Vercel Serverless Functions**. O request cycle é tratado no Express (`src/app.ts`), que é servido localmente via `src/index.ts` e exportado para a Vercel através de `api/index.ts`.

---

## Resiliência e Confiabilidade (Reliability Core)

O Support Agent implementa múltiplos mecanismos para garantir que falhas em dependências externas (como MCP, LLMs ou redes) não comprometam a estabilidade do sistema:

### 1. Circuit Breaker (`CircuitBreaker.ts`)
- Protege chamadas para ferramentas MCP e integrações externas.
- Estados: `CLOSED` (operação normal), `OPEN` (bloqueia chamadas após 5 falhas consecutivas e aciona fallback) e `HALF_OPEN` (testa recuperação após 30 segundos).
- Emite métricas Prometheus (`circuit_breaker_state`, `circuit_breaker_failures_total`).

### 2. Retry Policy com Exponential Backoff & Jitter (`RetryPolicy.ts`)
- Executa retentativas automáticas exclusivamente para falhas transitórias (HTTP 502, 503, 504, erros de rede `ECONNRESET`, `ETIMEDOUT`).
- Aplica atraso exponencial com variação aleatória (*jitter*) para evitar contenção e avalanches (*thundering herd*).
- Não retenta requisições com erros 4xx de cliente.

### 3. Idempotência de Webhooks (`IdempotencyGuard.ts`)
- Deduplica eventos de webhooks do Slack e Google Chat via Redis (`SET NX EX`) com TTL automático.
- Geração de `jobId` determinístico na fila do BullMQ combinando hash dos dados da mensagem com bucket de 5 segundos.

### 4. Timeouts Globais e Fallback no Runtime (`AgentHarness.ts`)
- Timeout por run do agente (`maxRunTimeMs: 120s`) usando `AbortController`.
- Timeout por chamada LLM (`llmTimeoutMs: 60s`).
- Em caso de abertura do Circuit Breaker ou falha persistente nas tools, o harness recorre a um fallback inteligente respondendo diretamente via LLM com aviso amigável.

---

## Saúde Operacional e Ciclo de Vida (Operational Readiness)

### Probes de Saúde (Liveness & Readiness)
- **`GET /api/health`**: Liveness probe leve e rápido. Retorna `200 OK` informando que o processo Node.js está em execução.
- **`GET /api/health/ready`**: Readiness probe para orquestradores (Kubernetes/Docker). Testa ativamente os pings de MongoDB e Redis:
  - HTTP `200 OK` quando ambas as dependências estiverem disponíveis (`{ "status": "ready", "checks": { "mongodb": "ok", "redis": "ok" } }`).
  - HTTP `503 Service Unavailable` caso qualquer serviço crítico esteja inacessível (`{ "status": "degraded", ... }`).

### Graceful Shutdown
Tratamento gracioso para `SIGTERM` e `SIGINT` em `src/index.ts`:
1. Encerramento dos servidores HTTP (bloqueia novas requisições).
2. Parada e drenagem ordenada dos workers BullMQ (conclui jobs em andamento sem perda de estado).
3. Flush e encerramento do tracing OpenTelemetry.
4. Fechamento seguro da conexão com o Redis.
5. Fechamento do pool de conexões do MongoDB.
6. Safety timeout de 30 segundos com encerramento forçado para evitar processos travados.

### Hardening do Docker
O [Dockerfile](Dockerfile) segue padrões recomendados de segurança e observabilidade:
- Execução com usuário não-privilegiado `node` (`USER node`).
- `STOPSIGNAL SIGTERM` para integração direta com orquestradores.
- Instrução `HEALTHCHECK` periódica consultando o endpoint `/api/health`.

---

## Status do Projeto

> 🚀 **Fase 3 (Agent Runs, Cost & Analytics) Concluída com Sucesso!**  
> Consulte o relatório detalhado em [docs/phase3-summary.md](docs/phase3-summary.md), a especificação completa da API em [docs/api.md](docs/api.md) e o [Roadmap](docs/roadmap.md).  
> Para a Fase 2 (Agent Evaluation), consulte [docs/phase2-summary.md](docs/phase2-summary.md).  
> Para a Fase 1 (Production Hardening), consulte [docs/phase1-production-hardening-summary.md](docs/phase1-production-hardening-summary.md).

| Componente / Funcionalidade | Status |
|---|---|
| Entidades de domínio & Value Objects | ✅ Implementado |
| Hashing de Senhas scrypt & Timing-Safe (`Password.ts`) | ✅ Implementado (Fase 1A) |
| Papéis & RBAC (`Role.ts` / `requireRole.ts`) | ✅ Implementado (Fase 1A) |
| Auditoria de Operações Administrativas (`auditLogger.ts`) | ✅ Implementado (Fase 1A) |
| Isolamento de Tenant (`tenantGuard.ts`) | ✅ Implementado (Fase 1B) |
| Criptografia de Segredos com HKDF + AES-256-GCM | ✅ Implementado (Fase 1B) |
| Circuit Breaker com Métricas Prometheus (`CircuitBreaker.ts`) | ✅ Implementado (Fase 1C) |
| Retry Policy com Exponential Backoff & Jitter (`RetryPolicy.ts`) | ✅ Implementado (Fase 1C) |
| Idempotência de Webhooks & Job IDs Determinísticos | ✅ Implementado (Fase 1C) |
| Timeouts Globais & Fallback Gracioso no Harness | ✅ Implementado (Fase 1C) |
| Health Checks Liveness & Readiness (`HealthChecker.ts`) | ✅ Implementado (Fase 1D) |
| Graceful Shutdown em 7 Etapas com Timeout 30s | ✅ Implementado (Fase 1D) |
| Rate Limiting por Tenant (`tenantRateLimiter`) | ✅ Implementado (Fase 1D) |
| Docker Hardening (Non-root `node`, STOPSIGNAL, HEALTHCHECK) | ✅ Implementado (Fase 1D) |
| Agent Harness Runtime (`IAgentHarness`) | ✅ Implementado |
| ContextAssembler (Token Budgeting BPE/ChatML) | ✅ Implementado |
| Short-Term Memory com Redis (`memory:short:*`) | ✅ Implementado |
| Long-Term Memory no MongoDB (`MongoMemoryRepository`) | ✅ Implementado |
| Busca Semântica Vetorial por Cosseno | ✅ Implementado |
| OpenAIEmbeddingProvider (`text-embedding-3-small` / 1536d) | ✅ Implementado |
| Promoção Assíncrona de Memória (`MemoryPromotionWorker` BullMQ) | ✅ Implementado |
| Provedores LLM (OpenAI, Anthropic, DeepSeek, Google) | ✅ Implementado |
| MCP HTTP Adapter (JSON-RPC 2.0) | ✅ Implementado |
| Chat Adapters (Google Chat & Slack multi-tenant dinâmico) | ✅ Implementado |
| Tracing OpenTelemetry & Grafana Tempo (spans semânticos) | ✅ Implementado |
| Métricas Prometheus completas (`/metrics`) | ✅ Implementado |
| **Telemetria de Execuções e Custos (`AgentRun.ts` / `CostCalculator.ts`)** | ✅ Implementado (Fase 2A) |
| **Worker de Auto-Avaliação & Composite Score (`EvaluationWorker.ts` / `ScoreCalculator.ts`)** | ✅ Implementado (Fase 2B) |
| **Agregação, Comparação e Detecção de Regressão (`AggregationService.ts`)** | ✅ Implementado (Fase 2C) |
| **API REST de Avaliações com RBAC (`evaluationRouter.ts` / `EvaluationController.ts`)** | ✅ Implementado (Fase 2D) |
| **Métricas Prometheus de Avaliação (`EvaluationMetrics.ts`)** | ✅ Implementado (Fase 2D) |
| **Pipelines de Agregação Analítica no MongoDB (`AgentRunRepository.ts`)** | ✅ Implementado (Fase 3A) |
| **Serviço Analítico de Domínio (`RunAnalyticsService.ts`)** | ✅ Implementado (Fase 3B) |
| **API REST Administrativa de Runs e Custos (`agentRunRouter.ts` / `AgentRunController.ts`)** | ✅ Implementado (Fase 3C) |
| **Relatório de Conclusão da Fase 3 e Documentação (`phase3-summary.md` / `api.md`)** | ✅ Implementado (Fase 3D) |
| **Suíte de Testes Automatizados (370 testes passing / 100% sucesso em 58 arquivos)** | ✅ Implementado |
| Pipeline CI/CD & Docker Hub Build | ✅ Implementado |

---

## Licença

ISC


