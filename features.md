# Funcionalidades do Support Agent

Este documento apresenta o catálogo completo de recursos e capacidades técnicas do **Support Agent**, detalhando suas funcionalidades, comportamentos operacionais e valor de negócio.

---

## 1. Runtime Agentic & Loop de Raciocínio (Agent Harness)

O agente opera através de um runtime autônomo desacoplado (`IAgentHarness`), capaz de resolver solicitações complexas por meio de raciocínio iterativo:

- **Loop Iterativo Autônomo**: Avalia a entrada do usuário, decide se necessita de informações externas e invoca ferramentas dinamicamente até formular a resposta final.
- **Rastreamento por `runId`**: Cada interação gera um identificador único (UUID v4) que amarra todos os logs, métricas, traces e registros analíticos.
- **Guardrails de Execução (`ExecutionPolicy`)**:
  - Limite rígido de **5 iterações de ferramentas** por execução para evitar loops infinitos.
  - Timeout por iteração e timeout global de processamento.
  - Interceptação forçada exigindo resposta final de síntese caso o limite seja atingido.
- **Tratamento Resiliente de Ferramentas**: Falhas ou timeouts em ferramentas não quebram o atendimento; o erro é formatado e entregue como contexto para que o LLM tente uma abordagem alternativa ou explique a situação ao usuário.

---

## 2. Suporte a Múltiplos Provedores de LLM

O sistema implementa uma camada de abstração unificada (`ILLMProvider`) que permite ao operador alternar provedores e modelos dinamicamente por tenant:

| Provedor | Modelos Suportados (Exemplos) | Protocolo / SDK |
|---|---|---|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo` | OpenAI SDK oficial (Chat Completions) |
| **Anthropic** | `claude-3-5-sonnet`, `claude-3-opus`, `claude-3-haiku` | Anthropic SDK oficial (Messages API com tool use) |
| **DeepSeek** | `deepseek-chat` (V3), `deepseek-reasoner` (R1) | OpenAI Compatible API via `baseURL` |
| **Google Gemini** | `gemini-1.5-pro`, `gemini-1.5-flash` | Google Generative AI SDK |

- **Troca Transparente**: A configuração do provedor, modelo e chave de API é definida por `tenantId` no MongoDB, sem necessidade de reiniciar a aplicação.
- **Tradução Automática de Ferramentas**: O Harness converte esquemas de ferramentas MCP para o formato nativo de function calling de cada provedor (ex: OpenAI `tools` vs Anthropic `tools`).

---

## 3. Integração Dinâmica com MCP (Model Context Protocol)

O Support Agent integra-se a servidores de ferramentas através do protocolo aberto **MCP (Model Context Protocol)** da Anthropic:

- **Handshake JSON-RPC 2.0**: Negociação em 3 etapas (`initialize` → troca de capabilities → `notifications/initialized`).
- **Descoberta Automática (`tools/list`)**: As ferramentas disponíveis no servidor MCP (como busca de logs, consulta a bancos de dados ou APIs internas) são descobertas dinamicamente na inicialização ou a cada ciclo.
- **Execução Segura (`tools/call`)**: Invocação remota com validação de esquema de entrada (JSON Schema).
- **Circuit Breaker Integrado**: Se o servidor MCP apresentar falhas consecutivas ou indisponibilidade, o circuito se abre temporariamente para evitar degradação de desempenho.

---

## 4. Memória Híbrida & Busca Semântica

O agente combina memória volátil de sessão com memória persistente vetorial para fornecer respostas altamente contextuais:

### 4.1. Short-Term Memory (Redis)
- Armazena o histórico recente da conversa por thread: `memory:short:{workspaceId}:{threadId}`.
- Permite continuidade fluida de diálogo em canais de chat.
- Expiração com TTL configurável para economia de recursos.

### 4.2. Long-Term Memory (MongoDB + Embeddings)
- Armazena memórias estruturadas categorizadas por tipo:
  - `fact`: Fatos sobre o ambiente do usuário (ex: "O servidor de homologação roda em Ubuntu 22.04").
  - `preference`: Preferências de atendimento (ex: "O usuário prefere respostas diretas com código").
  - `instruction`: Regras de negócio ou acordos de suporte específicos do tenant.
  - `summary`: Resumos consolidados de incidentes passados.
- **Busca Semântica por Cosseno**: Vetorização via OpenAI (`text-embedding-3-small`, 1536 dimensões). Ao receber uma consulta, o repositório recupera os fatos mais relevantes por similaridade matemática e os injeta no prompt.

### 4.3. Promoção Assíncrona via Fila (`MemoryPromotionWorker`)
- Após responder ao usuário, o diálogo é enfileirado no BullMQ (`memory-promotion`).
- Em segundo plano, o LLM extrai fatos relevantes, deduplica contra a base existente, gera os embeddings e persiste no MongoDB com **zero acréscimo de latência** para o usuário final.

### 4.4. Orçamento de Tokens (`ContextAssembler` & `TiktokenAdapter`)
- Calcula a contagem exata de tokens via algoritmo BPE (Byte Pair Encoding) compatível com ChatML (`cl100k_base`).
- Realiza truncamento inteligente, preservando instruções de sistema e memórias relevantes enquanto descarta mensagens históricas excedentes.

---

## 5. Telemetria de Execuções e Custos (`AgentRun`)

Cada interação processada é registrada como uma entidade imutável de telemetria:

- **Dados Registrados por Run**:
  - `runId`, `tenantId`, `workspaceId`, `threadId`.
  - Timestamp de início, término e `durationMs`.
  - Número total de iterações e status final (`completed`, `failed`, `timeout`).
  - Histórico detalhado de ferramentas invocadas (nome, argumentos, duração e status).
  - Chamadas de LLM (tokens de entrada, tokens de saída, tokens totais, latência).
- **Cálculo Automático de Custos em USD**:
  - Tabela de preços atualizada por milhão de tokens para cada modelo (OpenAI, Anthropic, Gemini, DeepSeek).
  - Custo total calculado e persistido por run.
- **API REST de Analytics (`/api/agent-runs`)**:
  - Listagem paginada com filtros por tenant, data, status e modelo.
  - Agregação de consumo financeiro total e detalhamento de gastos por tenant.
  - Relatório de ferramentas mais utilizadas, taxas de erro e latência média por ferramenta MCP.
  - Distribuição de consumo de tokens e custos por provedor/modelo.

---

## 6. Framework de Auto-Avaliação Contínua

O sistema avalia a qualidade de suas próprias respostas sem necessidade de intervenção humana imediata:

- **Pipeline Assíncrono via BullMQ**: Cada execução finalizada gera um job na fila `agent-evaluation`.
- **LLM Judge**: Um modelo avaliador analisa a pergunta do usuário, o contexto fornecido e a resposta final emitida.
- **Pontuação Composta Ponderada (0 a 1.0)**:
  - **Answer Correctness (40%)**: A resposta respondeu diretamente ao problema com precisão?
  - **Tool Selection Accuracy (25%)**: As ferramentas corretas foram chamadas com argumentos adequados?
  - **Context Relevance (15%)**: As informações recuperadas do histórico e memórias foram bem aproveitadas?
  - **Hallucination Freedom (10%)**: A resposta contém dados inventados ou não fundamentados?
  - **Memory Usefulness (10%)**: As memórias de longo prazo injetadas foram úteis?
- **Detecção de Regressão e Baseline**:
  - Agregação estatística de scores por versão de prompt ou release de software.
  - Comparações automatizadas para identificar degradação de desempenho entre versões.

---

## 7. Segurança, RBAC e Isolamento Multi-Tenant

- **Isolamento de Dados Estrito**:
  - Todas as coleções do MongoDB (`tenants`, `memories`, `agent_runs`, `evaluations`, `chat_configs`) possuem particionamento obrigatório por `tenantId` / `workspaceId`.
  - Chaves do Redis isoladas com prefixos por workspace.
- **Autenticação Dupla**:
  - Usuários e operadores autenticam-se via Bearer Token **JWT**.
  - Sistemas externos e webhooks utilizam **API Keys** por tenant.
- **Controle de Acesso Baseado em Papéis (RBAC)**:
  - `admin`: Gerenciamento completo de tenants, usuários, credenciais e configurações de segurança.
  - `operator`: Acesso a dashboards analíticos, consulta a runs de agentes e triggering de avaliações.
  - `viewer`: Consulta apenas-leitura a relatórios e métricas de desempenho.
- **Criptografia em Repouso**:
  - Credenciais de chat (Tokens de bot, signing secrets) são criptografadas antes de serem salvas no MongoDB usando **AES-256-GCM**.
- **Segurança de Credenciais**:
  - Senhas de usuários utilizam algoritmos modernos de derivação de chave com salt (Argon2id/bcrypt).

---

## 8. Integrações Omnichannel (Chat)

- **Slack Integration**:
  - Suporte ao Slack Event API (menções de bot `@SupportAgent` e mensagens diretas).
  - Validação criptográfica de assinatura (`X-Slack-Signature`) por workspace utilizando o `signingSecret` correspondente.
  - Multi-tenant dinâmico: mapeia requisições do Slack pelo `team_id`.
- **Google Chat Integration**:
  - Suporte a eventos de mensagens do Google Chat Spaces.
  - Mapeamento dinâmico de `spaceId` para `workspaceId` cadastrado.
- **Fila e Idempotência**:
  - Mensagens recebidas dos chats são despachadas para o BullMQ com chaves de deduplicação no Redis para prevenir respostas duplicadas geradas por retries automáticos das plataformas de chat.

---

## 9. Observabilidade em Tempo Real

- **Métricas Prometheus (`/metrics`)**:
  - Contadores de mensagens processadas por tenant e canal.
  - Histogramas de latência de resposta do agente e de execução de ferramentas MCP.
  - Gauges de pontuação média de avaliação (`agent_evaluation_score`).
  - Contadores de erros por tipo de exceção.
- **Logs Estruturados Pino**:
  - Saída nativa em formato JSON com carimbo de tempo ISO.
  - Injeção automática de `trace_id`, `span_id`, `runId` e `tenantId` para correlação no **Grafana Loki**.
- **Tracing Distribuído OpenTelemetry**:
  - Exportação OTLP para o **Grafana Tempo**.
  - Rastreamento ponta a ponta desde o recebimento do webhook até o despacho da mensagem de resposta.
- **Health Checks (`/health`)**:
  - Liveness probe: status do processo Node.js.
  - Readiness probe: verificação ativa de conectividade com MongoDB, Redis e workers.

---

## 10. Support Workflows & Investigação Especializada de Incidentes (Fase 4)

O Support Agent evoluiu de um bot conversacional reativo para uma **plataforma autônoma de investigação de incidentes de TI**, integrando um **Core SRE Investigation Engine** e um catálogo de **Playbooks Modulares Conectáveis (Pluggable Playbooks)**:

- **Investigation Engine (Core SRE)**:
  - Triagem inteligente de sintomas na mensagem do usuário.
  - Orquestração do ciclo universal de troubleshooting: *Triagem ➔ Hipótese ➔ Coleta de Evidências ➔ Correlação Cruzada ➔ Causa Raiz (RCA) ➔ Session Summary*.
  - Ativação transparente: conversas e dúvidas rotineiras de suporte continuam sendo respondidas de forma limpa e direta sem sobrecarga de protocolos de incidente.
- **Catálogo de Playbooks Especializados**:
  - **API & Service Errors (`ApiErrorPlaybook`)**: Especialista em erros HTTP 5xx, falhas e exceções em endpoints. Consulta logs no Grafana Loki (`loki_query_logs`) e correlaciona com taxas de requisição de falha no Prometheus (`prometheus_query`).
  - **Latency & Distributed Tracing (`LatencyTracePlaybook`)**: Diagnóstico de degradação de tempo de resposta e percentis anômalos (p95/p99). Inspeciona traces distribuídos no Grafana Tempo (`tempo_query_trace`) para isolar o span gargalo (banco, chamada RPC ou serviço externo).
  - **Kubernetes & Infrastructure (`KubernetesPlaybook`)**: Diagnóstico de pods em `CrashLoopBackOff`, eventos de `OOMKilled` (Exit Code 137), contagem de restarts e limites de CPU/Memória vs consumo real.
  - **Database & Connection Pool (`DatabasePlaybook`)**: Diagnóstico de exaustão de pool de conexões (HikariCP, etc.), detecção de queries em execução anômala (*slow queries*) e contenção por *table locks* ou *deadlocks*.
- **Investigação Cruzada (Cross-Domain)**:
  - Múltiplos playbooks podem ser ativados cooperativamente na mesma sessão (ex: erro 500 na API decorrente de esgotamento de conexões no PostgreSQL).
- **Caderno de Evidências (`EvidenceLedger`)**:
  - Estrutura de domínio para consolidação e formatação de evidências de telemetria coletadas pelo agente ao longo do ciclo iterativo.
- **Resumo Executivo de Sessão (`SessionSummary`)**:
  - Formatação corporativa padronizada ao final de cada diagnóstico, contendo: `runId`, serviço afetado, janela temporal do incidente, evidências consolidadas (logs, métricas, traces, infra, db), hipótese fundamentada de causa raiz (RCA) e ações recomendadas de mitigação e correção estrutural.
- **Autonomia Controlada (Read-Only)**:
  - O agente coleta evidências, correlaciona dados e recomenda ações de remediação, sem executar comandos destrutivos ou mutações de infraestrutura sem supervisão humana.
