import type { IMCPClient } from "../../domain/ports/IMCPClient.js";
import type { ToolCall } from "../../domain/ToolCall.js";
import type { MCPInitializeResult, MCPCapabilities } from "../../domain/MCPServerCapabilities.js";

/**
 * Versão do protocolo MCP suportada por este cliente.
 * Usada na negociação do handshake.
 */
const MCP_PROTOCOL_VERSION = "2025-03-26";

/**
 * Informações deste cliente enviadas ao servidor durante o handshake.
 */
const CLIENT_INFO = {
    name: "support-agent",
    version: "1.0.0"
} as const;

/**
 * Adaptador HTTP para comunicação com o MCP Server.
 * 
 * Implementa o protocolo MCP sobre HTTP usando JSON-RPC 2.0.
 * O fluxo completo é:
 *   1. connect()       → Handshake (initialize + initialized notification)
 *   2. listTools()     → Descobre ferramentas disponíveis
 *   3. executeTool()   → Executa uma ferramenta específica
 * 
 * Nenhum método de operação (listTools, executeTool) pode ser chamado
 * antes do handshake ser concluído com sucesso.
 */
export class MCPHttpAdapter implements IMCPClient {
    private readonly messageUrl: string;
    private initialized: boolean = false;
    private requestCounter: number = 1;
    private serverCapabilities: MCPCapabilities | null = null;

    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string
    ){
        this.messageUrl = `${this.baseUrl}/message?api_key=${this.apiKey}`;
    }

    /**
     * Realiza o handshake MCP completo com o servidor.
     * 
     * O handshake segue a especificação MCP e consiste em 3 etapas:
     * 
     *   Passo 1 — Client envia `initialize` (JSON-RPC request)
     *     → Informa versão do protocolo, capabilities do client e clientInfo
     * 
     *   Passo 2 — Server responde com suas capabilities e serverInfo
     *     → Client armazena as capabilities negociadas
     * 
     *   Passo 3 — Client envia `notifications/initialized` (JSON-RPC notification, sem id)
     *     → Sinaliza que o client está pronto para operar
     * 
     * @throws Error se o handshake falhar ou se o servidor retornar erro JSON-RPC
     * @returns MCPInitializeResult com as capacidades negociadas do servidor
     */
    async connect(): Promise<MCPInitializeResult> {
        if (this.initialized) {
            console.log("[MCP Handshake] Conexão já inicializada, reutilizando.");
            return {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: this.serverCapabilities!,
                serverInfo: { name: "cached", version: "cached" }
            };
        }

        console.log("[MCP Handshake] Iniciando handshake com o servidor MCP...");

        // ───────────────────────────────────────────────
        // Passo 1: Enviar request `initialize`
        // ───────────────────────────────────────────────
        const initializePayload = {
            jsonrpc: "2.0",
            id: this.getNextId(),
            method: "initialize",
            params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {
                    // O client não expõe roots nem sampling por enquanto
                },
                clientInfo: CLIENT_INFO
            }
        };

        console.log("[MCP Handshake] Passo 1/3 — Enviando request 'initialize'...");
        const initResult = await this.sendJsonRpc(initializePayload);

        // Valida a resposta do servidor
        if (!initResult || !initResult.protocolVersion) {
            throw new Error(
                "[MCP Handshake] Resposta inválida do servidor: campo 'protocolVersion' ausente."
            );
        }

        const serverInfo = initResult.serverInfo ?? { name: "unknown", version: "unknown" };
        this.serverCapabilities = initResult.capabilities ?? {};

        console.log(
            `[MCP Handshake] Passo 2/3 — Servidor respondeu: ` +
            `${serverInfo.name} v${serverInfo.version} ` +
            `(protocolo: ${initResult.protocolVersion})`
        );

        // ───────────────────────────────────────────────
        // Passo 3: Enviar notification `initialized`
        // (notification = sem campo `id` no JSON-RPC)
        // ───────────────────────────────────────────────
        const initializedNotification = {
            jsonrpc: "2.0",
            method: "notifications/initialized"
            // Sem `id` → é uma notification, não espera resposta
        };

        console.log("[MCP Handshake] Passo 3/3 — Enviando notification 'initialized'...");
        await this.sendNotification(initializedNotification);

        this.initialized = true;

        const result: MCPInitializeResult = {
            protocolVersion: initResult.protocolVersion,
            capabilities: this.serverCapabilities!,
            serverInfo
        };

        console.log("[MCP Handshake] ✅ Handshake concluído com sucesso!");
        console.log(
            `[MCP Handshake] Capabilities do servidor:`,
            JSON.stringify(this.serverCapabilities, null, 2)
        );

        return result;
    }

    /**
     * Indica se o handshake já foi realizado com sucesso.
     */
    isConnected(): boolean {
        return this.initialized;
    }

    /**
     * Busca dinamicamente as ferramentas suportadas pelo tenant.
     * O handshake deve ter sido realizado antes de chamar este método.
     */
    async listTools(): Promise<any> {
        await this.ensureInitialized();

        const payload = {
            jsonrpc: "2.0",
            id: this.getNextId(),
            method: "tools/list"
        };
        return this.sendJsonRpc(payload);
    }

    /**
     * Executa uma ferramenta específica (ex: query_loki_logs, search_knowledge_base).
     * O handshake deve ter sido realizado antes de chamar este método.
     */
    async executeTool(tool: ToolCall): Promise<any> {
        await this.ensureInitialized();

        console.log(`[MCP] Executando ferramenta: ${tool.name}`, tool.parameters);

        const payload = {
            jsonrpc: "2.0",
            id: this.getNextId(),
            method: "tools/call",
            params: {
                name: tool.name,
                arguments: tool.parameters
            }
        };
        return this.sendJsonRpc(payload);
    }

    // ─────────────────────────────────────────────────────────────────
    // Métodos privados
    // ─────────────────────────────────────────────────────────────────

    /**
     * Garante que o handshake foi realizado. Se não foi, executa automaticamente.
     * Isso dá resiliência: se alguém chamar listTools() sem connect(), ele auto-conecta.
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            console.log("[MCP] Handshake pendente — conectando automaticamente...");
            await this.connect();
        }
    }

    /**
     * Envia um payload JSON-RPC que espera resposta (request com `id`).
     * Trata erros HTTP e erros JSON-RPC.
     */
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
                const statusMessages: Record<number, string> = {
                    401: "API Key inválida ou ausente",
                    403: "Acesso negado ao recurso",
                    429: "Rate limit excedido — tente novamente em instantes"
                };
                const detail = statusMessages[response.status] ?? `Status ${response.status}`;
                throw new Error(`[MCP Client] Erro HTTP: ${detail}`);
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(
                    `[MCP Client] Erro JSON-RPC (code: ${data.error.code}): ${data.error.message}`
                );
            }

            return data.result;
        } catch (error) {
            console.error("[MCP Client] Falha na comunicação:", error);
            throw error;           
        }
    }

    /**
     * Envia uma notification JSON-RPC (sem `id`, sem resposta esperada).
     * Notifications são fire-and-forget conforme a spec JSON-RPC 2.0.
     */
    private async sendNotification(payload: any): Promise<void> {
        try {
            const response = await fetch(this.messageUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // Notifications podem retornar 200 ou 204 — ambos são válidos
            if (!response.ok && response.status !== 204) {
                console.warn(
                    `[MCP Client] Notification retornou status inesperado: ${response.status}`
                );
            }
        } catch (error) {
            console.error("[MCP Client] Falha ao enviar notification:", error);
            throw error;
        }
    }

    /**
     * Gera IDs incrementais para os requests JSON-RPC.
     */
    private getNextId(): number {
        return this.requestCounter++;
    }
}