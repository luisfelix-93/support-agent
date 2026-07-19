import crypto from "crypto";
import type { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";
import { IChatRepository } from "../domain/ports/IChatRepository.js";
import { LLMFactory } from "../infrastructure/llm/LLMFactory.js";
import { IChatProvider } from "../domain/ports/IChatProvider.js";
import { MCPHttpAdapter } from "../infrastructure/mcp/MCPHttpAdapter.js";
import { ISpaceMappingRepository } from "../domain/ports/ISpaceMappingRepository.js";


export class ProcessAgentResponseUse {
    private readonly mcpClients = new Map<string, MCPHttpAdapter>();

    constructor(
        private readonly spaceMappingRepository: ISpaceMappingRepository,
        private readonly tenantRepository: ITenantRepository,
        private readonly chatRepository: IChatRepository,
    ){}

    async execute(spaceId: string, threadId: string, userText: string, chatProvider: IChatProvider): Promise<void> {
        let mcpClient: MCPHttpAdapter | null = null;
        try {

            // 0. Descobre a qual Tenant esse espaço de chat pertence
            const mapping = await this.spaceMappingRepository.findBySpaceId(spaceId);

            if (!mapping) {
                await chatProvider.sendMessage(threadId, "Este espaço não está configurado.");
                return;
            }

            const workspaceId = mapping.workspaceId;

            // 1. Busca os dados via repositórios (isolando a persistencia do Controller e UseCase)
            const tenant = await this.tenantRepository.findByWorkspaceId(workspaceId);
            if (!tenant || !tenant.isActive) {
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
                cachedClient = new MCPHttpAdapter(tenant.mcpConfig.url, tenant.mcpConfig.apiKey);
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
                console.error("Erro ao obter ferramentas do MCP: ", toolsError);
            }

            // 4. Loop de execução LLM ↔ MCP (máximo 5 iterações consecutivas)
            const MAX_TOOL_ITERATIONS = 5;
            let responseText = '';
            let currentDecision = await llmProvider.generateResponse(context, mcpTools);
            let iteration = 0;

            while (currentDecision.type === 'tool_call' && iteration < MAX_TOOL_ITERATIONS) {
                iteration++;
                console.log(`[ProcessAgentResponseUseCase] Iteração ${iteration}/${MAX_TOOL_ITERATIONS} — LLM solicitou ferramenta: ${currentDecision.tool.name}`);

                let mcpResult: any;
                try {
                    mcpResult = await mcpClient.executeTool(currentDecision.tool);
                } catch (toolError: any) {
                    console.error(`[ProcessAgentResponseUseCase] Erro ao executar ferramenta ${currentDecision.tool.name}:`, toolError);
                    mcpResult = {
                        error: `Falha na execução da ferramenta: ${toolError?.message ?? (typeof toolError === 'string' ? toolError : JSON.stringify(toolError))}`
                    };
                }

                context.addMessage(new Message(crypto.randomUUID(), 'system', JSON.stringify(mcpResult)));

                currentDecision = await llmProvider.generateResponse(context, mcpTools);
            }

            if (currentDecision.type === 'text') {
                responseText = currentDecision.content;
            } else if (iteration >= MAX_TOOL_ITERATIONS) {
                console.warn(`[ProcessAgentResponseUseCase] Limite de ${MAX_TOOL_ITERATIONS} iterações atingido. Forçando resposta final.`);
                context.addMessage(new Message(crypto.randomUUID(), 'system', 'Limite de chamadas de ferramentas atingido. Resuma as informações coletadas e responda ao usuário.'));
                const fallback = await llmProvider.generateResponse(context, []);
                responseText = fallback.type === 'text'
                    ? fallback.content
                    : 'Desculpe, não consegui completar a análise no momento.';
            }
            // 5. Adiciona a resposta do assistente ao contexto
            if (responseText) {
                context.addMessage(new Message(crypto.randomUUID(), 'assistant', responseText));

                // 6. Persiste o estado atualizado
                await this.chatRepository.save(context);

                // 7. Envia a resposta ao usuário
                await chatProvider.sendMessage(threadId, responseText);
            }
        } catch (error) {
            console.error("Erro no processamento: ", error);
            await chatProvider.sendMessage(threadId, "Ocorreu um erro ao processar sua solicitação.");
        }
    }
}