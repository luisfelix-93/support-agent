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
│     InvestigationEngine ──► PlaybookRegistry (Pluggable Playbooks)          │
│                 │                                                           │
│                 ▼                                                           │
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
- **Módulo de Workflows & Playbooks (`src/domain/workflows`)**:
  - `IInvestigationPlaybook`: Contrato base de um playbook de investigação (identificador, domínio, heurísticas `matches`, prompt especializado e ferramentas recomendadas).
  - `EvidenceLedger`: Agregação estruturada de evidências técnicas coletadas (logs, métricas, traces, eventos de pod e conexões de banco).
  - `SessionSummary`: Value object / entidade que encapsula o Resumo Executivo da investigação, formatando o diagnóstico em Markdown corporativo para canais de chat.
  - `PlaybookRegistry`: Catálogo extensível com busca e seleção de múltiplos playbooks aplicáveis ao contexto.
  - **Playbooks de Domínio (`src/domain/workflows/playbooks/`)**:
    - `ApiErrorPlaybook`: Especialista em erros HTTP 5xx e falhas em APIs (Loki + Prometheus).
    - `LatencyTracePlaybook`: Especialista em tempo de resposta e degradação de performance (Tempo + p95/p99).
    - `KubernetesPlaybook`: Especialista em pods reiniciando, OOMKilled e eventos do cluster.
    - `DatabasePlaybook`: Especialista em esgotamento de pool de conexões, queries lentas e locks.

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
- **`InvestigationEngine`**:
  - Avalia a mensagem inicial do usuário e o histórico de contexto.
  - Consulta o `PlaybookRegistry` e seleciona os playbooks adequados (retorna `null` em modo conversacional comum).
  - Injeta o protocolo universal SRE (*Triagem ➔ Hipótese ➔ Coleta de Evidências ➔ Correlação Cruzada ➔ Causa Raiz / RCA ➔ Session Summary*).
  - Extrai e valida o `SessionSummary` estruturado na finalização do atendimento.

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

## 3. Subsistema de Memória 2.0 (Recuperação Híbrida & Ciclo de Vida)

O Support Agent adota uma arquitetura de memória corporativa de alta fidelidade e governança contínua:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DIÁLOGO ATIVO                                        │
└───────────────────────────┬────────────────────────────────┬───────────────────────────┘
                            │                                │
            (Contexto imediato da thread)        (Fatos duradouros / Resoluções / Incidentes)
                            │                                │
                            ▼                                ▼
               ┌────────────────────────┐       ┌────────────────────────┐
               │   Short-Term Memory    │       │    Long-Term Memory    │
               │         (Redis)        │       │   (MongoDB 2.0 Híbrido)│
               └────────────────────────┘       └────────────┬───────────┘
                                                             │
                         ┌───────────────────────────────────┴───────────────────────────────────┐
                         ▼                                                                       ▼
             ┌────────────────────────┐                                              ┌────────────────────────┐
             │  Recuperação Híbrida   │                                              │   Ciclo de Vida (TTL)  │
             │  • Vetorial (Cosseno)  │                                              │  • candidate (conf<0.8)│
             │  • Textual ($text)     │                                              │  • validated           │
             │  • RRF (k=60)          │                                              │  • active (conf>=0.8)  │
             │  • Contextual Reranker │                                              │  • updated             │
             └────────────────────────┘                                              │  • expired (TTL Mongo) │
                                                                                     └────────────────────────┘
