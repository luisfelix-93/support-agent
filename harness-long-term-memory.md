# Plano de Implementação: Agent Harness - Memória de Longo Prazo e Semântica

> **Arquivo:** `harness-long-term-memory.md`  
> **Referência:** `docs/harness-future-phases.md`  
> **Status:** Concluído com Sucesso  
> **Branch de Trabalho:** `feature/hairness-long-term`  
> **Tipo de Projeto:** BACKEND (Node.js, TypeScript, Hexagonal Architecture, MongoDB, Redis/BullMQ, OpenTelemetry, Prometheus)

---

## 1. Visão Geral

Este plano estabeleceu a evolução do **Agent Harness** das fases anteriores (Short-Term Memory com Redis + Context Assembly) para um sistema completo de **Long-Term Memory** com persistência no MongoDB, promoção assíncrona desacoplada via filas BullMQ, busca vetorial semântica (Embeddings) e observabilidade completa (Tracing + Prometheus).

```
                      ┌──────────────────────────────────────────────────────────┐
                      │                     Agent Harness                        │
                      │                                                          │
                      │  1. Recebe User Message                                  │
                      │  2. Gera Query Embedding (Fase 6)                        │
                      │  3. Busca Memórias no Mongo (Fase 4/6)                   │
                      │  4. ContextAssembler monta Prompt (Token Budget)         │
                      │  5. Executa Loop LLM ↔ MCP                               │
                      │  6. Salva Short-Term Redis & Responde Usuário            │
                      │  7. [ASSÍNCRONO] Publica Job 'memory-promotion' (Fase 5) │
                      └────────────────────────────┬─────────────────────────────┘
                                                   │
                                                   ▼ (BullMQ Queue)
                      ┌──────────────────────────────────────────────────────────┐
                      │              Memory Promotion Worker                     │
                      │                                                          │
                      │  1. Consome Job de promoção de memória                   │
                      │  2. Chama IMemoryExtractor (LLM estruturado)             │
                      │  3. Gera Embeddings para novas memórias (Fase 6)         │
                      │  4. Salva no MongoDB com isolamento por Tenant           │
                      └──────────────────────────────────────────────────────────┘
```

---

## 2. Critérios de Sucesso (Definition of Done)

- [x] **Persistência Segura**: Memórias estruturadas persistidas no MongoDB com isolamento estrito por `tenantId` e `workspaceId`.
- [x] **Latência Zero na Resposta**: A extração de memórias é 100% assíncrona via BullMQ, sem atrasar a resposta ao usuário.
- [x] **Busca Semântica Precisa**: O agente recupera memórias relevantes com base no significado da mensagem do usuário usando embeddings vetoriais.
- [x] **Resiliência e Idempotência**: Deduplicação de memórias e retries automáticos com fallback gracioso se serviços de embedding ou LLM falharem.
- [x] **Observabilidade Total**: Spans OpenTelemetry (Tempo/Jaeger) e métricas Prometheus para busca de memória, tempo de embedding e taxa de promoção.
- [x] **Rollout Seguro**: Feature flags (`LONG_TERM_MEMORY_ENABLED`, `VECTOR_MEMORY_ENABLED`) para ativação gradual e canários.

---

## 3. Tech Stack & Decisões Arquiteturais

| Componente | Tecnologia | Decisão / Racional |
|---|---|---|
| **Arquitetura** | Hexagonal (Ports & Adapters) | Domínio isolado com interfaces (`IMemoryRepository`, `IMemoryExtractor`, `IEmbeddingProvider`). |
| **Banco de Dados** | MongoDB (Driver nativo) | Armazenamento de documentos de memória e suporte a índices e busca vetorial por cosseno. |
| **Fila Assíncrona** | BullMQ + Redis | Processamento em background desacoplado da requisição HTTP/Chat. |
| **Embeddings** | OpenAI (`text-embedding-3-small`) | Modelo eficiente (1536 dimensões), alta precisão e baixo custo/latência. |
| **Métricas** | `prom-client` | Contadores e histogramas para tempo de busca e promoção. |
| **Tracing** | `@opentelemetry/api` | Instrumentação com spans detalhados integrados ao Grafana Tempo. |

---

## 4. Estrutura de Arquivos

