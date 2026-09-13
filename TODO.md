# TODO — Fase 5: Memory 2.0 (Recuperação Híbrida & Ciclo de Vida)

> Checklist operacional de implementação organizado por sub-fases para acompanhamento contínuo da Fase 5.  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [memory-2-hybrid-lifecycle.md](memory-2-hybrid-lifecycle.md) | Roadmap: [roadmap.md](roadmap.md)  
> Fase anterior: [Fase 4 Concluída](docs/phase4-summary.md)  

---

## Sub-Fase 5A: Setup da Branch & Fundação de Domínio (Contratos e Entidades Core)

**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist` / `project-planner`  

### Implementação
- [x] Criar e publicar a branch dedicada `feature/memory-2-hybrid-lifecycle` a partir da `dev`
- [x] Atualizar `src/domain/Memory.ts`
  - [x] Adicionar tipo `MemoryStatus` (`'candidate' | 'validated' | 'active' | 'updated' | 'expired'`)
  - [x] Estender interface `Memory` com campos: `status`, `ttlSeconds`, `expiresAt`, `confidenceScore`, `validatedBy`, `tags`
  - [x] Definir interface `HybridMemorySearchInput` com pesos customizados e filtros de status/tags
  - [x] Definir interface `HybridSearchResult` com scores detalhados (vetorial, textual, RRF)
- [x] Criar `src/domain/ports/IMemoryReranker.ts`
  - [x] Definir interface `IMemoryReranker` para ordenação contextual pós-recuperação
- [x] Atualizar `src/domain/ports/IMemoryRepository.ts`
  - [x] Declarar `searchHybrid(input: HybridMemorySearchInput): Promise<HybridSearchResult[]>`
  - [x] Declarar `updateStatus(id: string, tenantId: string, status: MemoryStatus, metadata?: Record<string, unknown>): Promise<boolean>`
  - [x] Declarar `findCandidates(tenantId: string, limit?: number): Promise<Memory[]>`
  - [x] Declarar `findExpired(now?: Date, limit?: number): Promise<Memory[]>`
  - [x] Declarar `purgeExpired(now?: Date): Promise<number>`

### Testes
- [x] Criar `src/domain/MemoryLifecycle.test.ts`
  - [x] Testar regras de transição de status válidas e inválidas
  - [x] Testar sanitização e cálculo de `expiresAt` via `ttlSeconds`

### Verificação
- [x] `npm test` passa sem regressões (73/73 arquivos, 429/429 testes aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict)

---

## Sub-Fase 5B: Motor de Recuperação Híbrida & Algoritmo RRF (Reciprocal Rank Fusion)

**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5A concluída  

### Implementação
- [x] Criar `src/domain/algorithms/ReciprocalRankFusion.ts`
  - [x] Implementar algoritmo RRF puro com constante $k=60$
  - [x] Suporte a pesos customizados para rankings vetorial e textual
  - [x] Ponderação com campo `importance` da memória
- [x] Atualizar `src/repositories/MongoMemoryRepository.ts`
  - [x] Atualizar schema `MemoryDocument` com novos campos de ciclo de vida
  - [x] Configurar método `ensureIndexes()` com índice de texto MongoDB em `content` e `tags`
  - [x] Configurar índice TTL do MongoDB em `expiresAt` (`expireAfterSeconds: 0`)
  - [x] Configurar índice multi-tenant composto (`tenantId`, `workspaceId`, `status`, `createdAt`)
  - [x] Implementar método `searchHybrid` combinando busca vetorial com `$text` via RRF
  - [x] Implementar métodos de ciclo de vida (`updateStatus`, `findCandidates`, `findExpired`, `purgeExpired`)

### Testes
- [x] Criar `src/domain/algorithms/ReciprocalRankFusion.test.ts`
  - [x] Testar fusão para itens presentes em uma ou ambas as listas
  - [x] Testar ponderação de pesos e desempates
- [x] Atualizar/Criar `src/repositories/MongoMemoryRepository.test.ts`
  - [x] Testar busca híbrida com priorização de termos exatos de erro
  - [x] Testar isolamento por tenant e filtragem por status (`active` vs `candidate`)

### Verificação
- [x] `npm test` passa com 100% de sucesso (74/74 arquivos, 441/441 testes aprovados)
- [x] Compilação limpa (`npm run build`)

---

## Sub-Fase 5C: Contextual Reranker Service & Integração com o Harness

**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5B concluída  

### Implementação
- [x] Criar `src/services/ContextualMemoryReranker.ts`
  - [x] Implementar `IMemoryReranker` com heurísticas de relevância operacional e recência
- [x] Atualizar `src/infrastructure/memory/LLMMemoryExtractor.ts`
  - [x] Adicionar extração de `confidenceScore` e `tags` no prompt estruturado
  - [x] Definir TTL padrão por categoria de memória (`incident` 30d, `resolution` 90d, `fact` indefinido)
  - [x] Atribuir status inicial baseado no score de confiança (`active` >= 0.8 vs `candidate` < 0.8)
- [x] Atualizar `src/harness/ContextAssembler.ts`
  - [x] Integrar recuperação híbrida via `searchHybrid` e `ContextualMemoryReranker`
  - [x] Injetar tags contextuais formatadas no prompt de sistema
- [x] Atualizar `src/config/container.ts` com as novas dependências

### Testes
- [x] Criar `src/services/ContextualMemoryReranker.test.ts`
- [x] Atualizar `src/infrastructure/memory/LLMMemoryExtractor.test.ts`
- [x] Atualizar `src/harness/ContextAssembler.test.ts`

### Verificação
- [x] `npm test` passa sem erros (75/75 arquivos, 446/446 testes aprovados)
- [x] Compilação limpa em TypeScript strict (`npm run build`)

---

## Sub-Fase 5D: API REST de Governança de Memória (`/api/memories`)

**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist`  
**Depende de:** ✅ 5C concluída  

