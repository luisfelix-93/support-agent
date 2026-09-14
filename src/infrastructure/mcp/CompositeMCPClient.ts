import { ToolCall } from "../../domain/ToolCall.js";
import type { IMCPClient, ToolFilterOptions } from "../../domain/ports/IMCPClient.js";
import type { MCPInitializeResult } from "../../domain/MCPServerCapabilities.js";
import type { MCPServerRegistration } from "../../domain/MCPServerRegistration.js";
import type { ToolGovernanceService } from "../../services/ToolGovernanceService.js";
import type { ToolGovernancePolicy } from "../../domain/ToolGovernance.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: 'CompositeMCPClient' });

/**
 * Cliente composto que agrega múltiplos servidores MCP sob uma interface unificada IMCPClient.
 *
 * Características principais:
 * 1. Namespacing transparente: ferramentas agregadas recebem o prefixo `<serverId>__<toolName>`.
 * 2. Roteamento e Strip: na execução, identifica o servidor alvo, remove o prefixo e despacha o ToolCall limpo.
 * 3. Tolerância a falhas parciais: falha de um servidor MCP não impede o funcionamento dos demais.
 * 4. Circuit Breakers isolados: cada servidor mantém seu próprio estado de resiliência.
 * 5. Descoberta contextual: suporte a filtragem por domínios/playbooks via ToolFilterOptions.
 * 6. Governança de ferramentas: interceptador de risco (READ_ONLY, LOW_RISK, HIGH_RISK, FORBIDDEN).
 */
export class CompositeMCPClient implements IMCPClient {
    private readonly servers = new Map<string, MCPServerRegistration>();
    private readonly connectedServers = new Set<string>();
    private readonly toolRoutingMap = new Map<string, { serverId: string; actualToolName: string }>();
    private initialized = false;

    constructor(
        initialServers?: MCPServerRegistration[],
        private readonly governanceService?: ToolGovernanceService,
        private governancePolicy?: ToolGovernancePolicy
    ) {
        if (initialServers) {
            for (const server of initialServers) {
                this.registerServer(server);
            }
        }
    }

    /**
     * Define ou atualiza a política de governança de ferramentas para este cliente.
     */
    setGovernancePolicy(policy?: ToolGovernancePolicy): void {
        this.governancePolicy = policy;
    }

    /**
     * Retorna a política de governança ativa.
     */
    getGovernancePolicy(): ToolGovernancePolicy | undefined {
        return this.governancePolicy;
    }

    /**
     * Registra um novo servidor MCP no composite.
     */
    registerServer(registration: MCPServerRegistration): void {
        if (!registration.id || typeof registration.id !== 'string' || registration.id.trim() === '') {
            throw new Error('O id do servidor MCP é obrigatório e deve ser uma string não vazia.');
        }

        const sanitizedId = registration.id.trim();
        if (this.servers.has(sanitizedId)) {
            log.warn({ serverId: sanitizedId }, 'Sobrescrevendo registro de servidor MCP existente.');
        }

        this.servers.set(sanitizedId, {
            ...registration,
            id: sanitizedId,
        });

        log.info({ serverId: sanitizedId, name: registration.name }, 'Servidor MCP registrado com sucesso.');
    }

    /**
     * Remove o registro de um servidor MCP e suas ferramentas associadas.
     */
    unregisterServer(id: string): boolean {
        const sanitizedId = id.trim();
        this.connectedServers.delete(sanitizedId);

        // Limpa mapeamentos de ferramentas deste servidor
        for (const [key, mapping] of this.toolRoutingMap.entries()) {
            if (mapping.serverId === sanitizedId) {
                this.toolRoutingMap.delete(key);
            }
        }

        const removed = this.servers.delete(sanitizedId);
        if (removed) {
            log.info({ serverId: sanitizedId }, 'Servidor MCP desregistrado.');
        }
        return removed;
    }

    /**
     * Obtém os metadados de registro de um servidor.
     */
    getServer(id: string): MCPServerRegistration | undefined {
        return this.servers.get(id.trim());
    }

    /**
     * Lista todos os servidores registrados.
     */
    getRegisteredServers(): MCPServerRegistration[] {
        return Array.from(this.servers.values());
    }

    /**
     * Lista os IDs dos servidores com conexão confirmada.
     */
    getConnectedServers(): string[] {
        return Array.from(this.connectedServers);
    }

    /**
     * Verifica se um servidor está registrado.
     */
    hasServer(id: string): boolean {
        return this.servers.has(id.trim());
    }

