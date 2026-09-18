import crypto from "crypto";
import { Message } from "../domain/Message.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";
import { IChatRepository } from "../domain/ports/IChatRepository.js";
import { LLMFactory } from "../infrastructure/llm/LLMFactory.js";
import { IChatProvider } from "../domain/ports/IChatProvider.js";
import { MCPHttpAdapter } from "../infrastructure/mcp/MCPHttpAdapter.js";
import { CompositeMCPClient } from "../infrastructure/mcp/CompositeMCPClient.js";
import type { IMCPClient, ToolFilterOptions } from "../domain/ports/IMCPClient.js";
import type { MCPServerRegistration } from "../domain/MCPServerRegistration.js";
import type { ToolGovernanceService } from "../services/ToolGovernanceService.js";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker.js";
import { ISpaceMappingRepository } from "../domain/ports/ISpaceMappingRepository.js";
import { IAgentHarness } from "../domain/ports/IAgentHarness.js";
import type { InvestigationEngine } from "../harness/InvestigationEngine.js";
import type { ISessionRepository } from "../domain/ports/ISessionRepository.js";
import { InvestigationSession } from "../domain/InvestigationSession.js";
import { SessionStatus } from "../domain/SessionStatus.js";
import { ClosureIntentDetector } from "../services/ClosureIntentDetector.js";
import {
    agentSessionsTotal,
    agentSessionsClosedTotal,
    agentSessionDurationSeconds,
} from "../infrastructure/metrics/AgentMetrics.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'ProcessAgentResponseUseCase' });

export class ProcessAgentResponseUse {
    private readonly mcpClients = new Map<string, IMCPClient>();
    private readonly circuitBreakers = new Map<string, CircuitBreaker>();

    constructor(
        private readonly spaceMappingRepository: ISpaceMappingRepository,
        private readonly tenantRepository: ITenantRepository,
        private readonly chatRepository: IChatRepository,
        private readonly harness: IAgentHarness,
        private readonly investigationEngine?: InvestigationEngine,
        private readonly toolGovernanceService?: ToolGovernanceService,
        private readonly sessionRepository?: ISessionRepository,
        private readonly closureIntentDetector: ClosureIntentDetector = new ClosureIntentDetector()
    ){}

