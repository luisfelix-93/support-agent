import { LLMConfig } from "./LLMConfig.js";

export interface MCPConfig {
    url: string,
    apiKey: string
}

export class Tenant {
    constructor (
        public readonly workspaceId: string, 
        public readonly llmConfig: LLMConfig,
        public readonly mcpConfig: MCPConfig,
        public readonly isActive: boolean = true
    ) {}
}