```
src/
├── domain/
│   ├── Memory.ts                          # Entidade e tipos de memória (revisado)
│   └── ports/
│       ├── IMemoryRepository.ts           # [NOVO] Porta para repositório de memória
│       ├── IMemoryExtractor.ts            # [NOVO] Porta para extração de memórias
│       └── IEmbeddingProvider.ts          # [NOVO] Porta para geração de embeddings
├── harness/
│   ├── AgentHarness.ts                    # Integração com busca e promoção assíncrona
│   ├── ContextAssembler.ts                # Injeção de memórias formatadas no contexto
│   └── ExecutionPolicy.ts                 # Configurações de budget e limites
├── infrastructure/
│   ├── llm/
│   │   └── OpenAIEmbeddingProvider.ts     # [NOVO] Adaptador de embeddings OpenAI
│   ├── memory/
│   │   ├── LLMMemoryExtractor.ts          # [NOVO] Extrator de memória via LLM
│   │   └── RedisShortTermMemory.ts        # Memória de curto prazo existente
│   ├── queue/
│   │   ├── BullMQWorker.ts                # Worker principal
│   │   └── MemoryPromotionWorker.ts       # [NOVO] Worker dedicado para promoção
│   └── metrics/
│       └── AgentMetrics.ts                # Métricas de memória e embedding
└── repositories/
    └── MongoMemoryRepository.ts           # [NOVO] Repositório MongoDB com busca vetorial
```

---

## 5. Lista de Tarefas (Task Breakdown)

### 📌 Fase 4: Long-Term Memory (Persistência no MongoDB)

- [x] **TASK-01: Definir Port `IMemoryRepository` e refinar entidade `Memory`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@database-design`
  - **Prioridade:** P0 | **Dependências:** Nenhuma
  - **Entrada:** `src/domain/Memory.ts`
  - **Saída:** `src/domain/ports/IMemoryRepository.ts` e `src/domain/Memory.ts` atualizado
  - **Verificação:** Interfaces TypeScript compilam (`npx tsc --noEmit`).

- [x] **TASK-02: Implementar `MongoMemoryRepository` com Isolamento Multi-Tenant e Testes Unitários**
  - **Agente:** `database-architect` | **Skills:** `@database-design` + `@tdd-workflow`
  - **Prioridade:** P0 | **Dependências:** TASK-01
  - **Entrada:** `IMemoryRepository.ts`, `MongoConnection.ts`
  - **Saída:** `src/repositories/MongoMemoryRepository.ts`, `src/repositories/MongoMemoryRepository.test.ts`
  - **Verificação:** `npm run test -- MongoMemoryRepository.test.ts` passa com 100% de sucesso.

- [x] **TASK-03: Integrar Consulta de Memórias no `ContextAssembler` e `AgentHarness`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@verify-changes`
  - **Prioridade:** P0 | **Dependências:** TASK-02
  - **Entrada:** `src/harness/ContextAssembler.ts`, `src/harness/AgentHarness.ts`
  - **Saída:** `AgentHarness` injeta memórias no `ContextAssembler` respeitando o limite de tokens
  - **Verificação:** `npm run test -- ContextAssembler.test.ts AgentHarness.test.ts` passa.

---

### 📌 Fase 5: Memory Worker (Promoção Assíncrona via BullMQ)

- [x] **TASK-04: Implementar Port `IMemoryExtractor` e Adaptador `LLMMemoryExtractor`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@testing-patterns`
  - **Prioridade:** P1 | **Dependências:** TASK-01
  - **Entrada:** Contexto recente de mensagens
  - **Saída:** `src/domain/ports/IMemoryExtractor.ts`, `src/infrastructure/memory/LLMMemoryExtractor.ts`, `src/infrastructure/memory/LLMMemoryExtractor.test.ts`
  - **Verificação:** Testes unitários com mocks de LLM validando extração de fatos/preferências em JSON estruturado.

- [x] **TASK-05: Instrumentar Disparo de Evento de Promoção no `AgentHarness`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@api-patterns`
  - **Prioridade:** P1 | **Dependências:** TASK-03
  - **Entrada:** `AgentHarness.run`
  - **Saída:** Publicação não-bloqueante do job `memory-promotion` no `IQueueService` após resposta ao usuário
  - **Verificação:** Teste de unidade confirmando que o job é enfileirado sem afetar a resposta imediata.

- [x] **TASK-06: Implementar `MemoryPromotionWorker` com Idempotência e Tratamento de Falhas**
  - **Agente:** `backend-specialist` | **Skills:** `@server-management` + `@tdd-workflow`
  - **Prioridade:** P1 | **Dependências:** TASK-04, TASK-05
  - **Entrada:** Fila `memory-promotion` no BullMQ
  - **Saída:** `src/infrastructure/queue/MemoryPromotionWorker.ts`, `src/infrastructure/queue/MemoryPromotionWorker.test.ts`
  - **Verificação:** Worker processa jobs, deduplica memórias idênticas e salva no MongoDB.

