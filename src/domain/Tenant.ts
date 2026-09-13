import { LLMConfig } from "./LLMConfig.js";

export interface MCPConfig {
    url: string;
    apiKey: string;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    url: string;
    apiKey?: string;
    domains?: string[];
    timeoutMs?: number;
    enabled?: boolean;
}

export class Tenant {
    public readonly mcpServers: MCPServerConfig[];

    constructor(
        public readonly workspaceId: string,
        public readonly llmConfig: LLMConfig,
        public readonly mcpConfig: MCPConfig,
        public readonly isActive: boolean = true,
        mcpServers?: MCPServerConfig[]
    ) {
        if (mcpServers && mcpServers.length > 0) {
            this.mcpServers = mcpServers;
        } else if (mcpConfig && mcpConfig.url) {
            this.mcpServers = [{
                id: 'default',
                name: 'Default MCP Server',
                url: mcpConfig.url,
                apiKey: mcpConfig.apiKey ?? '',
                enabled: true
            }];
        } else {
            this.mcpServers = [];
        }
    }
}