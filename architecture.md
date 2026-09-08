# Arquitetura do Support Agent

O **Support Agent** adota os princípios de **Clean Architecture** e **Arquitetura Hexagonal (Ports & Adapters)** para desacoplar completamente a lógica de negócio do agente (raciocínio, ciclo iterativo, avaliação e memória) dos detalhes de infraestrutura (provedores de LLM, protocolos de comunicação, filas e bancos de dados).

---

## 1. Visão Geral e Diagrama do Sistema

O sistema é centrado no domínio e orquestrado pela **Camada Agent Harness**, com comunicação estrita através de contratos de interface (*Ports*) implementados por adaptadores (*Adapters*).

```text
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

## 2. Camadas da Aplicação

### 2.1. Domain (`src/domain`)
O coração do software. Não possui dependências externas ou de frameworks.
- **Entidades Centrais**:
  - `AgentRun`: Representa a execução ponta a ponta do agente, registrando `runId`, `status`, `durationMs`, iterações, consumo de tokens, custos em USD e histórico de ferramentas invocadas.
  - `Memory`: Fatos e preferências extraídos, categorizados (`fact`, `preference`, `instruction`, `summary`), com peso de importância e vetor de embedding.
  - `Tenant`: Configuração de cliente/espaço, definindo chaves e modelos de LLM e configuração de MCP.
  - `ChatConfig`: Credenciais de provedores de chat (Slack e Google Chat) com segredos criptografados.
  - `User` & `Password`: Gestão de usuários com hashing forte (Argon2id/bcrypt) e associação multi-tenant.
  - `ToolCall` & `Message`: Estruturas puras de conversação e requisições de ferramentas.

### 2.2. Ports (`src/domain/ports`)
Contratos de interface que definem tudo o que o domínio necessita do mundo exterior:
- **Execução Agentic**: `IAgentHarness`, `IContextAssembler`, `ITokenCounter`.
- **Inteligência e Ferramentas**: `ILLMProvider`, `IMCPClient`, `IEmbeddingProvider`, `IMemoryExtractor`.
- **Persistência e Filas**: `IMemoryRepository`, `IShortTermMemory`, `IAgentRunRepository`, `IEvaluationRepository`, `IQueueService`.
- **Canais e Segurança**: `IChatProvider`, `IChatConfigRepository`, `IEncryptionService`.

### 2.3. Agent Harness Layer (`src/harness`)
Runtime desacoplado encarregado de executar o ciclo de vida do agente:
- **`AgentHarness`**:
  1. Gera identificador único de execução (`runId`).
  2. Consulta a memória de curto prazo (Redis) e busca memórias relevantes de longo prazo (MongoDB via Cosseno).
  3. Aciona o `ContextAssembler` para empacotar o prompt respeitando o orçamento de tokens.
  4. Executa o loop iterativo com o `ILLMProvider`.
  5. Se o LLM requisitar chamada de ferramenta (`tool_call`), despacha para o `IMCPClient` e injeta a resposta de volta no contexto.
  6. Finaliza a execução, persiste o `AgentRun` no MongoDB e agenda os jobs assíncronos de promoção de memória e auto-avaliação no BullMQ.
- **`ContextAssembler`**: Injeta `systemInstructions`, memórias semânticas e trunca o histórico mais antigo quando necessário.
- **`ExecutionPolicy`**: Guardrail que limita o loop a no máximo 5 iterações e impõe timeouts defensivos.

### 2.4. Use Cases (`src/usecases`)
Orquestram os fluxos de aplicação sem acoplar a regras específicas de canais:
- `ProcessAgentResponseUseCase`: Ponto de entrada chamado por webhooks ou workers para carregar contexto e invocar o Harness.
- `RegisterTenantUseCase`, `RegisterUserUseCase`, `LoginUserUseCase`, `RegisterChatConfigUseCase`.

### 2.5. Infrastructure (`src/infrastructure`)
Adaptadores concretos das interfaces de domínio:
- **LLM**: `OpenAIAdapter`, `AnthropicAdapter`, `GoogleAdapter`, `DeepSeekAdapter`, unificados via `LLMFactory`.
- **MCP**: `MCPHttpAdapter` (JSON-RPC 2.0 com circuit breaker e timeout).
- **Embeddings**: `OpenAIEmbeddingProvider` (vetorização com `text-embedding-3-small`, 1536 dimensões).
- **Memória & Filas**: `RedisShortTermMemory` (ioredis), `BullMQAdapter` e workers (`BullMQWorker`, `MemoryPromotionWorker`, `EvaluationWorker`).
- **Segurança**: `AESEncryptionService` (AES-256-GCM para segredos em repouso).

### 2.6. Repositories (`src/repositories`)
Implementações de acesso a dados em MongoDB nativo:
- `MongoMemoryRepository`: Armazena memórias e executa cálculo de similaridade de cosseno em memória ou queries semânticas.
- `AgentRunRepository`: Armazena execuções completas de agentes com paginação, filtros e agregadores analíticos.
- `EvaluationRepository`: Persiste resultados de auto-avaliação do agente.
- `ChatConfigRepository`, `TenantRepository`, `UserRepository`, `ChatRepository`.

---

## 3. Subsistema de Memória Híbrida

O agente utiliza uma estratégia de memória de dois níveis:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                             DIÁLOGO ATIVO                                │
└───────────────────────┬──────────────────────────┬───────────────────────┘
                        │                          │
        (Contexto imediato da thread)   (Fatos duradouros / Preferências)
                        │                          │
                        ▼                          ▼
           ┌────────────────────────┐  ┌────────────────────────┐
           │   Short-Term Memory    │  │    Long-Term Memory    │
           │         (Redis)        │  │   (MongoDB + Vetores)  │
           └────────────────────────┘  └────────────────────────┘
```

