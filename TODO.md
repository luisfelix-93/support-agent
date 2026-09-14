# TODO — Fase 6: MCP Platform (Multi-Server & Tool Governance)

> Checklist operacional de implementação organizado por sprints/sub-fases para acompanhamento contínuo da Fase 6.  
> Marque `[x]` conforme cada item for concluído.  
> Plano de referência: [multi-mcp-platform.md](multi-mcp-platform.md) | Roadmap: [roadmap.md](roadmap.md)  
> Fase anterior: [Fase 5 Concluída](docs/phase5-summary.md)  

---

## Sub-Fase 6A (Sprint 6.1): Core Composite MCP Client & Namespacing

**Branch:** `feature/phase-6-multi-mcp-platform`  
**Responsável:** `backend-specialist`  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar e publicar a branch dedicada `feature/phase-6-multi-mcp-platform`
- [x] Criar contratos e tipos em `src/domain/ports/IMCPClient.ts` / `src/domain/MCPServerRegistration.ts`:
  - [x] Definir tipo `MCPServerRegistration` (`id`, `name`, `client: IMCPClient`, `domains`, `isDefault`)
  - [x] Definir opções de descoberta contextual `ToolFilterOptions` (`domains?: string[]`, `playbookIds?: string[]`)
- [x] Criar classe `CompositeMCPClient` implementando `IMCPClient` em `src/infrastructure/mcp/CompositeMCPClient.ts`:
  - [x] Método `registerServer(registration: MCPServerRegistration): void`
  - [x] Método `connect(): Promise<MCPInitializeResult>` conectando em paralelo (`Promise.allSettled`)
  - [x] Método `isConnected(): boolean` (retorna true se ao menos um servidor saudável estiver conectado)
  - [x] Método `listTools(options?: ToolFilterOptions): Promise<{ tools: any[] }>` com namespacing `<serverId>__<toolName>`
  - [x] Método `executeTool(tool: ToolCall): Promise<any>` com extração de namespace e encaminhamento ao adapter alvo
  - [x] Método `close(): Promise<void>` liberando conexões filhas
- [x] Implementar isolamento de Circuit Breaker e timeout defensivo por servidor registrado

### Testes
- [x] Criar `src/infrastructure/mcp/CompositeMCPClient.test.ts` (20 testes unitários)
  - [x] Testar registro de múltiplos servidores e agregação com prefixos de namespace
  - [x] Testar roteamento correto do `executeTool` com remoção do prefixo no envio ao servidor destino
  - [x] Testar tolerância a falhas parciais no `connect` (1 servidor off não impede os outros)
  - [x] Testar isolamento de falhas e Circuit Breaker independente por servidor

### Verificação
- [x] `npm test` passa sem regressões (79/79 arquivos, 491/491 testes aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict 0 erros)

---

## Sub-Fase 6B (Sprint 6.2): Configuração Multi-Tenant & Persistência Criptografada

**Branch:** `feature/phase-6-multi-mcp-platform`  
**Responsável:** `database-architect` / `backend-specialist`  
**Depende de:** ✅ Sub-Fase 6A concluída  
**Status:** ✅ Concluída  

### Implementação
- [x] Atualizar entidade `Tenant` em `src/domain/Tenant.ts`:
  - [x] Definir interface `MCPServerConfig` (`id`, `name`, `url`, `apiKey?`, `domains?`, `timeoutMs?`, `enabled?`)
  - [x] Adicionar campo opcional `mcpServers?: MCPServerConfig[]` mantendo `mcpConfig?: MCPConfig` para retrocompatibilidade
- [x] Atualizar `src/repositories/TenantRepository.ts`:
  - [x] Criptografia AES-256-GCM para as API Keys de todos os servidores da lista `mcpServers` ao persistir no MongoDB
  - [x] Descriptografia segura de cada `apiKey` ao carregar o tenant do banco
  - [x] Mascaramento de segurança em consultas administrativas (`maskApiKey`)
  - [x] Suporte bidirecional a tenants legados com apenas `mcpConfig`
- [x] Atualizar `src/usecases/RegisterTenantUseCase.ts`:
  - [x] Aceitar lista de servidores MCP no input (`mcpServers`)
  - [x] Validação de integridade (IDs de servidores únicos, URLs válidas)
- [x] Atualizar `src/controllers/OnboardingController.ts` para receber e validar payload multi-MCP

### Testes
- [x] Atualizar `src/repositories/TenantRepository.test.ts`:
  - [x] Testar salvamento e criptografia de múltiplos servidores MCP
  - [x] Testar carregamento com descriptografia correta
  - [x] Testar retrocompatibilidade com documentos legados (single `mcpConfig`)
- [x] Atualizar `src/usecases/RegisterTenantUseCase.test.ts` (9 testes)
- [x] Criar `src/controllers/OnboardingController.test.ts` (11 testes)

### Verificação
- [x] `npm test` passa com 100% de sucesso (80/80 arquivos, 509/509 testes aprovados)
- [x] `npm run build` compila sem erros (TypeScript strict 0 erros)

---

## Sub-Fase 6C (Sprint 6.3): Tool Governance & Política de Risco

**Branch:** `feature/phase-6-multi-mcp-platform`  
**Responsável:** `security-auditor` / `backend-specialist`  
**Depende de:** ✅ Sub-Fase 6B concluída  
**Status:** ✅ Concluída  

