# Support Agent

Agente autônomo de suporte técnico e operações (AI Support / AI Ops) baseado em LLMs com execução dinâmica de ferramentas via MCP (Model Context Protocol). Desenvolvido sob princípios de **Clean Architecture / Hexagonal Architecture**, oferece desacoplamento total entre a lógica de raciocínio agentic, provedores de inferência e integrações de infraestrutura.

---

## ⚡ Principais Capacidades

- 🤖 **Agentic Runtime (Harness)**: Loop iterativo e autônomo com guardrails de execução e limites configuráveis (`ExecutionPolicy`).
- 🌐 **Multi-Provider LLM**: Suporte dinâmico a OpenAI, Anthropic Claude, DeepSeek e Google Gemini por tenant.
- 🔧 **MCP Dinâmico**: Descoberta e invocação de ferramentas via JSON-RPC 2.0 com proteção por Circuit Breaker.
- 🧠 **Memória Híbrida**: Cache volátil em Redis (Short-Term) e recuperação semântica vetorial em MongoDB (Long-Term com embeddings 1536d) via fila BullMQ assíncrona.
- 📊 **Telemetria e Custos**: Rastreamento granular de cada execução (`AgentRun`), cálculo exato de custos em USD por modelo e API analítica.
- 📈 **Auto-Avaliação Contínua**: Avaliação assíncrona da qualidade das respostas via LLM Judge com pontuação composta e detecção de regressões.
- 🛡️ **Segurança & Multi-Tenant**: Isolamento estrito por tenant, autenticação JWT/API Key, RBAC (`admin`, `operator`, `viewer`) e criptografia AES-256-GCM em repouso.
- 💬 **Omnichannel**: Conectores para Slack e Google Chat prontos para produção.
- 🔭 **Observabilidade Nativa**: Prometheus (`/metrics`), logs estruturados Pino/Loki e tracing distribuído com OpenTelemetry e Grafana Tempo.

---

## 🚀 Como Começar (Quickstart)

### 1. Pré-requisitos
- **Node.js**: Versão 20+ (LTS recomendado)
- **Docker & Docker Compose**: Para execução dos serviços de banco e filas

### 2. Configuração de Ambiente
Copie o arquivo de exemplo e preencha as credenciais dos provedores desejados:
```bash
cp .env.example .env
```

Principais variáveis:
- `LLM_PROVIDER`: `openai` | `anthropic` | `deepseek` | `google`
- `LLM_API_KEY`: Chave de API do provedor configurado
- `REDIS_URL`: `redis://localhost:6379`
- `JWT_SECRET`: Segredo de assinatura dos tokens JWT

### 3. Subir Serviços Auxiliares
Inicie os contêineres locais de Redis e MongoDB:
```bash
docker compose up -d
```

### 4. Instalação e Execução
Instale as dependências do projeto e inicie a aplicação:
```bash
# Instalar dependências
npm install

# Modo de desenvolvimento (com hot-reload via tsx)
npm run dev
```

Para ambiente de produção:
```bash
npm run build
npm run start
```

---

## 🧪 Testes Automatizados

A suíte de testes utiliza **Vitest** com execução paralela e mocks isolados:

```bash
# Executar todos os testes
npm test

# Executar testes em modo watch contínuo
npm run test:watch

# Gerar relatório de cobertura de código
npm run test:coverage
```

---

## 💡 Instruções de Uso

### 1. Verificação de Saúde e Liveness
O endpoint `/health` valida a disponibilidade do processo e a conectividade com Redis e MongoDB:
```bash
curl http://localhost:3000/health
```

### 2. Métricas Prometheus
Consulte as métricas de performance, contagem de tokens e avaliações:
```bash
curl http://localhost:3000/metrics
```

### 3. Autenticação e Envio de Mensagem via API

1. **Autenticar e obter token JWT**:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "sua-senha-aqui"}'
```

2. **Enviar mensagem para processamento pelo agente**:
```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -d '{
    "workspaceId": "ws-production",
    "threadId": "thread-123",
    "message": "Por que minha API de pagamentos está retornando HTTP 500?"
  }'
```

---

## 📚 Central de Documentação

Para aprofundar-se nos detalhes de arquitetura, funcionalidades completas e roadmap, consulte os guias dedicados na raiz do projeto:

| Documento | Descrição |
|---|---|
| 🏛️ **[architecture.md](architecture.md)** | Arquitetura hexagonal, camadas, diagrama de runtime do Agent Harness, subsistema de memória e observabilidade. |
| ⚙️ **[features.md](features.md)** | Inventário exaustivo de recursos: Multi-LLM, ferramentas MCP, telemetria de custos, auto-avaliação e RBAC. |
| 🗺️ **[roadmap.md](roadmap.md)** | Roadmap estratégico: Fases 1 a 3 concluídas e detalhamento das Fases 4 a 7 (workflows de suporte, memória 2.0 e autonomia). |


