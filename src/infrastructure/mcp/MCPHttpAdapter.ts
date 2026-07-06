import type { IMCPClient } from "../../domain/ports/IMCPClient.js";
import type { ToolCall } from "../../domain/ToolCall.js";

export class MCPHttpAdapter implements IMCPClient {
    private readonly messageUrl: string;
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string
    ){
        this.messageUrl = `${this.baseUrl}/message?api_aky=${this.apiKey}`;
    }
    async listTools(): Promise<any> {
        // Busca dinamicamente as ferramentas suportadas epelo tenant
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list"
        };
        return this.sendJsonRpc(payload);
    }

    async executeTool(tool: ToolCall): Promise<any> {
        
        console.log(`[MCP] Executando ferramenta: ${tool.name}`, tool.parameters)
        // Executa uma ferramenta específica (ex: query_loki_logs, search_knowledge_base)[cite: 1]
        const payload = {
            jsonRpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: tool.name,
                arguments: tool.parameters
            }
        }
        return this.sendJsonRpc(payload);
    }

    private async sendJsonRpc(payload: any): Promise<any> {
        try {
            const response = await fetch(this.messageUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                // Lida com erros descritos na documentação (401, 403, 429)
                throw new Error(`Erro na API do MCP: Status ${response.status}`);
            }
            const data = await response.json();

            if (data.error) {
                throw new Error(`Erro do MCP (JSON-RPC): ${data.error.message}`);
            }

            return data.result;
        } catch (error) {
            console.error("[MCP Client] Falha na comunicação:", error);
            throw error;           
        }
    }
}