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
 * Adaptador HTTP para comunicação com o MCP Server via transporte SSE (Server-Sent Events).
 * 
 * Implementa o protocolo MCP sobre HTTP de acordo com a especificação de transporte oficial:
 *   1. connect()       → Conecta ao stream SSE GET /sse?api_key=...
 *                      → Escuta o evento 'endpoint' enviado pelo servidor para obter a URL de POST das mensagens
 *                      → Executa o handshake de inicialização MCP (initialize + notification/initialized)
 *   2. listTools()     → Envia tools/list via POST e escuta a resposta pelo stream SSE
 *   3. executeTool()   → Envia tools/call via POST e escuta a resposta pelo stream SSE
 *   4. close()         → Aborta a requisição SSE, fecha streams e limpa requests pendentes
 */
export class MCPHttpAdapter implements IMCPClient {
    private initialized: boolean = false;
    private requestCounter: number = 1;
    private serverCapabilities: MCPCapabilities | null = null;

    private abortController: AbortController | null = null;
    private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private postUrl: string | null = null;
    private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();

    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly requestTimeoutMs: number = 25000
    ){}

    /**
     * Realiza a conexão SSE e o handshake MCP completo com o servidor.
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

        const cleanBaseUrl = this.baseUrl.trim().replace(/\/+$/, '');
        const cleanApiKey = this.apiKey.trim();
        const sseUrl = `${cleanBaseUrl}/sse?api_key=${cleanApiKey}`;

        console.log(`[MCP Handshake] Iniciando conexão SSE com o servidor em: ${sseUrl}`);

        this.abortController = new AbortController();

        try {
            const response = await fetch(sseUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'text/event-stream'
                },
                signal: this.abortController.signal
            });

            if (!response.ok) {
                const statusMessages: Record<number, string> = {
                    401: "API Key inválida ou ausente",
                    403: "Acesso negado ao recurso",
                    429: "Rate limit excedido — tente novamente em instantes"
                };
                const detail = statusMessages[response.status] ?? `HTTP Status ${response.status}`;
                throw new Error(`[MCP Client] Falha ao conectar no SSE: ${detail}`);
            }

            if (!response.body) {
                throw new Error(`[MCP Client] O corpo da resposta SSE está vazio`);
            }

            this.sseReader = response.body.getReader();

            // Promise para capturar a primeira URL de POST enviada pelo evento 'endpoint'
            let resolveEndpoint: (url: string) => void;
            let rejectEndpoint: (err: Error) => void;
            const endpointPromise = new Promise<string>((resolve, reject) => {
                resolveEndpoint = resolve;
                rejectEndpoint = reject;
            });

            // Inicia leitura assíncrona do stream SSE em segundo plano
            this.startReadingStream(resolveEndpoint!, rejectEndpoint!);

            // Aguarda obter o endpoint das mensagens POST
            console.log("[MCP Handshake] Aguardando evento 'endpoint' do servidor SSE...");
            const relativeOrAbsolutePostUrl = await endpointPromise;

            if (relativeOrAbsolutePostUrl.startsWith('http://') || relativeOrAbsolutePostUrl.startsWith('https://')) {
                this.postUrl = relativeOrAbsolutePostUrl;
            } else {
                this.postUrl = `${cleanBaseUrl}${relativeOrAbsolutePostUrl.startsWith('/') ? '' : '/'}${relativeOrAbsolutePostUrl}`;
            }

            console.log(`[MCP Handshake] Endpoint de mensagens configurado: ${this.postUrl}`);

            // ───────────────────────────────────────────────
            // Passo 1: Enviar request `initialize`
            // ───────────────────────────────────────────────
            const initializePayload = {
                jsonrpc: "2.0",
                id: this.getNextId(),
                method: "initialize",
                params: {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: CLIENT_INFO
                }
            };

            console.log("[MCP Handshake] Passo 1/3 — Enviando request 'initialize'...");
            const initResult = await this.sendJsonRpc(initializePayload);

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
            // ───────────────────────────────────────────────
            const initializedNotification = {
                jsonrpc: "2.0",
                method: "notifications/initialized"
            };

            console.log("[MCP Handshake] Passo 3/3 — Enviando notification 'initialized'...");
            await this.sendNotification(initializedNotification);

            this.initialized = true;
            console.log("[MCP Handshake] ✅ Handshake concluído com sucesso!");

            return {
                protocolVersion: initResult.protocolVersion,
                capabilities: this.serverCapabilities!,
                serverInfo
            };
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    /**
     * Indica se o handshake já foi realizado com sucesso.
     */
    isConnected(): boolean {
        return this.initialized;
    }

    /**
     * Busca dinamicamente as ferramentas suportadas pelo tenant.
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
     * Executa uma ferramenta específica.
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

    /**
     * Fecha as conexões abertas do stream SSE e aborta requests pendentes.
     */
    async close(): Promise<void> {
        console.log("[MCP Client] Encerrando conexões e limpando recursos...");
        
        if (this.sseReader) {
            try {
                await this.sseReader.cancel();
            } catch (err) {
                // silencia
            }
            this.sseReader = null;
        }

        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        // Rejeita todas as requisições que estavam aguardando resposta
        for (const [id, req] of this.pendingRequests.entries()) {
            req.reject(new Error("[MCP Client] Conexão encerrada pelo cliente"));
            this.pendingRequests.delete(id);
        }

        this.postUrl = null;
        this.initialized = false;
    }

    // ─────────────────────────────────────────────────────────────────
    // Métodos privados
    // ─────────────────────────────────────────────────────────────────

    /**
     * Garante que o handshake foi realizado. Se não foi, conecta automaticamente.
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            console.log("[MCP] Handshake pendente — conectando automaticamente...");
            await this.connect();
        }
    }

    /**
     * Loop em segundo plano para leitura e parseamento do stream SSE.
     */
    private async startReadingStream(
        resolveEndpoint: (url: string) => void,
        rejectEndpoint: (err: Error) => void
    ) {
        const decoder = new TextDecoder();
        let buffer = "";
        let hasResolvedEndpoint = false;

        try {
            while (this.sseReader) {
                const { value, done } = await this.sseReader.read();
                if (done) {
                    console.log("[MCP Client] SSE Connection fechada pelo servidor");
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                let eventBoundary = buffer.indexOf('\n\n');
                while (eventBoundary !== -1) {
                    const block = buffer.substring(0, eventBoundary).trim();
                    buffer = buffer.substring(eventBoundary + 2);

                    this.parseAndHandleSSEBlock(block, (url) => {
                        hasResolvedEndpoint = true;
                        resolveEndpoint(url);
                    });

                    eventBoundary = buffer.indexOf('\n\n');
                }
            }
            
            if (!hasResolvedEndpoint) {
                rejectEndpoint(new Error("[MCP Client] Conexão SSE encerrada antes de receber o endpoint"));
            }

            // Rejeita todas as requisições que estavam aguardando resposta
            for (const [id, req] of this.pendingRequests.entries()) {
                req.reject(new Error("[MCP Client] Conexão SSE encerrada pelo servidor antes de receber resposta"));
                this.pendingRequests.delete(id);
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log("[MCP Client] SSE reader abortado pelo cliente com sucesso");
            } else {
                console.error("[MCP Client] Erro na leitura do stream SSE:", error);
                if (!hasResolvedEndpoint) {
                    rejectEndpoint(error);
                }
                for (const [id, req] of this.pendingRequests.entries()) {
                    req.reject(error);
                    this.pendingRequests.delete(id);
                }
            }
        }
    }

    /**
     * Processa um bloco individual de evento SSE.
     */
    private parseAndHandleSSEBlock(block: string, resolveEndpoint: (url: string) => void) {
        if (!block) return;

        const lines = block.split(/\r?\n/);
        let eventType = "";
        let dataContent = "";

        for (const line of lines) {
            if (line.startsWith("event:")) {
                eventType = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
                dataContent = line.substring(5).trim();
            }
        }

        if (eventType === "endpoint" && dataContent) {
            resolveEndpoint(dataContent);
        } else if (eventType === "message" && dataContent) {
            try {
                const messageJson = JSON.parse(dataContent);
                this.handleIncomingMessage(messageJson);
            } catch (err) {
                console.error("[MCP Client] Erro ao parsear mensagem JSON do SSE:", err);
            }
        }
    }

    /**
     * Manipula mensagens JSON-RPC recebidas via stream SSE.
     */
    private handleIncomingMessage(message: any) {
        if (message.id !== undefined && message.id !== null) {
            const id = Number(message.id);
            const pending = this.pendingRequests.get(id);
            if (pending) {
                if (message.error) {
                    pending.reject(
                        new Error(`[MCP Client] Erro JSON-RPC (code: ${message.error.code}): ${message.error.message}`)
                    );
                } else {
                    pending.resolve(message.result);
                }
                this.pendingRequests.delete(id);
            }
        }
    }

    /**
     * Envia um request JSON-RPC via POST HTTP e aguarda a resposta assíncrona no stream SSE.
     */
    private async sendJsonRpc(payload: any): Promise<any> {
        if (!this.postUrl) {
            throw new Error("[MCP Client] Post URL não configurado. Handshake SSE efetuado?");
        }

        const requestId = payload.id;
        
        const responsePromise = new Promise<any>((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
        });

        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<any>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`[MCP Client] Timeout de ${this.requestTimeoutMs / 1000}s aguardando resposta da ferramenta`));
            }, this.requestTimeoutMs);
        });

        try {
            const response = await fetch(this.postUrl, {
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
                throw new Error(`[MCP Client] Erro HTTP no POST: ${detail}`);
            }

            // A resposta real JSON-RPC com o resultado virá assincronamente pelo stream SSE.
            // Retorna a promise que resolverá quando o evento de resposta correspondente chegar ou o timeout expirar.
            const result = await Promise.race([responsePromise, timeoutPromise]);
            return result;
        } catch (error) {
            throw error;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            this.pendingRequests.delete(requestId);
        }
    }

    /**
     * Envia uma notification JSON-RPC (sem id) via POST HTTP.
     */
    private async sendNotification(payload: any): Promise<void> {
        if (!this.postUrl) {
            throw new Error("[MCP Client] Post URL não configurado. Handshake SSE efetuado?");
        }

        try {
            const response = await fetch(this.postUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

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