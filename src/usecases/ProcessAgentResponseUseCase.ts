import crypto from "crypto";
import { Message } from "../domain/Message.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";
import { IChatRepository } from "../domain/ports/IChatRepository.js";
import { LLMFactory } from "../infrastructure/llm/LLMFactory.js";
import { IChatProvider } from "../domain/ports/IChatProvider.js";
import { MCPHttpAdapter } from "../infrastructure/mcp/MCPHttpAdapter.js";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker.js";
import { ISpaceMappingRepository } from "../domain/ports/ISpaceMappingRepository.js";
import { IAgentHarness } from "../domain/ports/IAgentHarness.js";
import type { InvestigationEngine } from "../harness/InvestigationEngine.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'ProcessAgentResponseUseCase' });

export class ProcessAgentResponseUse {
    private readonly mcpClients = new Map<string, MCPHttpAdapter>();
    private readonly circuitBreakers = new Map<string, CircuitBreaker>();

    constructor(
        private readonly spaceMappingRepository: ISpaceMappingRepository,
        private readonly tenantRepository: ITenantRepository,
        private readonly chatRepository: IChatRepository,
        private readonly harness: IAgentHarness,
        private readonly investigationEngine?: InvestigationEngine
    ){}

    async execute(
        spaceId: string,
        threadId: string,
        userText: string,
        chatProvider: IChatProvider,
        expectedWorkspaceId?: string
    ): Promise<void> {
        let mcpClient: MCPHttpAdapter | null = null;
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

            // 2. Aplica a regra de negócio: adiciona a nova mensagem do usuário
            context.addMessage(new Message(crypto.randomUUID(), 'user', userText));

            // 3. Instancia provedores e ferramentas dinamicamente para este tenant
            const llmProvider = LLMFactory.create(tenant.llmConfig);
            
            const mcpConfigKey = JSON.stringify(tenant.mcpConfig);
            let cachedClient = this.mcpClients.get(mcpConfigKey);
            if (!cachedClient) {
                let circuitBreaker = this.circuitBreakers.get(tenant.workspaceId);
                if (!circuitBreaker) {
                    circuitBreaker = new CircuitBreaker({ name: `mcp-${tenant.workspaceId}` });
                    this.circuitBreakers.set(tenant.workspaceId, circuitBreaker);
                }
                cachedClient = new MCPHttpAdapter(
                    tenant.mcpConfig.url,
                    tenant.mcpConfig.apiKey,
                    25000,
                    circuitBreaker
                );
                this.mcpClients.set(mcpConfigKey, cachedClient);
            }
            mcpClient = cachedClient;

            if (!mcpClient.isConnected()) {
                await mcpClient.connect();
            }

            // Buscar as ferramentas dinamicamente do MCP Server
            let mcpTools: any[] = [];
            try {
                const toolsResponse = await mcpClient.listTools();
                mcpTools = toolsResponse.tools || [];
            } catch (toolsError) {
                log.error({ err: toolsError }, 'Erro ao obter ferramentas do MCP.');
            }

            // 4. Avaliação de Playbooks e delegação da execução ao Agent Harness Runtime
            const investigationPlan = this.investigationEngine?.evaluate(userText, context);

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

            const responseText = harnessResult.response;

            // 5. Persiste o histórico atualizado e envia a resposta ao usuário
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