```

### 3.1. Níveis de Memória
1. **Short-Term Memory (Redis)**:
   - Chave: `memory:short:{workspaceId}:{threadId}`.
   - Armazena as interações mais recentes da thread atual para manter a continuidade imediata.
   - TTL configurável por workspace/tenant.
2. **Long-Term Memory (MongoDB + Embeddings + Text Index)**:
   - Armazena o conhecimento permanente isolado rigorosamente por `tenantId` e `workspaceId`.
   - Índices nativos criados em `ensureIndexes()`:
     - Text Index composto: `{ content: 'text', tags: 'text' }` com pesos `{ tags: 5, content: 1 }`.
     - TTL Index nativo: `{ expiresAt: 1 }` com `expireAfterSeconds: 0`.
     - Índice composto multi-tenant: `{ tenantId: 1, workspaceId: 1, status: 1, createdAt: -1 }`.

### 3.2. Motor de Recuperação Híbrida & Algoritmo RRF (Reciprocal Rank Fusion)
A recuperação vetorial por similaridade de cosseno é excelente para proximidade semântica genérica, mas insuficiente em incidentes de infraestrutura que exigem correspondência exata de termos operacionais (códigos de erro como `ERR_DATABASE_POOL_EXHAUSTED`, códigos HTTP `504`, IDs de transação ou slugs de pods/serviços).

O método `searchHybrid` combina as duas técnicas via **Reciprocal Rank Fusion (RRF)**:
$$RRF(d) = \left( \frac{w_{\text{vec}}}{k + r_{\text{vec}}(d)} + \frac{w_{\text{text}}}{k + r_{\text{text}}(d)} \right) \cdot (1 + \text{importance} \cdot 0.2)$$

- **Constante $k=60$**: Suaviza a discrepância entre posições de ranking.
- **Pesos padrão**: $w_{\text{text}} = 1.2$ (prioriza termos técnicos exatos) e $w_{\text{vec}} = 1.0$.
- **Ponderação por Importância**: Memórias com peso operacional maior recebem um multiplicador de até 20%.

### 3.3. Contextual Memory Reranker (`ContextualMemoryReranker`)
Após a fusão RRF, o `ContextualMemoryReranker` refina os top-K candidatos aplicando:
1. **Extração de Termos Técnicos**: Regex para códigos HTTP (`100-599`), constantes de erro (`ERR_*`, `*_ERROR`), nomes de exceções (`*Exception`, `*Error`) e slugs de microsserviços.
2. **Bônus de Correspondência Exata**: Aumenta o score quando os termos operacionais da mensagem aparecem no conteúdo ou nas tags da memória.
3. **Decaimento Exponencial por Recência**:
   $$\text{Score}_{\text{final}} = \text{Score} \cdot e^{-\lambda \cdot \Delta t}$$
   Com fator $\lambda = 0.02$, correspondendo a uma meia-vida operacional de aproximadamente 35 dias para incidentes transitórios.

### 3.4. Máquina de Estados e Ciclo de Vida da Memória
O domínio (`MemoryLifecycle`) implementa uma máquina de estados estrita:

```text
    ┌──────────────┐
    │  candidate   │ ──(curadoria/validação)──► ┌─────────────┐
    └──────┬───────┘                            │  validated  │
           │                                    └──────┬──────┘
           │ (auto-ativação conf >= 0.8)               │
           └───────────────────┬───────────────────────┘
                               ▼
                        ┌─────────────┐
        ┌────────────── │   active    │ ◄─────────────┐
        │               └──────┬──────┘               │
        │ (edição)             │ (expiração TTL)      │ (re-ativação)
        ▼                      ▼                      │
  ┌───────────┐         ┌─────────────┐               │
  │  updated  │────────►│   expired   │───────────────┘
  └───────────┘         └─────────────┘
```

- **Classificação Inicial Automática**:
  - `LLMMemoryExtractor` atribui `confidenceScore` (0 a 1.0).
  - Se $\text{score} \ge 0.8$: status `active`.
  - Se $\text{score} < 0.8$: status `candidate` (aguarda curadoria humana).
- **TTL por Categoria**:
  - `incident`: TTL de 30 dias (fatos temporários de degradação).
  - `resolution`: TTL de 90 dias.
  - `fact` / `preference`: permanente (`expiresAt = null`).
- **Expiração & Purga**:
  - MongoDB TTL Index remove automaticamente documentos quando `expiresAt <= now`.
  - Repositório expõe `findExpired()` e `purgeExpired()` para limpeza programada e auditoria.

### 3.5. API REST de Governança (`/api/memories`)
Interface administrativa segura protegida por JWT, rate limiting e RBAC:
- `GET /api/memories`: Consulta paginada com filtros por tenant, workspace, status, tipo e tag (`viewer`, `operator`, `admin`).
- `POST /api/memories/search`: Execução operacional de busca híbrida com inspeção de scores vetoriais e textuais (`viewer`, `operator`, `admin`).
- `GET /api/memories/candidates`: Fila de memórias pendentes de curadoria humana (`operator`, `admin`).
- `PATCH /api/memories/:id/status`: Transição manual de status com validação de máquina de estados (`operator`, `admin`).
- `PUT /api/memories/:id`: Edição de conteúdo, importância e tags (`operator`, `admin`).
- `DELETE /api/memories/:id`: Exclusão definitiva de memória obsoleta (`admin`).

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