    async execute(
        spaceId: string,
        threadId: string,
        userText: string,
        chatProvider: IChatProvider,
        expectedWorkspaceId?: string
    ): Promise<void> {
        let mcpClient: IMCPClient | null = null;
        try {
            // 0. Descobre a qual Tenant esse espaço de chat pertence
            const mapping = await this.spaceMappingRepository.findBySpaceId(spaceId);

            if (!mapping) {
                await chatProvider.sendMessage(threadId, "Este espaço não está configurado.");
                return;
            }

            const workspaceId = mapping.workspaceId;

            // Guard cross-tenant: valida workspaceId esperado contra o workspaceId do mapping
            if (expectedWorkspaceId && mapping.workspaceId !== expectedWorkspaceId) {
                log.warn(
                    { spaceId, mappingWorkspaceId: mapping.workspaceId, expectedWorkspaceId },
                    'Tentativa de acesso cross-tenant detectada: divergência entre workspace esperado e mapeado.'
                );
                await chatProvider.sendMessage(threadId, "Desculpe, não consigo te atender neste momento.");
                return;
            }

            // 1. Busca os dados via repositórios (isolando a persistencia do Controller e UseCase)
            const tenant = await this.tenantRepository.findByWorkspaceId(workspaceId);
            if (!tenant || !tenant.isActive) {
                await chatProvider.sendMessage(threadId, "Desculpe, não consigo te atender neste momento.");
                return;
            }

            // Guard de consistência: garante que a entidade do tenant corresponde exatamente ao workspace do mapping
            if (tenant.workspaceId !== workspaceId) {
                log.warn(
                    { mappingWorkspaceId: workspaceId, tenantWorkspaceId: tenant.workspaceId },
                    'Divergência de tenant detectada entre mapping e entidade de tenant.'
                );
                await chatProvider.sendMessage(threadId, "Desculpe, não consigo te atender neste momento.");
                return;
            }

            // O repositório já devolve um ChatContext hidratado com o histórico caso exista
            const context = await this.chatRepository.findById(threadId, workspaceId);

            // 1.1 Gestão do Ciclo de Vida da Sessão de Investigação (se sessionRepository configurado)
            let session: InvestigationSession | null = null;
            if (this.sessionRepository) {
                session = await this.sessionRepository.findActiveByThreadId(threadId, workspaceId);

                // Cenário A: Sessão aguardando confirmação do operador
                if (session && session.status === SessionStatus.AWAITING_CLOSURE_CONFIRMATION) {
                    const intent = this.closureIntentDetector.detectIntent(userText, true);

                    if (intent === 'CONFIRM_CLOSURE') {
                        const summary = session.sessionSummary;
                        session.confirmClosure(summary ?? undefined);
                        await this.sessionRepository.save(session);

                        agentSessionsClosedTotal.inc({ workspaceId: session.workspaceId, reason: 'user' });
                        if (session.closedAt) {
                            const durationSec = Math.max(0, (session.closedAt.getTime() - session.startedAt.getTime()) / 1000);
                            agentSessionDurationSeconds.observe({ workspaceId: session.workspaceId, reason: 'user' }, durationSec);
                        }

                        const summaryMarkdown = summary ? `\n\n${summary.toMarkdown()}` : '';
                        const closureMessage = `✅ **Sessão de investigação encerrada com sucesso.**${summaryMarkdown}`;

                        context.addMessage(new Message(crypto.randomUUID(), 'user', userText));
                        context.addMessage(new Message(crypto.randomUUID(), 'assistant', closureMessage));
                        await this.chatRepository.save(context);
                        await chatProvider.sendMessage(threadId, closureMessage);
                        return;
                    } else if (intent === 'REJECT_CLOSURE') {
                        session.cancelClosureProposal();
                        session.touch();
                        await this.sessionRepository.save(session);
                    }
                } else if (session) {
                    // Cenário B: Comando explícito de encerramento enviado a qualquer momento (ex: /encerrar)
                    const intent = this.closureIntentDetector.detectIntent(userText, false);
                    if (intent === 'CONFIRM_CLOSURE') {
                        const summary = session.sessionSummary;
                        session.confirmClosure(summary ?? undefined);
                        await this.sessionRepository.save(session);

                        agentSessionsClosedTotal.inc({ workspaceId: session.workspaceId, reason: 'user' });
                        if (session.closedAt) {
                            const durationSec = Math.max(0, (session.closedAt.getTime() - session.startedAt.getTime()) / 1000);
                            agentSessionDurationSeconds.observe({ workspaceId: session.workspaceId, reason: 'user' }, durationSec);
                        }

                        const summaryMarkdown = summary ? `\n\n${summary.toMarkdown()}` : '';
                        const closureMessage = `✅ **Sessão de investigação encerrada com sucesso pelo operador.**${summaryMarkdown}`;

                        context.addMessage(new Message(crypto.randomUUID(), 'user', userText));
                        context.addMessage(new Message(crypto.randomUUID(), 'assistant', closureMessage));
                        await this.chatRepository.save(context);
                        await chatProvider.sendMessage(threadId, closureMessage);
                        return;
                    }

                    session.touch();
                } else {
                    // Cenário C: Criação de nova sessão para este thread
                    session = new InvestigationSession({
                        id: crypto.randomUUID(),
                        workspaceId,
                        threadId,
                        channelId: spaceId,
                    });
                    agentSessionsTotal.inc({ workspaceId: session.workspaceId });
                }
            }


            // 2. Aplica a regra de negócio: adiciona a nova mensagem do usuário
            context.addMessage(new Message(crypto.randomUUID(), 'user', userText));

            // 3. Instancia provedores e ferramentas dinamicamente para este tenant
            const llmProvider = LLMFactory.create(tenant.llmConfig);

            // 4. Avaliação de Playbooks e descoberta contextual de ferramentas
            const investigationPlan = this.investigationEngine?.evaluate(userText, context);

            // 5. Instanciação e cache do MCPClient (suporte a single server e Multi-MCP Composite)
            const isMultiMcp = Boolean(tenant.mcpServers && tenant.mcpServers.length > 1);
            const mcpConfigKey = JSON.stringify(tenant.mcpServers && tenant.mcpServers.length > 0 ? tenant.mcpServers : tenant.mcpConfig);

            let cachedClient = this.mcpClients.get(mcpConfigKey);
            if (!cachedClient) {
                if (isMultiMcp) {
                    const serverRegistrations: MCPServerRegistration[] = (tenant.mcpServers ?? [])
                        .filter(s => s.enabled !== false)
                        .map(serverConfig => {
                            const cbKey = `${tenant.workspaceId}-${serverConfig.id}`;
                            let circuitBreaker = this.circuitBreakers.get(cbKey);
                            if (!circuitBreaker) {
                                circuitBreaker = new CircuitBreaker({ name: `mcp-${cbKey}` });
                                this.circuitBreakers.set(cbKey, circuitBreaker);
                            }
                            const adapter = new MCPHttpAdapter(
                                serverConfig.url,
                                serverConfig.apiKey ?? '',
                                serverConfig.timeoutMs ?? 25000,
                                circuitBreaker
                            );
                            return {
                                id: serverConfig.id,
                                name: serverConfig.name,
                                client: adapter,
                                domains: serverConfig.domains,
                            };
                        });

                    cachedClient = new CompositeMCPClient(
                        serverRegistrations,
                        this.toolGovernanceService
                    );
                } else {
                    let circuitBreaker = this.circuitBreakers.get(tenant.workspaceId);
                    if (!circuitBreaker) {
                        circuitBreaker = new CircuitBreaker({ name: `mcp-${tenant.workspaceId}` });
                        this.circuitBreakers.set(tenant.workspaceId, circuitBreaker);
                    }
                    const singleConfig = (tenant.mcpServers && tenant.mcpServers.length === 1)
                        ? tenant.mcpServers[0]
                        : tenant.mcpConfig;

                    cachedClient = new MCPHttpAdapter(
                        singleConfig.url,
                        singleConfig.apiKey ?? '',
                        25000,
                        circuitBreaker
                    );
                }
                this.mcpClients.set(mcpConfigKey, cachedClient);
            }
            mcpClient = cachedClient;

            if (!mcpClient.isConnected()) {
                await mcpClient.connect();
            }

            // Buscar as ferramentas dinamicamente do MCP Server com filtro contextual
            let mcpTools: any[] = [];
            try {
                const filterOptions: ToolFilterOptions = {};
                if (investigationPlan?.domains && investigationPlan.domains.length > 0) {
                    filterOptions.domains = investigationPlan.domains;
                }
                if (investigationPlan?.playbookIds && investigationPlan.playbookIds.length > 0) {
                    filterOptions.playbookIds = investigationPlan.playbookIds;
                }
                const toolsResponse = await mcpClient.listTools(
                    Object.keys(filterOptions).length > 0 ? filterOptions : undefined
                );
                mcpTools = toolsResponse.tools || [];
            } catch (toolsError) {
                log.error({ err: toolsError }, 'Erro ao obter ferramentas do MCP.');
            }

            const harnessResult = await this.harness.run({
                tenantId: tenant.workspaceId,
                workspaceId,
                threadId,
                userMessage: userText,
                context,
                llmProvider,
                mcpClient,
                tools: mcpTools,
                systemInstructions: investigationPlan?.systemInstructions,
                playbookIds: investigationPlan?.playbookIds,
            });

            let responseText = harnessResult.response;

            // 5. Avalia emissão de SessionSummary e proposta de encerramento
            if (this.sessionRepository && session) {
                if (this.investigationEngine && responseText) {
                    const extractedSummary = this.investigationEngine.extractSessionSummary(
                        responseText,
                        harnessResult.runId,
                        investigationPlan?.playbookIds
                    );

                    if (extractedSummary) {
                        session.setSessionSummary(extractedSummary);
                        session.proposeClosure();

                        const closurePrompt = '\n\n💡 **Deseja encerrar esta sessão de investigação e confirmar o Resumo Executivo acima?** (Responda *"Sim"* para confirmar ou continue perguntando para aprofundar a análise)';
                        responseText += closurePrompt;
                    }
                }

                session.touch();
                await this.sessionRepository.save(session);
            }

            // 6. Persiste o histórico atualizado e envia a resposta ao usuário
            if (responseText) {
                context.addMessage(new Message(crypto.randomUUID(), 'assistant', responseText));
                await this.chatRepository.save(context);
                await chatProvider.sendMessage(threadId, responseText);
            }
        } catch (error) {
            log.error({ err: error, spaceId, threadId }, 'Erro no processamento da mensagem.');
            await chatProvider.sendMessage(threadId, "Ocorreu um erro ao processar sua solicitação.");
        }
    }
}