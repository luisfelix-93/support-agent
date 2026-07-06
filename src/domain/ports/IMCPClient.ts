import type { ToolCall } from "../ToolCall.js";

export interface IMCPClient {
    //Lista dinamicamente as ferramentas suportadas pelo tenant
    listTools(): Promise<any>;
    // Executa uma ferramenta específica no servidor MCP e devolve o resultado cru
    executeTool(tool: ToolCall): Promise<any>;
}