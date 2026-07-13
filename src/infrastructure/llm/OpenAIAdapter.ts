import OpenAI from "openai";
import type { ILLMProvider, LLMResponse } from "../../domain/ports/ILLMProvider.js";
import type { ChatContext } from "../../domain/ChatContext.js";
import { ToolCall } from "../../domain/ToolCall.js";

export class OpenAIAdapter implements ILLMProvider{
    private client: OpenAI;

    constructor(
        private apiKey: string,
        private model: string,
        baseUrl?: string
    ){
        this.client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: baseUrl // vital para injetar o endpoint do DeepSeek
        })
    }

    async generateResponse(context: ChatContext, tools?: any[]): Promise<LLMResponse> {
        // 1. Traduzir o ChatContext do domínio para o formato da OpenAI
        const messages = context.messages.map(msg => ({
            role: msg.role === 'system' && this.model.includes('deepseek') ? 'user' : msg.role,
            content: msg.content
        }));

        // Ferramentas disponíveis no MCP mapeadas dinamicamente
        const openAITools = tools && tools.length > 0 ? tools.map(t => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description || "",
                parameters: t.inputSchema || { type: "object", properties: {} }
            }
        })) : undefined;

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: messages as any,
            tools: openAITools as any
        });

        const choice = response.choices[0];
        if (!choice) {
            throw new Error("No response choices returned from OpenAI API");
        }

        // 2. Traduzir a resposta proprietária de volta para o domínio
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            const toolCall = choice.message.tool_calls[0];
            if (toolCall && toolCall.type === 'function') {
                return {
                    type: 'tool_call',
                    tool: new ToolCall(
                        toolCall.function.name, 
                        JSON.parse(toolCall.function.arguments)
                    )
                };
            }
        }

        return {
            type: 'text',
            content: choice.message.content || ''
        };
    }
}