### Implementação
- [x] Criar `src/controllers/MemoryController.ts`
  - [x] `GET /api/memories` — Listar com filtros e paginação
  - [x] `POST /api/memories/search` — Endpoint de teste operacional de busca híbrida
  - [x] `GET /api/memories/candidates` — Fila de memórias pendentes de curadoria
  - [x] `PATCH /api/memories/:id/status` — Atualizar status de ciclo de vida com validação de máquina de estados
  - [x] `PUT /api/memories/:id` — Atualizar conteúdo e tags
  - [x] `DELETE /api/memories/:id` — Exclusão ou invalidação manual
- [x] Criar `src/api/memoryRouter.ts` com proteção de autenticação e RBAC
- [x] Registrar `memoryRouter` em `src/app.ts`
- [x] Registrar `memoryController` em `src/config/container.ts`

### Testes
- [x] Criar `src/controllers/MemoryController.test.ts` (12 testes unitários)
- [x] Criar `src/api/memoryRouter.test.ts` (8 testes de rotas e RBAC)

### Verificação
- [x] Todos os testes da API REST de memórias passam
- [x] Proteção RBAC validada (`viewer` leitura, `operator` alteração, `admin` deleção)
- [x] `npm test` passa sem regressões (77/77 arquivos, 467/467 testes aprovados)
- [x] Compilação limpa em TypeScript strict (`npm run build`)

---

## Sub-Fase 5E: Teste de Integração E2E, Cobertura, Documentação & Fechamento

**Branch:** `feature/memory-2-hybrid-lifecycle`  
**Responsável:** `backend-specialist` / `project-planner`  
**Depende de:** ✅ 5D concluída  

### Implementação
- [x] Criar teste E2E `src/harness/HybridMemoryLifecycle.integration.test.ts`
  - [x] Simular extração de memória transitória de incidente com TTL
  - [x] Provar recuperação superior de termos técnicos exatos (`ERR_DATABASE_POOL_EXHAUSTED`) sobre similaridade vetorial genérica
  - [x] Validar transição de status (`candidate` -> `validated` -> `active`) e expiração
- [x] Atualizar documentações:
  - [x] Atualizar `roadmap.md` marcando a Fase 5 como concluída `[x]` e apontando a Fase 6
  - [x] Atualizar `architecture.md` com os diagramas de Busca Híbrida (RRF) e Ciclo de Vida
  - [x] Criar `docs/phase5-summary.md` consolidando os resultados
  - [x] Atualizar coleções Postman com os endpoints de `/api/memories`

### Verificação Final
- [x] `npm test` — 100% dos testes aprovados (78/78 arquivos, 471/471 testes aprovados)
- [x] `npm run build` — compilação limpa em TypeScript strict (0 erros)
- [x] `npm run test:unit` — 100% dos testes unitários passando

---

## Definition of Done (Fase 5 Completa)

- [x] Todas as sub-fases (5A, 5B, 5C, 5D, 5E) marcadas como concluídas
- [x] Busca híbrida funcional no MongoDB combinando `$text` + vetorial via algoritmo RRF
- [x] Reranker contextual operacional garantindo prioridade a termos exatos técnicos
- [x] Máquina de estados de ciclo de vida (`candidate`, `validated`, `active`, `updated`, `expired`) com TTL ativo
- [x] API REST de governança de memórias com controle de acesso RBAC
- [x] 100% de testes automatizados passando sem regressões (471 testes)
