/**
 * Representa as informações de identificação do servidor MCP.
 */
export interface MCPServerInfo {
    readonly name: string;
    readonly version: string;
}

/**
 * Representa as capacidades anunciadas pelo servidor MCP durante o handshake.
 * Cada campo opcional indica se o servidor suporta aquela feature.
 */
export interface MCPCapabilities {
    readonly tools?: { listChanged?: boolean };
    readonly resources?: { subscribe?: boolean; listChanged?: boolean };
    readonly prompts?: { listChanged?: boolean };
}

/**
 * Resultado do handshake de inicialização com o servidor MCP.
 * Contém a versão do protocolo negociada, capacidades do servidor e suas informações.
 */
export interface MCPInitializeResult {
    readonly protocolVersion: string;
    readonly capabilities: MCPCapabilities;
    readonly serverInfo: MCPServerInfo;
}
