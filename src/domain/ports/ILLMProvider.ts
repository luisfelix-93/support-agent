import type { ChatContext } from "../ChatContext.js";
import type { ToolCall } from "../ToolCall.js";

export interface LLMUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export type LLMResponse =
    | { type: 'text'; content: string; usage?: LLMUsage }
    | { type: 'tool_call'; tool: ToolCall; usage?: LLMUsage };

export interface ILLMProvider {
    readonly providerName?: string;
    readonly modelName?: string;
    generateResponse(context: ChatContext, tools?: any[]): Promise<LLMResponse>;
}
