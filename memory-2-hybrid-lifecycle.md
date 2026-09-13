# Support Agent — Plano de Implementação da Fase 5: Memory 2.0 (Recuperação Híbrida & Ciclo de Vida)

> **Documento de Planejamento Arquitetural & Execução da Fase 5**  
> **Status:** 📝 Planejado  
> **Branch dedicada:** `feature/memory-2-hybrid-lifecycle`  
> **Responsáveis:** `project-planner`, `backend-specialist`  
> **Referência Roadmap:** [roadmap.md](roadmap.md#fase-5--memory-20-recuperação-híbrida--ciclo-de-vida) | Fase anterior: [Fase 4 Concluída](docs/phase4-summary.md)

---

## 1. Visão Geral & Problema a Resolver

Atualmente, o Support Agent possui persistência de curto prazo em Redis (`RedisShortTermMemory`) e persistência semântica de longo prazo em MongoDB (`MongoMemoryRepository`), com extração assíncrona orientada por LLM via fila BullMQ (`LLMMemoryExtractor`).

No entanto, essa abordagem apresenta dois gargalos críticos para suporte técnico e operações (AI Ops):
1. **Perda de precisão em termos exatos (Diluição Semântica no Embedding)**:  
   Termos operacionais cruciais como códigos de erro (`ERR_CONNECTION_TIMEDOUT`, `504 Gateway Timeout`), IDs de transação ou correlation IDs (`req_99a81c`), nomes de pods Kubernetes (`checkout-api-7b8f9-zx92l`) e tabelas de banco sofrem perda de relevância quando convertidos em vetores de embedding contínuos (1536 dimensões). Uma busca puramente semântica falha em priorizar a correspondência textual exata.
2. **Ciclo de Vida Estático & Poluição de Contexto**:  
   Memórias extraídas ficam salvas indefinidamente. Fatos transitórios (ex: "o cluster está passando por manutenção entre 02:00 e 04:00" ou resoluções temporárias de contorno) poluem o contexto semanas depois. Não há estados de maturidade (`candidate`, `active`, `expired`), expiração automática (TTL) ou API de governança para operadores humanos auditarem e invalidarem informações obsoletas.

---

## 2. Decisões Arquiteturais Definidas (Socratic Gate)

| Decisão | Opção Escolhida | Justificativa Técnica |
|---|---|---|
| **Motor de Busca Textual & Fusão** | **MongoDB Text Index (`$text`) + RRF em código** | Zero dependências externas proprietárias; 100% autossuficiente e compatível com MongoDB Docker/local e testes automatizados. |
| **Algoritmo de Reranker** | **Reciprocal Rank Fusion (RRF) Ponderado** | Latência de execução ~0ms; zero custo financeiro em tokens; abstraído via interface `IMemoryReranker` para extensibilidade futura. |
| **Ciclo de Vida & Expiração** | **Máquina de Estados + Auto-Promoção por Score + TTL Nativo** | Estados `candidate → validated → active → updated → expired`. Score >= 0.8 vira `active`; < 0.8 vira `candidate`. Expiração automática via MongoDB TTL Index (`expiresAt`). Endpoints REST `/api/memories` para governança humana. |

---

## 3. Arquitetura Detalhada

### 3.1 Diagrama de Estados do Ciclo de Vida da Memória

```text
       LLM Memory Extractor
                │
         [Score >= 0.8] ───────► ( active ) ◄────────┐
                │                       │            │
         [Score < 0.8]                  │ (Atualizada)│ (Aprovada)
                │                       ▼            │
                ▼                 ( updated )        │
         ( candidate )                  │            │
                │                       ▼            │
                └────────► ( validated ) ────────────┘
                                │
                    [TTL atingido / Expirada]
                                │
                                ▼
                           ( expired )
                                │
                    [Remoção TTL Index Mongo]
                                ▼
                             [Deleted]
```

### 3.2 Fórmula do Reciprocal Rank Fusion (RRF)

Para cada documento $d$ presente no conjunto de candidatos recuperados:
$$RRF(d) = w_{vector} \cdot \frac{1}{k + r_{vector}(d)} + w_{text} \cdot \frac{1}{k + r_{text}(d)}$$
Onde:
- $k = 60$ (constante padrão da literatura RRF para suavizar rankings de cauda longa).
- $w_{vector} = 1.0$ (peso da similaridade semântica).
- $w_{text} = 1.2$ (peso ligeiramente superior para casamentos textuais exatos de termos técnicos).
- O score final combina $RRF(d) \times (0.7 + 0.3 \times d.importance)$.

---

## 4. Sub-Fases de Implementação

### 🔹 Sub-Fase 5A: Fundação de Domínio & Contratos de Ciclo de Vida
**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`

**Objetivos:**
- Estender os tipos e entidades de memória para suportar estados de ciclo de vida, expiração e confiança.
- Estabelecer os contratos de repositório e reranker.

**Arquivos a Modificar / Criar:**
- `[MODIFY]` `src/domain/Memory.ts`:
  - Adicionar tipo `MemoryStatus`: `'candidate' | 'validated' | 'active' | 'updated' | 'expired'`.
  - Estender interface `Memory` com campos: `status: MemoryStatus`, `ttlSeconds?: number`, `expiresAt?: Date`, `confidenceScore?: number`, `validatedBy?: string`, `tags?: string[]`.
  - Adicionar interface `HybridMemorySearchInput`: `query: string`, `vector?: number[]`, `tenantId: string`, `workspaceId: string`, `limit?: number`, `threshold?: number`, `statuses?: MemoryStatus[]`, `types?: MemoryType[]`, `tags?: string[]`, `weights?: { vector?: number; text?: number }`.
  - Adicionar interface `HybridSearchResult`: `memory: Memory`, `score: number`, `vectorRank?: number`, `textRank?: number`.
- `[NEW]` `src/domain/ports/IMemoryReranker.ts`:
  - Definir interface `IMemoryReranker`:
    - `rerank(candidates: HybridSearchResult[], query: string, context?: Record<string, unknown>): Promise<HybridSearchResult[]>`.
- `[MODIFY]` `src/domain/ports/IMemoryRepository.ts`:
  - Declarar método `searchHybrid(input: HybridMemorySearchInput): Promise<HybridSearchResult[]>`.
  - Declarar método `updateStatus(id: string, tenantId: string, status: MemoryStatus, metadata?: Record<string, unknown>): Promise<boolean>`.
  - Declarar método `findCandidates(tenantId: string, limit?: number): Promise<Memory[]>`.
  - Declarar método `findExpired(now?: Date, limit?: number): Promise<Memory[]>`.
  - Declarar método `purgeExpired(now?: Date): Promise<number>`.

**Testes Unitários:**
- `[NEW]` `src/domain/MemoryLifecycle.test.ts`:
  - Validação de regras de transição de status de memória.
  - Cálculo e sanitização de `expiresAt` a partir de `ttlSeconds`.

---

### 🔹 Sub-Fase 5B: Motor de Recuperação Híbrida & Algoritmo RRF
**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5A

**Objetivos:**
- Implementar o algoritmo isolado de fusão de rankings (RRF).
- Integrar índices de texto e TTL no MongoDB.
- Atualizar o `MongoMemoryRepository` para executar buscas vetoriais e textuais simultâneas com unificação RRF.

**Arquivos a Modificar / Criar:**
- `[NEW]` `src/domain/algorithms/ReciprocalRankFusion.ts`:
  - Função pura `reciprocalRankFusion(vectorResults: Array<{ id: string; score: number }>, textResults: Array<{ id: string; score: number }>, options?: RrfOptions): Array<{ id: string; rrfScore: number; vectorRank?: number; textRank?: number }>`.
- `[NEW]` `src/domain/algorithms/ReciprocalRankFusion.test.ts`:
  - Testes matemáticos de ordenação RRF para casos de empate, itens presentes em ambas as listas e itens presentes em apenas uma lista.
- `[MODIFY]` `src/repositories/MongoMemoryRepository.ts`:
  - Atualizar `MemoryDocument` para persistir `status`, `expiresAt`, `confidenceScore`, `tags`, `ttlSeconds`, `validatedBy`.
  - Adicionar método `ensureIndexes()`:
    - Índice de texto: `{ content: 'text', tags: 'text' }`.
    - Índice TTL automático: `{ expiresAt: 1 }` com `{ expireAfterSeconds: 0 }`.
    - Índice composto de consulta: `{ tenantId: 1, workspaceId: 1, status: 1, createdAt: -1 }`.
  - Implementar `searchHybrid(input: HybridMemorySearchInput)` combinando vetorial + `$text` via `ReciprocalRankFusion`.
  - Filtrar por padrão apenas memórias com status `active` ou `validated` (ocultando memórias pendentes de curadoria ou expiradas).
  - Implementar métodos de ciclo de vida (`updateStatus`, `findCandidates`, `findExpired`, `purgeExpired`).

**Testes:**
- `[NEW]` `src/repositories/MongoMemoryRepository.test.ts`:
  - Teste de busca híbrida com match de termos exatos vs semântico.
  - Teste de filtragem por status (`active` vs `candidate`).
  - Teste de transição de status e deleção/expiração.

---

### 🔹 Sub-Fase 5C: Contextual Reranker Service & Integração com o Harness
**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5B

**Objetivos:**
- Criar serviço de Reranker Contextual aplicando RRF, pesos de relevância e bônus para matching de tags/entidades.
- Integrar a busca híbrida no `ContextAssembler` do `AgentHarness`.
- Atualizar o `LLMMemoryExtractor` para atribuir scores de confiança, status inicial e TTLs diferenciados por categoria.

**Arquivos a Modificar / Criar:**
- `[NEW]` `src/services/ContextualMemoryReranker.ts`:
  - Implementação de `IMemoryReranker` com pontuação composta (RRF + `importance` + correspondência de termos operacionais).
- `[NEW]` `src/services/ContextualMemoryReranker.test.ts`:
  - Validação de ordenação contextual e penalização de memórias antigas.
- `[MODIFY]` `src/infrastructure/memory/LLMMemoryExtractor.ts`:
  - Atualizar prompt de extração para retornar `confidenceScore` (0.0 a 1.0) e `tags: string[]`.
  - Configurar TTLs automáticos recomendados:
    - `incident`: 30 dias (2.592.000s)
    - `resolution`: 90 dias (7.776.000s)
    - `fact` / `knowledge` / `preference`: sem TTL fixo (indefinido)
  - Atribuir status inicial:
    - Se `confidenceScore >= 0.8` ➔ `active`
    - Se `confidenceScore < 0.8` ➔ `candidate`
- `[MODIFY]` `src/harness/ContextAssembler.ts`:
  - Injetar `searchHybrid` e `ContextualMemoryReranker` no pipeline de recuperação de memórias de longo prazo.
- `[MODIFY]` `src/config/container.ts`:
  - Instanciar `ContextualMemoryReranker` e repassar para os serviços pertinentes.

**Testes:**
- `[MODIFY]` `src/infrastructure/memory/LLMMemoryExtractor.test.ts`
- `[MODIFY]` `src/harness/ContextAssembler.test.ts`

---

### 🔹 Sub-Fase 5D: API REST de Governança de Memória (`/api/memories`)
**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5C

**Objetivos:**
- Disponibilizar endpoints administrativos REST protegidos por autenticação JWT / API Key e RBAC (`admin`, `operator`, `viewer`) para governança total das memórias corporativas.

**Novos Endpoints REST:**
| Método | Rota | Papel Mínimo | Descrição |
|---|---|---|---|
| `GET` | `/api/memories` | `viewer` | Listagem paginada de memórias com filtros (`status`, `type`, `tags`, `workspaceId`). |
| `POST` | `/api/memories/search` | `viewer` | Execução manual de busca híbrida para inspeção operacional de relevância. |
| `GET` | `/api/memories/candidates` | `operator` | Fila de memórias candidatas pendentes de validação ou curadoria. |
| `PATCH` | `/api/memories/:id/status` | `operator` | Alteração manual de status (`validated`, `active`, `expired`). |
| `PUT` | `/api/memories/:id` | `operator` | Edição de conteúdo, importância ou tags de uma memória. |
| `DELETE` | `/api/memories/:id` | `admin` | Remoção definitiva ou invalidação manual de memória obsoleta. |

**Arquivos a Modificar / Criar:**
- `[NEW]` `src/controllers/MemoryController.ts`:
  - Controller REST com tratamento de erros, validação de payload e mapeamento multi-tenant seguro.
- `[NEW]` `src/api/memoryRouter.ts`:
  - Definição de rotas com middlewares `authMiddleware`, `requireRole` e `tenantContext`.
- `[MODIFY]` `src/app.ts`:
  - Registro de `app.use('/api', memoryRouter)`.
- `[MODIFY]` `src/config/container.ts`:
  - Instanciação e exportação de `memoryController`.

**Testes:**
- `[NEW]` `src/api/memoryRouter.test.ts`:
  - Testes de autenticação, permissões RBAC e respostas corretas para cada endpoint.
- `[NEW]` `src/controllers/MemoryController.test.ts`:
  - Testes unitários do controller cobrindo fluxos de sucesso e exceção.

---

### 🔹 Sub-Fase 5E: Teste de Integração E2E, Cobertura, Documentação & Fechamento
**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`, `project-planner`  
**Depende de:** ✅ 5D

**Objetivos:**
- Testar o fluxo completo de recuperação híbrida e ciclo de vida de ponta a ponta.
- Garantir não-regressão em toda a suíte de testes (72+ arquivos de teste existentes).
- Atualizar documentação arquitetural e de roadmap.

**Arquivos a Modificar / Criar:**
- `[NEW]` `src/harness/HybridMemoryLifecycle.integration.test.ts`:
  - Simulação de cenário real: inserção de memória com termo técnico de erro exato (`ERR_DATABASE_POOL_EXHAUSTED`), busca híbrida provando que a memória com termo exato supera documentos com alta similaridade semântica genérica, e teste do ciclo de vida com expiração programada.
- `[MODIFY]` `roadmap.md`:
  - Marcar a Fase 5 como concluída `[x]`.
  - Definir a Fase 6 (MCP Platform & Governança de Ferramentas) como próximo foco.
- `[MODIFY]` `architecture.md`:
  - Documentar a camada de Busca Híbrida (RRF) e a Máquina de Estados de Ciclo de Vida da Memória.
- `[MODIFY]` `TODO.md`:
  - Marcar todas as sub-fases 5A a 5E como concluídas.

---

## 5. Plano de Verificação & Qualidade

### Automação & Testes
1. **Testes Unitários:** Todos os novos módulos de domínio (`ReciprocalRankFusion`, `MemoryLifecycle`) e repositórios com 100% de testes unitários.
2. **Testes de Integração:** Validação da busca híbrida e do ciclo de vida no harness e controller REST.
3. **Não-Regressão Global:** Execução completa de `npm test` garantindo que todos os testes anteriores continuam passando.
4. **Build TypeScript:** Execução de `npm run build` com TypeScript em modo strict sem nenhum warning ou erro.
5. **Cobertura de Código:** Execução de `npm run test:coverage`.

---

## 6. Próximo Passo Operacional

1. Revisar o plano acima.
2. Executar a criação da branch `feature/memory-2-hybrid-lifecycle` a partir de `dev`.
3. Iniciar a execução ordenada a partir da **Sub-Fase 5A**.
