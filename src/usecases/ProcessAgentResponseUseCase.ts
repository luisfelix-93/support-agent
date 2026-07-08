import crypto from "crypto";
import type { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";
import { IChatRepository } from "../domain/ports/IChatRepository.js";
import { LLMFactory } from "../infrastructure/llm/LLMFactory.js";
import { IChatProvider } from "../domain/ports/IChatProvider.js";
import { MCPHttpAdapter } from "../infrastructure/mcp/MCPHttpAdapter.js";
import { response } from "express";
import { ISpaceMappingRepository } from "../domain/ports/ISpaceMappingRepository.js";


export class ProcessAgentResponseUse {
    constructor(
        private readonly spaceMappingRepository: ISpaceMappingRepository,
        private readonly tenantRepository: ITenantRepository,
        private readonly chatRepository: IChatRepository,
        private readonly chatProvider: IChatProvider
    ){}

    async execute(spaceId: string, threadId: string, userText: string): Promise<void> {
        try {

            // 0. Descobre a qual Tenant esse espaço de chat pertence
            const mapping = await this.spaceMappingRepository.findBySpaceId(spaceId);

            if (!mapping) {
                await this.chatProvider.sendMessage(threadId, "Este espaço não está configurado.");
                return;
            }

            const workspaceId = mapping.workspaceId;

            // 1. Busca os dados via repositórios (isolando a persistencia do Controller e UseCase)
            const tenant = await this.tenantRepository.findByWorkspaceId(workspaceId);
            if (!tenant || !tenant.isActive) {
                await this.chatProvider.sendMessage(threadId, "Desculpe, não consigo te atender neste momento.");
                return;
            }

            // O repositório já devolve um ChatContext hidratado com o histórico caso exista
            const context = await this.chatRepository.findById(threadId, workspaceId);

            // 2. Aplica a regra de negócio: adiciona a nova mensagem do usuário
            context.addMessage(new Message(crypto.randomUUID(), 'user', userText));

            // 3. Instancia provedores e ferramentas dinamicamente para este tenant
            const llmProvider = LLMFactory.create(tenant.llmConfig);
            const mcpClient = new MCPHttpAdapter(tenant.mcpConfig.url, tenant.mcpConfig.apiKey);

            if (!mcpClient.isConnected()) {
                await mcpClient.connect();
            }

            // 4. Monta o fluxo de LLM e MCP
            const llmDecision = await llmProvider.generateResponse(context);
            let responseText = '';

            if (llmDecision.type === 'tool_call') {
                const mcpResult = await  mcpClient.executeTool(llmDecision.tool);
                
                context.addMessage(new Message(crypto.randomUUID(), 'system', JSON.stringify(mcpResult)));

                const finalResponse = await llmProvider.generateResponse(context);
                if (finalResponse.type === 'text') {
                    responseText = finalResponse.content;
                }
            } else {
                responseText = llmDecision.content;
            }
            // 5. Adiciona a resposta do assistente ao contexto
            if (responseText) {
                context.addMessage(new Message(crypto.randomUUID(), 'assistant', responseText));

                // 6. Persiste o estado atualizado
                await this.chatRepository.save(context);

                // 7. Envia a resposta ao usuário
                await this.chatProvider.sendMessage(threadId, responseText);
            }
        } catch (error) {
            console.error("Erro no processamento: ", error);
            await this.chatProvider.sendMessage(threadId, "Ocorreu um erro ao processar sua solicitação.");
        }
    }
}