1. **Short-Term Memory (Redis)**:
   - Chave: `memory:short:{workspaceId}:{threadId}`
   - Armazena as interações mais recentes da thread atual para manter a continuidade imediata.
   - Possui TTL configurável (evita acúmulo desnecessário).

2. **Long-Term Memory (MongoDB + Embeddings)**:
   - Armazena informações permanentes isoladas por `tenantId` e `workspaceId`.
   - Busca semântica vetorial calculando a **Similaridade de Cosseno**:
     $$\text{Cosine Similarity} = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}$$
   - Threshold configurável ($\ge 0.65$). As memórias mais relevantes são injetadas no prompt de sistema pelo `ContextAssembler`.

3. **Promoção Assíncrona via BullMQ (`MemoryPromotionWorker`)**:
   - Não bloqueia a resposta do usuário: ao concluir a resposta, o Harness publica um job na fila `memory-promotion`.
   - O worker extrai fatos e regras estruturados via LLM (`LLMMemoryExtractor`), gera embeddings de 1536 dimensões via `OpenAIEmbeddingProvider`, verifica duplicatas e persiste no MongoDB.

---

## 4. Pipeline de Telemetria e Avaliação Contínua

```text
[AgentHarness Finalizado]
         │
         ├─► Salva AgentRun no MongoDB (tokens, custo USD, tools, latência)
         │
         └─► Publica job na fila 'agent-evaluation' (BullMQ)
                  │
                  ▼
         [EvaluationWorker]
                  │
                  ├─► Prompt LLM 'Judge' (avalia resposta contra input e contexto)
                  ├─► ScoreCalculator:
                  │     • Answer Correctness (40%)
                  │     • Tool Selection Accuracy (25%)
                  │     • Context Relevance (15%)
                  │     • Hallucination Freedom (10%)
                  │     • Memory Usefulness (10%)
                  │
                  ├─► Atualiza Gauges no Prometheus (agent_evaluation_score)
                  └─► Salva Evaluation no MongoDB
```

- **Agregação e Detecção de Regressões**:
  - `AggregationService` calcula médias móveis por versão do agente (`promptVersion` ou release de código).
  - Comparações automatizadas detectam se uma nova versão introduziu queda de pontuação ou aumento anormal de alucinações.

---

## 5. Resiliência e Confiabilidade

1. **Circuit Breaker para MCP**:
   - Monitora falhas consecutivas de comunicação com o servidor MCP.
   - Abre o circuito em caso de indisponibilidade, permitindo fallback rápido sem travar a thread.
2. **Idempotência**:
   - Webhooks de mensageria (Slack / Google Chat) utilizam chaves de idempotência baseadas em `eventId` ou hash da mensagem no Redis para prevenir respostas duplicadas.
3. **Limites de Execução (Guardrails)**:
   - `ExecutionPolicy` limita qualquer corrida agentic a 5 iterações de ferramentas.
   - Timeouts estritos por iteração e por chamada de LLM.
4. **Graceful Shutdown**:
   - Tratamento de `SIGTERM` e `SIGINT` aguardando a finalização de jobs em execução no BullMQ e fechando pools de conexões de forma segura.

---

## 6. Observabilidade Nativa

O sistema possui observabilidade completa integrada aos três pilares:

| Pilar | Tecnologia | Detalhes |
|---|---|---|
| **Logs** | Pino + Grafana Loki | Formato JSON estruturado com correlação via `trace_id`, `span_id`, `tenantId` e `runId`. |
| **Métricas** | Prometheus | Expostas em `/metrics`. Coletam latência do loop agentic, contadores de tokens, chamadas MCP e gauges de avaliação. |
| **Tracing** | OpenTelemetry + Tempo | Spans granulares por requisição HTTP, iteração do Harness, chamadas de LLM, embeddings e operações de repositório. |

Consulte [grafana-tempo-tracing.md](grafana-tempo-tracing.md) para detalhes da topologia de rastreamento.
