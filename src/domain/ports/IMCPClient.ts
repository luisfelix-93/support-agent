import type { ToolCall } from "../ToolCall.js";
import type { MCPInitializeResult } from "../MCPServerCapabilities.js";

export interface IMCPClient {
    /**
     * Realiza o handshake MCP completo (initialize + initialized notification).
     * Deve ser chamado antes de qualquer interação com o servidor.
     * Retorna as capacidades negociadas do servidor.
     */
    connect(): Promise<MCPInitializeResult>;

    /**
     * Indica se o handshake já foi realizado com sucesso.
     */
    isConnected(): boolean;

    // Lista dinamicamente as ferramentas suportadas pelo tenant
    listTools(): Promise<any>;

    // Executa uma ferramenta específica no servidor MCP e devolve o resultado cru
    executeTool(tool: ToolCall): Promise<any>;

    /**
     * Fecha conexões abertas e libera recursos.
     */
    close(): Promise<void>;
}