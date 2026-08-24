# Support Agent

Agente de suporte inteligente baseado em LLMs (Large Language Models) com integração ao protocolo MCP (Model Context Protocol) para execução dinâmica de ferramentas. O sistema segue princípios de **Clean Architecture / Hexagonal Architecture** para garantir desacoplamento entre a lógica de negócio e os provedores de infraestrutura.

---

## Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Camada Agent Harness (Runtime)](#camada-agent-harness-runtime)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Camadas](#camadas)
  - [Domain](#domain)
  - [Harness Layer](#harness-layer)
  - [Ports (Interfaces)](#ports-interfaces)
  - [Infrastructure](#infrastructure)
  - [Repositories](#repositories)
  - [Use Cases](#use-cases)
- [API Layer](#api-layer)
- [Observabilidade](#observabilidade)
- [Autenticação e Autorização (JWT)](#autenticação-e-autorização-jwt)
- [Onboarding](#onboarding)
- [Multi-Tenant](#multi-tenant)
- [Provedores LLM Suportados](#provedores-llm-suportados)
- [Integração MCP](#integração-mcp)
- [Integração Slack](#integração-slack)
- [Fluxo de Processamento](#fluxo-de-processamento)
- [Stack Tecnológica](#stack-tecnológica)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Status do Projeto](#status-do-projeto)

---

## Visão Geral

O **Support Agent** é um bot de atendimento que atua como intermediário entre o usuário final e sistemas internos. Ele utiliza LLMs para interpretar perguntas em linguagem natural e, quando necessário, invoca ferramentas externas via MCP para buscar dados concretos (logs, base de conhecimento, etc.) antes de formular uma resposta final.

**Principais capacidades:**

- 🤖 Processamento de linguagem natural via múltiplos provedores de LLM
- ⚡ **Agent Harness Layer**: Runtime desacoplado (`IAgentHarness`) que gerencia o loop iterativo LLM ↔ MCP, tratamento de resiliência e medições de execução com `runId` único
- 🧠 **Short-Term Memory**: Cache de contexto de sessão em Redis (`memory:short:{workspaceId}:{threadId}`) com TTL configurável
- 📊 **Token Budgeting & Assembly**: Montagem explícita de contexto com contagem precisa de tokens (`ITokenCounter`) e truncagem inteligente
- 🔧 Descoberta e execução dinâmica de ferramentas via MCP (JSON-RPC 2.0)
- 📊 Observabilidade nativa via Prometheus, Grafana Loki e Tracing Distribuído com Grafana Tempo (OpenTelemetry)
- 💬 Suporte multi-plataforma de chat: **Google Chat** e **Slack** prontos para uso

---

## Arquitetura

O projeto adota uma arquitetura hexagonal (Ports & Adapters), com uma **Camada Harness desacoplada** para o runtime de execução agentic:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Use Cases                                      │
│                     ProcessAgentResponseUseCase                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ (Delega execução ao Runtime Harness)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Harness Layer                               │
│           AgentHarness  ──► ContextAssembler ──► ExecutionPolicy            │
│                                  │                                          │
│                                  ▼                                          │
│                         TiktokenAdapter (BPE)                               │
└───────────┬──────────────────────┬───────────────────────┬──────────────────┘
            │                      │                       │
      ┌─────▼───────┐        ┌─────▼──────┐          ┌─────▼─────────┐
      │ ILLMProvider│        │ IMCPClient │          │IShortTermMem. │
      └─────┬───────┘        └─────┬──────┘          └─────┬─────────┘
            │                      │                       │
      ┌─────▼───────┐        ┌─────▼──────┐          ┌─────▼─────────┐
      │   OpenAI    │        │    MCP     │          │  Redis STM    │
      │   Adapter   │        │   HTTP     │          │  (ioredis)    │
      ├─────────────┤        │  Adapter   │          └───────────────┘
      │  Anthropic  │        └────────────┘
      │   Adapter   │
      ├─────────────┤
      │   DeepSeek  │
      └─────────────┘
```

---

## Camada Agent Harness (Runtime)

A **Camada Agent Harness** é o motor de execução do agente. Ela abstrai e orquestra o ciclo iterativo entre o provedor de LLM (`ILLMProvider`) e o servidor MCP (`IMCPClient`), retirando essa responsabilidade do UseCase e promovendo alta testabilidade, observabilidade e gerenciamento de estado de curto prazo.

### Por que um Harness?

Antes da introdução da camada de Harness, a lógica do ciclo `while(tool_call)` ficava acoplada diretamente no `ProcessAgentResponseUseCase`. A arquitetura com Harness traz:

1. **Desacoplamento do UseCase**: O `ProcessAgentResponseUseCase` lida apenas com a resolução de infraestrutura (busca tenant, recupera histórico do banco e envia mensagem ao chat), enquanto a execução agentic fica sob responsabilidade do `IAgentHarness`.
2. **Short-Term Memory (Redis)**: As iterações intermediárias da conversa (chamadas e respostas de ferramentas) são mantidas em um cache de memória de curto prazo com TTL configurável em Redis (`memory:short:{workspaceId}:{threadId}`), otimizando o acesso durante a sessão sem sobrecarregar o MongoDB.
3. **Token Budgeting (Orçamento de Tokens)**: Garantia estrita de que o contexto enviado para o LLM nunca ultrapassa a janela de contexto permitida (`maxTokens`), utilizando contagem de tokens baseada em BPE/ChatML (`TiktokenAdapter`).
4. **Resiliência e Recuperação de Erros**: Se uma ferramenta MCP falhar ou estourar tempo limite, o erro é injetado como mensagem de contexto para o LLM. Se o número limite de iterações for atingido, o Harness intercepta e exige uma resposta final de síntese.
5. **Observabilidade Granular**: Cada execução gera um `runId` único (UUID v4) que é injetado nos logs estruturados do Pino/Loki, além de incrementar contadores e histogramas no Prometheus.

### Componentes Principais

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             AgentHarness                                 │
│  - Controla o loop iterativo LLM ↔ MCP                                   │
│  - Atribui runId e mede duração da execução                              │
│  - Captura erros de ferramentas como contexto                            │
│  - Armazena histórico recente na Short-Term Memory                        │
└──────────────┬─────────────────────────────┬─────────────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌─────────────────────────────────────────┐
│       ContextAssembler       │ │             ExecutionPolicy             │
│ - Aplica systemInstructions  │ │ - Regras de limite (máx 5 iterações)    │
│ - Calcula orçamentos de tokens│ │ - Timeouts globais e de iteração        │
│ - Executa truncagem inteligente│ │ - Thresholds de alerta                  │
└──────────────┬───────────────┘ └─────────────────────────────────────────┘
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
| **`AgentHarness`** | `src/harness/AgentHarness.ts` | Implementação do loop agentic, orquestração de chamadas de ferramentas, resiliência e registro de métricas. |
| **`IContextAssembler`** | `src/domain/ports/IContextAssembler.ts` | Contrato para montagem e orçamentação de contexto. |
| **`ContextAssembler`** | `src/harness/ContextAssembler.ts` | Implementação da montagem de contexto com suporte a instruções de sistema e truncamento histórico. |
| **`ITokenCounter`** | `src/domain/ports/ITokenCounter.ts` | Interface para cálculo de tokens. |
| **`TiktokenAdapter`** | `src/infrastructure/tokenizer/TiktokenAdapter.ts` | Adaptador baseado no `tiktoken` (cl100k_base / ChatML) para contagem exata de tokens. |
| **`IShortTermMemory`** | `src/domain/ports/IShortTermMemory.ts` | Interface de armazenamento temporário de sessão. |
| **`RedisShortTermMemory`** | `src/infrastructure/memory/RedisShortTermMemory.ts` | Implementação de Short-Term Memory com Redis (chave: `memory:short:{workspaceId}:{threadId}`). |
| **`ExecutionPolicy`** | `src/harness/ExecutionPolicy.ts` | Guardrails de execução: máximo de 5 iterações de ferramentas, timeout por iteração e limite de tokens. |
| **`AgentMetrics`** | `src/infrastructure/metrics/AgentMetrics.ts` | Coletores de métricas Prometheus para a execução do agente. |

### Fluxo de Execução no Harness

1. **Inicialização (`runId`)**: O Harness recebe as dependências e gera um `runId` único para a execução.
2. **Consulta a Short-Term Memory**: O Harness verifica se existem mensagens de iterações recentes no Redis.
3. **Assembly de Contexto**: O `ContextAssembler` junta o contexto atual + Short-Term Memory + `systemInstructions` e aplica truncagem se o limite de tokens for excedido.
4. **Chamada do LLM**: O `ILLMProvider` é acionado enviando o contexto formatado e a lista de ferramentas MCP (`mcpTools`).
5. **Avaliação da Resposta**:
   - **Caso `type === 'text'`**: O ciclo finaliza com sucesso (`status: 'completed'`), a resposta é salva na Short-Term Memory e retornada.
   - **Caso `type === 'tool_call'`**: O Harness incrementa a iteração, executa a ferramenta via `IMCPClient.executeTool()` medindo a duração e registra a chamada em `toolCalls`.
6. **Recuperação de Falhas de Ferramentas**: Se a chamada da ferramenta falhar, o erro é convertido em uma mensagem `system` JSON de erro e o loop continua, permitindo que o LLM reaja e decida como prosseguir.
7. **Guardrail de Máximo de Iterações**: Ao atingir o número máximo de iterações (`MAX_TOOL_ITERATIONS = 5`), o Harness adiciona uma instrução de sistema forçando o LLM a resumir os dados e responder ao usuário.
8. **Finalização & Métricas**: As métricas do Prometheus (`agent_runs_total`, `agent_run_duration_seconds`, `agent_tool_calls_total`) são atualizadas.

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
│   │   ├── Memory.ts                   # Modelo de memória (Short-Term & RAG)
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
│   │       ├── IEncryptionService.ts   # Interface do serviço de criptografia
│   │       ├── ILLMProvider.ts
│   │       ├── IMCPClient.ts
│   │       ├── IQueueService.ts
│   │       ├── IShortTermMemory.ts     # Contrato para cache de sessão temporária
│   │       ├── ISpaceMappingRepository.ts
│   │       ├── ITenantRepository.ts
│   │       ├── ITokenCounter.ts        # Contrato para contagem de tokens (BPE)
│   │       └── IUserRepository.ts
│   │
│   ├── harness/                         # Motor de execução e orquestração agentic
│   │   ├── AgentHarness.ts             # Loop iterativo LLM ↔ MCP, resiliência e métricas
│   │   ├── AgentHarness.test.ts
│   │   ├── ContextAssembler.ts         # Assembly de contexto com truncamento inteligente
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
│   │   │   └── LLMFactory.ts
│   │   ├── mcp/
│   │   │   └── MCPHttpAdapter.ts
│   │   ├── memory/                     # Memória de curto prazo
│   │   │   ├── RedisShortTermMemory.ts
│   │   │   └── RedisShortTermMemory.test.ts
│   │   ├── metrics/                    # Métricas Prometheus
│   │   │   └── AgentMetrics.ts
│   │   ├── queue/
│   │   │   ├── BullMQAdapter.ts            # Producer — enfileira mensagens via BullMQ
│   │   │   ├── BullMQWorker.ts             # Consumer — processa jobs da fila BullMQ
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
│   │   ├── container.ts               # Composition Root
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
| `Memory` | Modelo de domínio de memória estruturada (`id`, `tenantId`, `workspaceId`, `type`, `content`, `importance`). |
| `User` | Usuário do sistema com `id`, `name`, `email`, `password` (value object) e `workspaceId: string[]`. |
| `Password` | Value object que encapsula senha hasheada (SHA-256). Criado via `Password.create(plain)` no entry point; comparado via `password.compare(plain)` no login. |
| `SpaceMapping` | Mapeia um `spaceId` do Google Chat ao `workspaceId` do tenant correspondente. |
| `ChatConfig` | Entidade que armazena credenciais do Slack (`botToken`, `appToken`, `signingSecret`) por tenant (`workspaceId` e `teamId`). |
| `ToolCall` | Requisição de execução de ferramenta com `name` e `parameters`. |
| `LLMConfig` | Interface com `provider`, `apiKey` e `model` opcional. Suporta: `openai`, `anthropic`, `google`, `deepseek`. |

### Harness Layer

Motor desacoplado responsável pela orquestração iterativa do agente:

- **`AgentHarness`**: Runtime que gerencia o loop iterativo LLM ↔ MCP, captura exceções em ferramentas, gera o `runId` e atualiza métricas Prometheus.
- **`ContextAssembler`**: Monta o contexto para o LLM adicionando instruções de sistema e truncando histórico de forma inteligente com base no limite de tokens.
- **`ExecutionPolicy`**: Define regras de parada (limite de 5 iterações, timeouts e orçamentos de token).

### Ports (Interfaces)

Contratos que definem as fronteiras do domínio — implementados pela camada de infraestrutura.

| Port | Responsabilidade |
|---|---|
| `IAgentHarness` | Interface do runtime desacoplado do agente (`run(input): Promise<AgentRunResult>`). |
| `IContextAssembler` | Interface para montagem de contexto com orçamento de tokens. |
| `ITokenCounter` | Interface para contagem precisa de tokens (BPE/ChatML). |
| `IShortTermMemory` | Interface para gerenciamento de memória temporária de sessão com TTL. |
| `ILLMProvider` | Gera respostas a partir do `ChatContext`. Retorna `{ type: 'text' }` ou `{ type: 'tool_call' }`. |
| `IMCPClient` | Handshake MCP, listagem e execução de ferramentas. |
| `IChatProvider` | Envia mensagens ao canal de chat do usuário final. |
| `IQueueService` | Despacha tarefas para processamento assíncrono. |
| `IChatRepository` | Persiste e recupera `ChatContext` por `threadId` + `workspaceId`. |
| `ITenantRepository` | Persiste e recupera `Tenant` por `workspaceId`. |
| `ISpaceMappingRepository` | Persiste e recupera mapeamentos `spaceId → workspaceId`. |
| `IUserRepository` | Persiste e recupera `User` por `id` ou `email`; adiciona `workspaceId` ao array. |
| `IChatConfigRepository` | Persiste e recupera `ChatConfig` por `workspaceId` ou `teamId`. |
| `IEncryptionService` | Criptografa e descriptografa dados sensíveis em repouso. |

### Infrastructure

Implementações concretas dos ports:

#### LLM Adapters

- **`OpenAIAdapter`** — Integra com a API da OpenAI (Chat Completions). Também suporta provedores compatíveis via `baseURL` customizada (ex: DeepSeek). Trata a tradução bidirecional entre o domínio e o formato proprietário da API.
- **`AnthropicAdapter`** — Integra com a API da Anthropic (Messages). Separa system prompts das mensagens de conversa conforme o padrão da API do Claude. Mapeia blocos `tool_use` para a entidade `ToolCall` do domínio.
- **`LLMFactory`** — Factory Method que instancia o adapter correto com base no `LLMConfig.provider`. Modelos padrão:
  - `openai` → `gpt-4o`
  - `deepseek` → `deepseek-chat` (via `OpenAIAdapter` com `baseURL` customizada)
  - `anthropic` → `claude-3-5-sonnet`

#### MCP Adapter

- **`MCPHttpAdapter`** — Cliente HTTP que se comunica com um servidor MCP via JSON-RPC 2.0. Implementa o handshake completo conforme a especificação MCP:
  - `connect()` — Handshake em 3 etapas: envia `initialize`, recebe capabilities do servidor, envia `notifications/initialized`
  - `isConnected()` — Verifica se o handshake foi concluído
  - `tools/list` — Descobre dinamicamente as ferramentas disponíveis para o tenant
  - `tools/call` — Executa uma ferramenta específica passando nome e argumentos
  - `ensureInitialized()` — Conecta automaticamente se o handshake ainda não foi realizado

#### Chat Adapters & Factory

- **`GoogleChatAdapter`** — Envia mensagens para uma thread do Google Chat Spaces via API REST v1. Utiliza `google-auth-library` para autenticação OAuth2 via Application Default Credentials (ADC). O `threadId` é usado no formato `spaces/AAAAxxxx/threads/YYYYyyyy`.
- **`SlackChatAdapter`** — Envia mensagens para um canal/thread do Slack via `chat.postMessage`. Autentica com Bearer token dinâmico por workspace. Usa a convenção `"CHANNEL_ID:thread_ts"` para o `threadId`.
- **`ChatProviderFactory`** — Instancia dinamicamente o `SlackChatAdapter` buscando o `botToken` de cada tenant no banco de dados via `ChatConfigRepository`.

#### Security

- **`AESEncryptionService`** — Implementa `IEncryptionService` usando **AES-256-GCM** com IV aleatório de 12 bytes e Auth Tag de 16 bytes. Garante a proteção dos segredos do Slack (`botToken`, `appToken`, `signingSecret`) no banco de dados.

#### Queue Adapter

- **`BullMQAdapter`** — Producer baseado em [BullMQ](https://bullmq.io/) que enfileira mensagens para processamento assíncrono. Conecta-se ao Redis e adiciona jobs na fila `message-processing` com até 3 tentativas e backoff exponencial de 5s. Remove jobs da fila ao completar com sucesso, mas mantém os que falham para depuração.
- **`BullMQWorker`** — Consumer que escuta a fila `message-processing` e processa cada job chamando o `ProcessAgentResponseUseCase` com o `ChatProvider` correspondente resolvido via `ChatProviderFactory`. Suporta concorrência configurável via `QUEUE_CONCURRENCY` (padrão: 5). Inclui graceful shutdown nos sinais `SIGTERM`/`SIGINT`.
- **`QStashAdapter`** — Adapter legado que despacha mensagens via QStash (Upstash). Publica no endpoint `https://qstash.upstash.io/v1/publish/{workerUrl}` com header `Upstash-Retries: 3` para retentativas automáticas.

#### Database

- **`MongoConnection`** — Singleton que gerencia a conexão com MongoDB. Método `connect(uri, dbName)` inicia a conexão; `getDb()` retorna a instância do banco para consumo dos repositórios.

### Repositories

Implementações concretas dos ports de repositório utilizando MongoDB:

| Repositório | Coleção | Operações |
|---|---|---|
| `ChatRepository` | `threads` | `findById`, `save` |
| `TenantRepository` | `tenants` | `findByWorkspaceId`, `save` |
| `UserRepository` | `users` | `findById`, `findByEmail`, `save`, `addWorkspaceId` |
| `SpaceMappingRepository` | `space_mappings` | `findBySpaceId`, `save` |
| `ChatConfigRepository` | `chat_configs` | `findByWorkspaceId`, `findByTeamId`, `save` (Criptografia/Descriptografia transparente via `AESEncryptionService`) |

### Use Cases

| Use Case | Descrição |
|---|---|
| `ProcessAgentResponseUseCase` | Fluxo principal do agente: resolve tenant via `spaceId`, executa ciclo iterativo LLM↔MCP (até 5 chamadas consecutivas de ferramentas) e persiste o contexto. |
| `RegisterUserUseCase` | Cria um novo usuário. Valida unicidade do email e aplica `Password.create()` antes de persistir. |
| `LoginUserUseCase` | Valida credenciais e emite um JWT assinado com `jose` (HS256). Expõe `verify()` estático para o middleware. |
| `RegisterTenantUseCase` | Registra um novo tenant (workspace). Valida duplicidade de `workspaceId`. |
| `RegisterChatConfigUseCase` | Registra/atualiza as credenciais de um bot de chat (Slack) associadas a um tenant. |
| `GetChatConfigUseCase` | Recupera as configurações de bot de um tenant (sem expor segredos sensíveis na resposta da API). |
| `RegisterSpaceUseCase` | Registra um espaço do Google Chat e associa ao tenant via `workspaceId`. Exige que o tenant exista. |
| `AssociateTenantToUserUseCase` | Vincula um `workspaceId` de tenant a um usuário existente via `addWorkspaceId()`. |

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
2. **Spans Semânticos no Agent Harness:**
   - `agent.execute` — Span raiz do ciclo de vida da execução com atributos `app.tenant_id`, `app.workspace_id`, `app.thread_id`, `agent.run_id`, `agent.status` e `agent.iterations`.
   - `agent.context_assembly` — Latência de montagem e aplicação de token budgeting no contexto da conversa.
   - `agent.llm_call` — Duração de cada chamada de inferência ao LLM e contagem de iterações.
   - `agent.tool_execution:<tool_name>` — Tempo de execução e metadados de chamadas a ferramentas MCP.
   - `agent.short_term_memory.save` — Tempo de gravação do estado no Redis.
3. **Propagação de Contexto em Filas (BullMQ):**
   - Injeção e extração transparente do cabeçalho padrão W3C (`traceparent`) no payload dos jobs.
   - O worker executa o processamento do job dentro do span `bullmq.process_job`, mantendo o mesmo `trace_id` da requisição HTTP de origem.
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

## Autenticação e Autorização (JWT)

O sistema utiliza **JWT (JSON Web Tokens)** assinados com HS256 via biblioteca [`jose`](https://github.com/panva/jose) (ESM-native, compatível com `"type": "module"`).

### Fluxo de Autenticação

```
POST /api/auth/login
  → valida email + senha (SHA-256)
  → emite JWT com payload { sub, email, workspaceIds }
  → token expira conforme JWT_EXPIRES_IN (padrão: 8h)
```

### Middleware

O `authMiddleware` extrai o Bearer token do header `Authorization`, verifica a assinatura com `jose` e injeta `req.user` na request:

```typescript
// req.user após validação
{
  sub: string;         // user id
  email: string;
  workspaceIds: string[];
}
```

Rotas protegidas retornam `401` se o token estiver ausente, inválido ou expirado.

### Variáveis de Ambiente

```env
JWT_SECRET=sua_chave_secreta_aqui   # mínimo 32 caracteres recomendado
JWT_EXPIRES_IN=8h                   # aceita: 8h | 1d | 7d | etc.
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
    participant MCP as MCP Server
    participant LLM as LLM Provider

    User->>Chat: Envia mensagem
    Chat->>UC: execute(workspaceId, threadId, text)
    
    UC->>Repo: Busca Tenant + ChatContext
    Repo-->>UC: Tenant + histórico
    
    rect rgb(230, 245, 255)
        Note over UC,MCP: Handshake MCP (se não conectado)
        UC->>MCP: initialize
        MCP-->>UC: capabilities + serverInfo
        UC->>MCP: notifications/initialized
    end
    
    UC->>MCP: listTools()
    MCP-->>UC: tools disponíveis
    UC->>LLM: generateResponse(context, tools)
    
    loop Até 5 iterações (enquanto LLM retornar tool_call)
        LLM-->>UC: { type: 'tool_call', tool }
        UC->>MCP: executeTool(tool)
        MCP-->>UC: resultado da ferramenta
        UC->>UC: Adiciona resultado ao contexto (role: system)
        UC->>LLM: generateResponse(context atualizado, tools)
    end
    
    LLM-->>UC: { type: 'text', content }
    
    UC->>Repo: save(context)
    UC->>Chat: sendMessage(threadId, content)
    Chat-->>User: Resposta do agente
```

---

## Stack Tecnológica

| Tecnologia | Versão | Função |
|---|---|---|
| **TypeScript** | 6.x | Linguagem principal |
| **Node.js** | ≥ 20 | Runtime (ESM nativo) |
| **OpenAI SDK** | ^6.45.0 | Client para APIs compatíveis com OpenAI |
| **Anthropic SDK** | ^0.110.0 | Client para API da Anthropic |
| **google-auth-library** | ^10.9.0 | Autenticação OAuth2 para Google APIs |
| **Express** | ^5.2.1 | Framework HTTP |
| **helmet** | ^8.2.0 | Segurança HTTP (headers) |
| **cors** | ^2.8.6 | Liberação de CORS |
| **dotenv** | ^17.4.2 | Variáveis de ambiente em dev |
| **MongoDB Driver** | ^7.4.0 | Driver nativo MongoDB |
| **jose** | ^6.x | JWT ESM-native (assinar e verificar tokens HS256) |
| **BullMQ** | ^5.80.2 | Gerenciamento de filas baseado em Redis |
| **Redis** | — | Backend de filas do BullMQ (ioredis) |
| **@opentelemetry/sdk-node** | ^0.221.0 | OpenTelemetry Node.js SDK central |
| **@opentelemetry/auto-instrumentations-node** | ^0.79.0 | Auto-instrumentações de HTTP, DB e Redis |
| **@opentelemetry/exporter-trace-otlp-http** | ^0.221.0 | Exportador OTLP via HTTP para Grafana Tempo |
| **tsx** | ^4.23.0 | Execução direta de TypeScript em dev |
| **Vitest** | ^4.1.10 | Runner de testes unitários |
| **@vitest/coverage-v8** | ^4.1.10 | Relatório de cobertura de código |

### Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Desenvolvimento com hot-reload (`tsx watch src/index.ts`) |
| `npm run build` | Compilação TypeScript (`tsc`) |
| `npm start` | Execução do build compilado (`node dist/index.js`) |
| `npm test` | Executa testes unitários (`vitest run`) |
| `npm run test:watch` | Modo watch (`vitest`) |
| `npm run test:coverage` | Relatório de cobertura (`vitest run --coverage`) |

---

## Testes

O projeto utiliza **Vitest** como framework de testes. Os testes estão organizados lado a lado com o código-fonte (`*.test.ts`) seguindo o padrão de co-locação.

### Cobertura

| Camada | Arquivos testados | Testes |
|---|---|---|---|
| Domínio | `Password` | 11 |
| Infraestrutura | `GoogleChatAdapter`, `MCPHttpAdapter`, `SlackChatAdapter`, `GeminiAdapter`, `BullMQAdapter`, `BullMQWorker` | 39 |
| Controllers | `SlackWebhookController` | 9 |
| Use Cases | Todos os 6 use cases | 29 |
| **Total** | **14 arquivos** | **88** |

### Estrutura

```
src/
├── domain/
│   └── Password.test.ts
├── infrastructure/
│   ├── chat/
│   │   ├── GoogleChatAdapter.test.ts
│   │   └── SlackChatAdapter.test.ts
│   ├── llm/
│   │   └── GeminiAdapter.test.ts
│   ├── mcp/
│   │   └── MCPHttpAdapter.test.ts
│   └── queue/
│       ├── BullMQAdapter.test.ts
│       └── BullMQWorker.test.ts
├── controllers/
│   └── SlackWebhookController.test.ts
└── usecases/
    ├── AssociateTenantToUserUseCase.test.ts
    ├── LoginUserUseCase.test.ts
    ├── ProcessAgentResponseUseCase.test.ts
    ├── RegisterSpaceUseCase.test.ts
    ├── RegisterTenantUseCase.test.ts
    └── RegisterUserUseCase.test.ts
```

### Práticas

- **Mocks**: repositórios mockados com `vi.fn()`, HTTP global mockado com `vi.stubGlobal('fetch', ...)`, JWT testado com `process.env` temporário
- **Isolamento**: sem dependência de banco de dados ou serviços externos
- **Factory functions**: funções reutilizáveis (`makeUserRepo`, `makeTenantRepo`, etc.) para criar mocks tipados
- **Cobertura**: configurada com `@vitest/coverage-v8` nos diretórios `usecases`, `infrastructure` e `domain`

### CI/CD

O pipeline do **GitHub Actions** (`.github/workflows/ci-cd.yml`) executa duas etapas:

1. **Testes unitários** — `npm test` em todo PR para a branch `dev`
2. **Build & Push Docker** — Constrói a imagem Docker multi-stage e publica no Docker Hub com as tags `latest` e o SHA do commit (apenas em push para `dev`, após testes passarem)

---

## Pré-requisitos

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- **MongoDB** ≥ 6.x (local ou Atlas) — para persistência de conversas e tenants
- **Redis** ≥ 7.x — backend de filas do BullMQ
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
- `REDIS_URL`: String de conexão com Redis (ex: `redis://localhost:6379`) — usado pelo BullMQ
- `START_WORKER`: Habilita o worker BullMQ na inicialização (`true`/`false`, padrão: `true`)
- `QUEUE_CONCURRENCY`: Número de jobs processados em paralelo pelo worker (padrão: `5`)
- `QSTASH_TOKEN` e `WORKER_URL`: Integração legada com Upstash (filas assíncronas)
- `MCP_SERVER_URL` e `MCP_API_KEY`: Comunicação com o servidor MCP
- `LLM_PROVIDER`, `LLM_API_KEY` e `LLM_MODEL`: Configurações de LLM
- `JWT_SECRET`: Chave secreta para assinar tokens JWT (mínimo 32 caracteres recomendado)
- `JWT_EXPIRES_IN`: Tempo de expiração do token (ex: `8h`, `1d`, `7d`)
- `ENCRYPTION_KEY`: Chave secreta de 32 bytes (64 caracteres hex ou 32 ASCII) para criptografia AES-256-GCM dos tokens de chat em repouso
- `SLACK_BOT_TOKEN`: Bot token global/fallback do app Slack (começa com `xoxb-`)
- `SLACK_SIGNING_SECRET`: Signing secret global/fallback para validação de assinatura HMAC-SHA256

A arquitetura foi adaptada para rodar de forma stateless via **Vercel Serverless Functions**. O request cycle é tratado no Express (`src/app.ts`), que é servido localmente via `src/index.ts` e exportado para a Vercel através de `api/index.ts`.

---

## Status do Projeto

> 🚧 **Em desenvolvimento ativo**

| Componente | Status |
|---|---|
| Entidades de domínio | ✅ Implementado |
| Ports / Interfaces | ✅ Implementado |
| OpenAI Adapter | ✅ Implementado |
| Anthropic Adapter | ✅ Implementado |
| DeepSeek (via OpenAI) | ✅ Implementado |
| Google LLM Adapter | ✅ Implementado |
| MCP HTTP Adapter | ✅ Implementado |
| ChatProvider Adapter (Google Chat) | ✅ Implementado |
| ChatProvider Adapter (Slack) | ✅ Implementado |
| ChatProviderFactory (Slack multi-tenant dinâmico) | ✅ Implementado |
| AESEncryptionService (AES-256-GCM em repouso) | ✅ Implementado |
| ChatConfigRepository (`chat_configs`) | ✅ Implementado |
| QueueService Adapter (QStash) | ✅ Implementado |
| MongoDB Connection | ✅ Implementado |
| ChatRepository | ✅ Implementado |
| TenantRepository | ✅ Implementado |
| UserRepository | ✅ Implementado |
| SpaceMappingRepository | ✅ Implementado |
| Multi-tenant no Use Case | ✅ Implementado |
| Express App (`app.ts`) | ✅ Implementado |
| Composition Root (`container.ts`) | ✅ Implementado |
| Controllers (Webhook + Worker) | ✅ Implementado |
| Slack Webhook Controller + Router | ✅ Implementado |
| Onboarding Controllers + Routers | ✅ Implementado |
| Auth Controller + Router (Login) | ✅ Implementado |
| ChatConfig Controller + Router | ✅ Implementado |
| JWT Middleware (`authMiddleware`) | ✅ Implementado |
| Entry point dev (`index.ts`) | ✅ Implementado |
| Entry point Vercel (`api/index.ts`) | ✅ Implementado |
| Deploy Serverless (Vercel) | ✅ Implementado |
| Deploy Docker (multi-stage) | ✅ Implementado |
| BullMQ Queue Adapter | ✅ Implementado |
| BullMQWorker (consumer com resolução dinâmica de ChatProvider) | ✅ Implementado |
| Graceful shutdown (SIGTERM/SIGINT) | ✅ Implementado |
| Testes unitários | ✅ Implementado |
| Pipeline CI/CD (GitHub Actions) | ✅ Implementado |
| Docker Image Push (Docker Hub) | ✅ Implementado |
| Loop iterativo de ferramentas (LLM↔MCP, max 5) | ✅ Implementado |
| Safe Send no SSE Handler (Go MCP Server) | ✅ Implementado |

---

## Licença

ISC