---

### 📌 Fase 6: Vector Search & Embeddings

- [x] **TASK-07: Implementar Port `IEmbeddingProvider` e Adaptador `OpenAIEmbeddingProvider`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@testing-patterns`
  - **Prioridade:** P2 | **Dependências:** Nenhuma (independente)
  - **Entrada:** String de texto ou batch de textos
  - **Saída:** `src/domain/ports/IEmbeddingProvider.ts`, `src/infrastructure/llm/OpenAIEmbeddingProvider.ts`, `src/infrastructure/llm/OpenAIEmbeddingProvider.test.ts`
  - **Verificação:** `npm run test -- OpenAIEmbeddingProvider.test.ts` passando com mock da API OpenAI.

- [x] **TASK-08: Integrar Geração de Embeddings na Gravação do `MemoryPromotionWorker`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code` + `@verify-changes`
  - **Prioridade:** P2 | **Dependências:** TASK-06, TASK-07
  - **Entrada:** Memória extraída
  - **Saída:** `MemoryPromotionWorker` gera vetor com `IEmbeddingProvider` e persiste campo `embedding` no Mongo
  - **Verificação:** Testes de integração do worker validando persistência de vetor de embeddings.

- [x] **TASK-09: Implementar Busca Vetorial no `MongoMemoryRepository` e Consulta Semântica no Harness**
  - **Agente:** `database-architect` + `backend-specialist` | **Skills:** `@database-design` + `@performance-profiling`
  - **Prioridade:** P2 | **Dependências:** TASK-02, TASK-07, TASK-08
  - **Entrada:** Query do usuário
  - **Saída:** Busca vetorial por similaridade de cosseno com pré-filtro por `tenantId`/`workspaceId` e métricas Prometheus
  - **Verificação:** `MongoMemoryRepository.searchRelevant` retorna memórias mais similares à query.

---

### 📌 Fase 7: Observabilidade Avançada & Feature Flags

- [x] **TASK-10: Adicionar Métricas Prometheus e Spans OpenTelemetry**
  - **Agente:** `devops-engineer` + `backend-specialist` | **Skills:** `@performance-profiling` + `@clean-code`
  - **Prioridade:** P3 | **Dependências:** TASK-03, TASK-06, TASK-09
  - **Entrada:** Execução do Harness, Worker e Repositório
  - **Saída:** Métricas `agent_memory_search_duration_seconds`, `agent_memory_promoted_total`, `agent_embedding_duration_seconds`, spans OpenTelemetry para tracing no Tempo
  - **Verificação:** Métricas registradas no Prometheus register e spans instrumentados.

- [x] **TASK-11: Configurar Feature Flags e Variáveis de Ambiente no `.env.example`**
  - **Agente:** `backend-specialist` | **Skills:** `@clean-code`
  - **Prioridade:** P3 | **Dependências:** Todas as anteriores
  - **Entrada:** Parâmetros de configuração
  - **Saída:** Flags `LONG_TERM_MEMORY_ENABLED`, `VECTOR_MEMORY_ENABLED`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_API_KEY`
  - **Verificação:** Container inicializa dependências condicionado às flags.

- [x] **TASK-12: Teste de Integração Ponta a Ponta (E2E) do Fluxo Completo de Memória**
  - **Agente:** `test-engineer` | **Skills:** `@testing-patterns` + `@verify-changes`
  - **Prioridade:** P3 | **Dependências:** TASK-01 a TASK-11
  - **Entrada:** Cenário completo de chat
  - **Saída:** `src/harness/AgentHarness.integration.test.ts`
  - **Verificação:** `npm run test` executando toda a suite com 100% de sucesso.

---

## 6. Phase X: Verificação Final

- [x] **TypeScript & Lint**: `npm run build` ou `npx tsc --noEmit` executa com zero erros.
- [x] **Suite de Testes**: `npm run test` executa todos os testes unitários e de integração com 100% de aprovação (32 arquivos, 161 testes).
- [x] **Isolamento de Tenant**: Todo método de persistência e busca valida estritamente `tenantId` e `workspaceId`.
- [x] **Fallback Gracioso**: Se Redis, embeddings ou MongoDB de memória falharem, o Agent Harness ainda responde ao usuário.
- [x] **Code Review Checklist**: Código segue estritamente `@clean-code` (sem over-engineering, conciso, tipado).

## ✅ PHASE X COMPLETE
- Lint & Types: ✅ Pass (0 errors)
- Tests: ✅ 32 passed, 161 tests passed
- Security & Tenant Isolation: ✅ Verified
- Date: 2026-08-30
