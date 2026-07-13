import Anthropic from "@anthropic-ai/sdk";
import type { ILLMProvider, LLMResponse } from "../../domain/ports/ILLMProvider.js";
import type { ChatContext } from "../../domain/ChatContext.js";
import { ToolCall } from "../../domain/ToolCall.js";


export class AnthropicAdapter implements ILLMProvider {
    private client: Anthropic

    constructor(private apiKey: string, private model: string){
        this.client = new Anthropic({ apiKey: this.apiKey })
    }

    async generateResponse(context: ChatContext, tools?: any[]): Promise<LLMResponse> {
        // Anthropic separa as mensagens do "System Prompt"
        const systemMessages = context.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const userMessages = context.messages.filter(m => m.role !== 'system').map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
        }));

        const anthropicTools = tools && tools.length > 0 ? tools.map(t => ({
            name: t.name,
            description: t.description || "",
            input_schema: t.inputSchema || { type: "object", properties: {} }
        })) : undefined;

        const payload: any = {
            model: this.model,
            system: systemMessages, 
            messages: userMessages as any,
            max_tokens: 1024,
        };
        if (anthropicTools && anthropicTools.length > 0) {
            payload.tools = anthropicTools;
        }

        const response = await this.client.messages.create(payload);

        // O Claude retorna tool_use no array do content
        const toolUseBlock = response.content.find(block => block.type === 'tool_use');

        if (toolUseBlock && toolUseBlock.type === 'tool_use') {
            return {
                type: 'tool_call',
                tool: new ToolCall(toolUseBlock.name, toolUseBlock.input as any)
            }
        }

        const textBlock = response.content.find(block => block.type === 'text');
        return {
            type: 'text',
            content: textBlock?.type === 'text' ? textBlock.text : ''
        };
    }
}