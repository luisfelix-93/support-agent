import type { ChatContext } from "../ChatContext.js";
import type { ToolCall } from "../ToolCall.js";

export type LLMResponse =
    | { type: 'text', content: string }
    | { type: 'tool_call', tool: ToolCall };

export interface ILLMProvider {
    // Recebe o contexto e decide: ou gera texto ou pede para rodar uma ferramenta (MCP)
    generateResponse(context: ChatContext): Promise<LLMResponse>;
}