### Implementação
- [x] Criar enum e tipos de governança em `src/domain/ToolGovernance.ts`:
  - [x] `ToolRiskLevel` (`READ_ONLY`, `LOW_RISK`, `HIGH_RISK`, `FORBIDDEN`)
  - [x] Interface `ToolGovernancePolicy` (regras por regex/nomes exatos e overrides por tenant)
- [x] Criar serviço `src/services/ToolGovernanceService.ts`:
  - [x] Classificação automática de ferramentas por padrões (`get_*`, `list_*`, `query_*` $\to$ `READ_ONLY`)
  - [x] Padrões destrutivos (`delete_*`, `drop_*`, `truncate_*`, `kill_*`, `purge_*` $\to$ `FORBIDDEN`)
  - [x] Ações operacionais com impacto (`restart_*`, `scale_*`, `deploy_*` $\to$ `HIGH_RISK`)
  - [x] Validação de permissão de execução: `canExecute(toolCall, tenantPolicy)`
- [x] Integrar interceptador de governança em `CompositeMCPClient` e `AgentHarness`:
  - [x] Bloqueio imediato com registro de auditoria para ferramentas `FORBIDDEN`
  - [x] Tratamento seguro de recusa sem quebra do fluxo do agente

### Testes
- [x] Criar `src/services/ToolGovernanceService.test.ts` (17 testes unitários):
  - [x] Testar classificação padrão para ferramentas de SRE / Investigação
  - [x] Testar bloqueio de comandos destrutivos (`FORBIDDEN`)
  - [x] Testar regras de override específicas por tenant
- [x] Testar interceptação de governança no `CompositeMCPClient` (20 testes integrados)

### Verificação
- [x] `npm test` passa sem erros (81/81 arquivos, 526/526 testes aprovados)
- [x] `npm run build` compila limpo (TypeScript strict 0 erros)

---

## Sub-Fase 6D (Sprint 6.4): Tool Discovery Contextual, Integração E2E & Documentação

**Branch:** `feature/phase-6-multi-mcp-platform`  
**Responsável:** `backend-specialist` / `project-planner`  
**Depende de:** Sub-Fase 6C concluída  
**Status:** ⏳ Pendente  

### Implementação
- [ ] Atualizar `src/usecases/ProcessAgentResponseUseCase.ts`:
  - [ ] Instanciar `CompositeMCPClient` alimentado com os servidores do tenant
  - [ ] Filtrar ferramentas ativas contextualmente usando os `playbookIds` e domínios avaliados pelo `InvestigationEngine`
- [ ] Atualizar container de injeção de dependências em `src/config/container.ts`
- [ ] Criar teste de integração E2E em `src/harness/MultiMCPInvestigation.integration.test.ts`:
  - [ ] Configurar cenário de teste com 2 servidores MCP ativos (ex: `k8s-mcp` e `observability-mcp`)
  - [ ] Simular investigação autônoma cruzada executando ferramentas de ambos os servidores com namespacing
  - [ ] Validar que o `EvidenceLedger` e o `SessionSummary` consolidam evidências vindas de múltiplos servidores
- [ ] Atualizar documentações:
  - [ ] Atualizar `roadmap.md` marcando a Fase 6 como concluída `[x]`
  - [ ] Atualizar `architecture.md` com o diagrama do `CompositeMCPClient` e catálogo multi-servidor
  - [ ] Criar `docs/phase6-summary.md` consolidando entregas e métricas
  - [ ] Atualizar coleções Postman com novos exemplos de payload de onboarding

### Verificação Final
- [ ] `npm test` — 100% dos testes aprovados
- [ ] `npm run test:integration` — 100% dos testes de integração passando
- [ ] `npm run build` — 0 erros de compilação TypeScript strict

---

## Definition of Done (Fase 6 Completa)

- [ ] Todas as sub-fases (6A, 6B, 6C, 6D) concluídas e testadas
- [ ] `CompositeMCPClient` roteia perfeitamente chamadas com namespacing para 2 ou mais servidores MCP
- [ ] Isolamento de falhas: queda de um servidor MCP não derruba as ferramentas dos outros servidores
- [ ] Criptografia AES-256-GCM ativa para todos os servidores MCP cadastrados por tenant
- [ ] Governança ativa bloqueando ferramentas destrutivas (`FORBIDDEN`)
- [ ] Descoberta contextual de ferramentas integrada aos playbooks do `InvestigationEngine`
- [ ] Suíte de testes automatizados com cobertura total sem regressões

---

## Histórico de Fases Anteriores Concluídas

<details>
<summary><b>Fase 5: Memory 2.0 (Recuperação Híbrida & Ciclo de Vida) — Concluída ✅</b></summary>

- [x] Sub-Fase 5A: Setup da Branch & Fundação de Domínio (Contratos e Entidades Core)
- [x] Sub-Fase 5B: Motor de Recuperação Híbrida & Algoritmo RRF (Reciprocal Rank Fusion)
- [x] Sub-Fase 5C: Contextual Reranker Service & Integração com o Harness
- [x] Sub-Fase 5D: API REST de Governança de Memória (`/api/memories`)
- [x] Sub-Fase 5E: Teste de Integração E2E, Cobertura, Documentação & Fechamento
- [x] 100% de testes aprovados (78 arquivos, 471 testes)
- [x] Documento consolidado: [docs/phase5-summary.md](docs/phase5-summary.md)
</details>