    /**
     * Conecta a todos os servidores registrados em paralelo (Promise.allSettled).
     * Tolera falhas parciais se pelo menos um servidor estiver saudável.
     */
    async connect(): Promise<MCPInitializeResult> {
        if (this.servers.size === 0) {
            log.warn('CompositeMCPClient: Nenhum servidor MCP registrado para conectar.');
            return {
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: 'support-agent-composite-mcp', version: '1.0.0' }
            };
        }

        const connectionTasks = Array.from(this.servers.values()).map(async (reg) => {
            try {
                const result = await reg.client.connect();
                this.connectedServers.add(reg.id);
                return { id: reg.id, success: true, result };
            } catch (err: any) {
                this.connectedServers.delete(reg.id);
                const errMsg = err?.message || String(err);
                log.error({ err: errMsg, serverId: reg.id, serverName: reg.name }, 'Falha ao conectar servidor MCP no CompositeMCPClient.');
                return { id: reg.id, success: false, error: errMsg };
            }
        });

        const settledResults = await Promise.allSettled(connectionTasks);
        const successfulCount = this.connectedServers.size;

        if (successfulCount === 0 && this.servers.size > 0) {
            const failures: string[] = [];
            for (const r of settledResults) {
                if (r.status === 'fulfilled') {
                    failures.push(`${r.value.id}: ${r.value.error ?? 'unknown error'}`);
                } else {
                    const reasonMsg = (r.reason as any)?.message ?? String(r.reason);
                    failures.push(`rejected: ${reasonMsg}`);
                }
            }
            throw new Error(`Falha ao conectar em todos os servidores MCP registrados (${failures.join(', ')}).`);
        }

        this.initialized = true;
        log.info({ total: this.servers.size, connected: successfulCount }, 'CompositeMCPClient conectado aos servidores.');

