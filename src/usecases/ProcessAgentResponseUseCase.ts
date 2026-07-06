import crypto from "crypto";
import type { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";
import type { IChatProvider } from "../domain/ports/IChatProvider.js";
import type { ILLMProvider } from "../domain/ports/ILLMProvider.js";
import type { IMCPClient } from "../domain/ports/IMCPClient.js";

export class ProcessAgentResponseUse {
    constructor(
        private readonly llmProvider: ILLMProvider,
        private readonly mcpClient: IMCPClient,
        private readonly chatProvider: IChatProvider
    ){}

    async execute(context : ChatContext): Promise<void> {
        try {
           // 1. O bot pergunta ao MCP quais as ferramentas estão disponíveis e ativas
            const availableToolsResponse = await this.mcpClient.listTools();
            const availableTools = availableToolsResponse.tools;

           // 2. Envia o contexto da conversa E o schema das ferramentas para a LLM
           // A implementação da LLM precisará ser ajustada para receber esse schema dinâmico
            const llmDecision = await this.llmProvider.generateResponse(context); //, availableTools);
            
            if (llmDecision.type === 'tool_call') {
                // 3. A LLM pediu uma ferramenta. O bot bate no MCP usando o adaptador
                const mcpResult = await this.mcpClient.executeTool(llmDecision.tool);
                
                // 4. O bot empacota o resultado do MCP (que já vvem formatado/truncado) 
                // e devolve para a LLM formular a resposta humana
                context.addMessage(new Message(
                    crypto.randomUUID(),
                    'system',
                    JSON.stringify(mcpResult)
                ));
                const finalResponse = await this.llmProvider.generateResponse(context);//, availableTools);
                if (finalResponse.type === 'text') {
                    console.log("Resposta final: ", finalResponse.content);
                    await this.chatProvider.sendMessage(context.threadID, finalResponse.content);
                } else {
                    console.log("LLM solicitou outra chamada de ferramenta inesperadamente.");
                }
            } else {
                await this.chatProvider.sendMessage(context.threadID, llmDecision.content);
1            }

        } catch (error) {
            console.log("Erro no processamento: ", error);
            await this.chatProvider.sendMessage(context.threadID, "Ocorreu um erro ao processar sua solicitação no sistema");
        }
    }
}