        return {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: { listChanged: true }
            },
            serverInfo: {
                name: 'support-agent-composite-mcp',
                version: '1.0.0'
            }
        };
    }

    /**
     * Retorna se o composite está pronto para atender requisições.
     * Considerado conectado se houver pelo menos um servidor filho conectado.
     */
    isConnected(): boolean {
        if (this.servers.size === 0 || this.connectedServers.size === 0) return false;
        return Array.from(this.connectedServers).some(id => {
            const server = this.servers.get(id);
            return server ? server.client.isConnected() : false;
        });
    }

    /**
     * Lista e agrega as ferramentas de todos os servidores MCP saudáveis,
     * aplicando namespacing `<serverId>__<toolName>` para evitar colisões.
     */
    async listTools(options?: ToolFilterOptions): Promise<{ tools: any[] }> {
        const aggregatedTools: any[] = [];
        const requestedDomains = options?.domains;

        for (const server of this.servers.values()) {
            // Filtragem contextual por domínios (se especificado)
            if (requestedDomains && requestedDomains.length > 0) {
                const matchesDomain = server.domains && server.domains.some(d => requestedDomains.includes(d));
                if (!matchesDomain && !server.isDefault) {
                    continue;
                }
            }

            try {
                // Tenta conectar sob demanda se não estiver conectado ainda
                if (!server.client.isConnected()) {
                    try {
                        await server.client.connect();
                        this.connectedServers.add(server.id);
                    } catch (connErr) {
                        log.warn({ err: connErr, serverId: server.id }, 'Servidor indisponível ao listar ferramentas; omitindo temporariamente.');
                        continue;
                    }
                }

                const response = await server.client.listTools(options);
                const rawTools = Array.isArray(response?.tools) ? response.tools : [];

                for (const tool of rawTools) {
                    const originalName = tool.name;
                    const prefixedName = `${server.id}__${originalName}`;

                    // Registra mapeamento direto e inverso
                    this.toolRoutingMap.set(prefixedName, {
                        serverId: server.id,
                        actualToolName: originalName,
                    });

                    // Permite resolução de nome original se não colidir ou se for servidor default
                    if (!this.toolRoutingMap.has(originalName) || server.isDefault) {
                        this.toolRoutingMap.set(originalName, {
                            serverId: server.id,
                            actualToolName: originalName,
                        });
                    }

                    aggregatedTools.push({
                        ...tool,
                        name: prefixedName,
                        description: tool.description
                            ? `[${server.name}] ${tool.description}`
                            : `[${server.name}] ${originalName}`,
                        _mcpServerId: server.id,
                        _mcpOriginalName: originalName,
                    });
                }
            } catch (err) {
                log.error({ err, serverId: server.id }, 'Erro ao obter ferramentas do servidor MCP; continuando com os demais.');
            }
        }

        return { tools: aggregatedTools };
    }

    /**
     * Executa a ferramenta encaminhando a chamada ao servidor MCP correto
     * com remoção do prefixo de namespace.
     */
    async executeTool(tool: ToolCall): Promise<any> {
        if (!tool || !tool.name) {
            throw new Error('ToolCall inválido fornecido ao CompositeMCPClient.');
        }

        // 0. Avaliação de governança de segurança e risco (se configurado)
        if (this.governanceService) {
            const decision = this.governanceService.evaluate(tool, this.governancePolicy);
            if (!decision.allowed) {
                log.warn(
                    { tool: tool.name, riskLevel: decision.riskLevel, reason: decision.reason },
                    'Execução de ferramenta bloqueada pela governança de segurança.'
                );
                return {
                    error: `Execução bloqueada por governança de segurança: ${decision.reason}`,
                    blocked: true,
                    riskLevel: decision.riskLevel,
                    requiresApproval: decision.requiresApproval ?? false,
                };
            }
        }

        // 1. Tenta resolver pelo mapa de rotas
        let route = this.toolRoutingMap.get(tool.name);

        // 2. Se não estiver no mapa, tenta inferir se o nome possui o prefixo `<serverId>__<actualToolName>`
        const hasNamespace = tool.name.includes('__');
        if (!route && hasNamespace) {
            const separatorIndex = tool.name.indexOf('__');
            const candidateServerId = tool.name.substring(0, separatorIndex);
            const candidateToolName = tool.name.substring(separatorIndex + 2);

            if (this.servers.has(candidateServerId)) {
                route = { serverId: candidateServerId, actualToolName: candidateToolName };
            } else {
                throw new Error(`Servidor MCP "${candidateServerId}" referenciado na ferramenta "${tool.name}" não está registrado.`);
            }
        }

        // 3. Fallback: servidor default registrado (apenas para ferramentas sem namespace explícito)
        if (!route && !hasNamespace) {
            const defaultServer = Array.from(this.servers.values()).find(s => s.isDefault);
            if (defaultServer) {
                route = { serverId: defaultServer.id, actualToolName: tool.name };
            }
        }

        // 4. Fallback: servidor único registrado (apenas para ferramentas sem namespace explícito)
        if (!route && !hasNamespace && this.servers.size === 1) {
            const singleServer = Array.from(this.servers.values())[0];
            route = { serverId: singleServer.id, actualToolName: tool.name };
        }

        if (!route) {
            throw new Error(`Nenhum servidor MCP encontrado para a ferramenta "${tool.name}". Certifique-se de que o servidor correspondente está registrado.`);
        }

        const targetServer = this.servers.get(route.serverId);
        if (!targetServer) {
            throw new Error(`Servidor MCP registrado "${route.serverId}" não foi encontrado no composite.`);
        }

        // Constrói o ToolCall limpo para o servidor upstream
        const upstreamToolCall = new ToolCall(route.actualToolName, tool.parameters);

        log.debug(
            { compositeToolName: tool.name, serverId: route.serverId, upstreamToolName: route.actualToolName },
            'Roteando execução de ferramenta no CompositeMCPClient.'
        );

        return await targetServer.client.executeTool(upstreamToolCall);
    }

    /**
     * Fecha todas as conexões filhas e libera recursos.
     */
    async close(): Promise<void> {
        const closeTasks = Array.from(this.servers.values()).map(async (reg) => {
            try {
                await reg.client.close();
            } catch (err) {
                log.warn({ err, serverId: reg.id }, 'Erro ao fechar cliente MCP filho.');
            }
        });

        await Promise.allSettled(closeTasks);
        this.connectedServers.clear();
        this.toolRoutingMap.clear();
        this.initialized = false;
        log.info('CompositeMCPClient encerrado com sucesso.');
    }

    /**
     * Retorna o CircuitBreaker de um servidor específico ou um proxy de resiliência agregado.
     */
    getCircuitBreaker(serverId?: string): { isOpen(): boolean } | undefined {
        if (serverId) {
            const s = this.servers.get(serverId);
            if (s && typeof (s.client as any).getCircuitBreaker === 'function') {
                return (s.client as any).getCircuitBreaker();
            }
            return undefined;
        }

        // Breaker proxy agregado: só reporta aberto se TODOS os servidores com breaker estiverem abertos
        return {
            isOpen: () => {
                if (this.servers.size === 0) return false;
                let breakerCount = 0;
                let openCount = 0;

                for (const server of this.servers.values()) {
                    const client = server.client as any;
                    if (typeof client.getCircuitBreaker === 'function') {
                        const cb = client.getCircuitBreaker();
                        if (cb && typeof cb.isOpen === 'function') {
                            breakerCount++;
                            if (cb.isOpen()) {
                                openCount++;
                            }
                        }
                    }
                }

                return breakerCount > 0 && openCount === breakerCount;
            }
        };
    }
}
