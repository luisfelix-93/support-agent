import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompositeMCPClient } from './CompositeMCPClient.js';
import { ToolCall } from '../../domain/ToolCall.js';
import type { IMCPClient } from '../../domain/ports/IMCPClient.js';
import type { MCPServerRegistration } from '../../domain/MCPServerRegistration.js';

describe('CompositeMCPClient', () => {
    let mockK8sClient: IMCPClient;
    let mockLokiClient: IMCPClient;
    let mockDbClient: IMCPClient;

    beforeEach(() => {
        vi.clearAllMocks();

        mockK8sClient = {
            connect: vi.fn().mockResolvedValue({
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: 'k8s-mcp', version: '1.0.0' }
            }),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'get_pods', description: 'Lista pods do cluster Kubernetes' },
                    { name: 'describe_pod', description: 'Detalha um pod' }
                ]
            }),
            executeTool: vi.fn().mockResolvedValue({ pods: ['api-gateway-1', 'auth-service-2'] }),
            close: vi.fn().mockResolvedValue(undefined)
        };

        mockLokiClient = {
            connect: vi.fn().mockResolvedValue({
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: 'loki-mcp', version: '1.0.0' }
            }),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'query_logs', description: 'Executa consulta LogQL no Loki' }
                ]
            }),
            executeTool: vi.fn().mockResolvedValue({ lines: ['[ERROR] Connection refused', '[INFO] Started'] }),
            close: vi.fn().mockResolvedValue(undefined)
        };

        mockDbClient = {
            connect: vi.fn().mockResolvedValue({
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: 'database-mcp', version: '1.0.0' }
            }),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'check_pool', description: 'Verifica pool de conexões' }
                ]
            }),
            executeTool: vi.fn().mockResolvedValue({ activeConnections: 95, maxConnections: 100 }),
            close: vi.fn().mockResolvedValue(undefined)
        };
    });

    describe('Registro e Gerenciamento de Servidores', () => {
        it('deve registrar servidores e recuperá-los corretamente', () => {
            const composite = new CompositeMCPClient();
            composite.registerServer({
                id: 'k8s',
                name: 'Kubernetes MCP',
                client: mockK8sClient,
                domains: ['kubernetes', 'infra']
            });

            expect(composite.hasServer('k8s')).toBe(true);
            expect(composite.getServer('k8s')?.name).toBe('Kubernetes MCP');
            expect(composite.getRegisteredServers()).toHaveLength(1);
        });

        it('deve inicializar servidores via construtor', () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            expect(composite.getRegisteredServers()).toHaveLength(2);
            expect(composite.hasServer('k8s')).toBe(true);
            expect(composite.hasServer('loki')).toBe(true);
        });

        it('deve lançar erro se o id do servidor for inválido ou vazio', () => {
            const composite = new CompositeMCPClient();
            expect(() => {
                composite.registerServer({ id: '', name: 'Invalid', client: mockK8sClient });
            }).toThrow('O id do servidor MCP é obrigatório');
        });

        it('deve desregistrar um servidor e limpar suas rotas', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient }
            ]);

            await composite.listTools();
            expect(composite.unregisterServer('k8s')).toBe(true);
            expect(composite.hasServer('k8s')).toBe(false);

            await expect(composite.executeTool(new ToolCall('k8s__get_pods', {}))).rejects.toThrow();
        });
    });

    describe('Handshake & Conexão (connect & isConnected)', () => {
        it('deve conectar com sucesso a múltiplos servidores em paralelo', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            const initResult = await composite.connect();

            expect(mockK8sClient.connect).toHaveBeenCalledTimes(1);
            expect(mockLokiClient.connect).toHaveBeenCalledTimes(1);
            expect(initResult.protocolVersion).toBe('2024-11-05');
            expect(composite.getConnectedServers()).toEqual(['k8s', 'loki']);
            expect(composite.isConnected()).toBe(true);
        });

        it('deve tolerar falha parcial se pelo menos um servidor conectar com sucesso', async () => {
            (mockLokiClient.connect as any).mockRejectedValueOnce(new Error('Loki connection timeout'));

            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            const initResult = await composite.connect();

            expect(initResult).toBeDefined();
            expect(composite.getConnectedServers()).toEqual(['k8s']);
            expect(composite.isConnected()).toBe(true);
        });

        it('deve lançar erro se TODOS os servidores registrados falharem na conexão', async () => {
            (mockK8sClient.connect as any).mockRejectedValueOnce(new Error('K8s unreachable'));
            (mockLokiClient.connect as any).mockRejectedValueOnce(new Error('Loki unreachable'));

            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            await expect(composite.connect()).rejects.toThrow('Falha ao conectar em todos os servidores MCP');
            expect(composite.isConnected()).toBe(false);
        });

        it('deve responder de forma segura se nenhum servidor foi registrado ainda', async () => {
            const composite = new CompositeMCPClient();
            const res = await composite.connect();
            expect(res.serverInfo.name).toBe('support-agent-composite-mcp');
            expect(composite.isConnected()).toBe(false);
        });
    });

    describe('Listagem e Namespacing de Ferramentas (listTools)', () => {
        it('deve agregar ferramentas de múltiplos servidores com prefixo de namespace <id>__<toolName>', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'Kubernetes MCP', client: mockK8sClient },
                { id: 'loki', name: 'Grafana Loki', client: mockLokiClient }
            ]);

            const result = await composite.listTools();

            expect(result.tools).toHaveLength(3);
            const toolNames = result.tools.map(t => t.name);
            expect(toolNames).toContain('k8s__get_pods');
            expect(toolNames).toContain('k8s__describe_pod');
            expect(toolNames).toContain('loki__query_logs');

            const k8sTool = result.tools.find(t => t.name === 'k8s__get_pods');
            expect(k8sTool.description).toContain('[Kubernetes MCP]');
            expect(k8sTool._mcpServerId).toBe('k8s');
            expect(k8sTool._mcpOriginalName).toBe('get_pods');
        });

        it('deve filtrar ferramentas por domínios contextuais via ToolFilterOptions', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient, domains: ['kubernetes', 'infra'] },
                { id: 'loki', name: 'Loki', client: mockLokiClient, domains: ['observability', 'logs'] },
                { id: 'db', name: 'Database', client: mockDbClient, domains: ['database'] }
            ]);

            // Filtrando apenas por 'kubernetes'
            const k8sOnly = await composite.listTools({ domains: ['kubernetes'] });
            expect(k8sOnly.tools).toHaveLength(2);
            expect(k8sOnly.tools.every(t => t.name.startsWith('k8s__'))).toBe(true);

            // Filtrando por 'observability' e 'database'
            const obsAndDb = await composite.listTools({ domains: ['observability', 'database'] });
            expect(obsAndDb.tools).toHaveLength(2);
            const names = obsAndDb.tools.map(t => t.name);
            expect(names).toContain('loki__query_logs');
            expect(names).toContain('db__check_pool');
        });

        it('deve sempre incluir servidores marcados como isDefault mesmo com filtro de domínio', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient, domains: ['kubernetes'] },
                { id: 'db', name: 'Database', client: mockDbClient, domains: ['database'], isDefault: true }
            ]);

            const res = await composite.listTools({ domains: ['kubernetes'] });
            expect(res.tools.map(t => t.name)).toContain('k8s__get_pods');
            expect(res.tools.map(t => t.name)).toContain('db__check_pool');
        });

        it('deve omitir servidor indisponível sem derrubar os demais na listagem', async () => {
            (mockLokiClient.listTools as any).mockRejectedValueOnce(new Error('Loki crashed'));

            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            const res = await composite.listTools();
            expect(res.tools).toHaveLength(2);
            expect(res.tools.map(t => t.name)).toEqual(['k8s__get_pods', 'k8s__describe_pod']);
        });
    });

    describe('Roteamento e Execução (executeTool)', () => {
        it('deve rotear ferramenta prefixada removendo o prefixo no envio ao servidor destino', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            await composite.listTools();

            const toolCall = new ToolCall('k8s__get_pods', { namespace: 'default' });
            const result = await composite.executeTool(toolCall);

            expect(result).toEqual({ pods: ['api-gateway-1', 'auth-service-2'] });
            expect(mockK8sClient.executeTool).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'get_pods',
                    parameters: { namespace: 'default' }
                })
            );
            expect(mockLokiClient.executeTool).not.toHaveBeenCalled();
        });

        it('deve inferir o servidor mesmo se a ferramenta não foi previamente listada em cache', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            // Chamada direta sem listTools prévio
            const toolCall = new ToolCall('loki__query_logs', { query: '{app="checkout"}' });
            const result = await composite.executeTool(toolCall);

            expect(result.lines).toBeDefined();
            expect(mockLokiClient.executeTool).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'query_logs',
                    parameters: { query: '{app="checkout"}' }
                })
            );
        });

        it('deve suportar chamada com nome original se registrado no mapa de rotas ou em servidor default', async () => {
            const composite = new CompositeMCPClient([
                { id: 'db', name: 'DB', client: mockDbClient, isDefault: true }
            ]);

            await composite.listTools();

            const toolCall = new ToolCall('check_pool', {});
            const res = await composite.executeTool(toolCall);

            expect(res.activeConnections).toBe(95);
            expect(mockDbClient.executeTool).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'check_pool' })
            );
        });

        it('deve lançar erro claro se o servidor referenciado no namespace não estiver registrado', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient }
            ]);

            await composite.listTools();

            const invalidCall = new ToolCall('unknown_service__unknown_tool', {});
            await expect(composite.executeTool(invalidCall)).rejects.toThrow('não está registrado');
        });

        it('deve lançar erro claro se uma ferramenta não possuir rota em múltiplos servidores', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            await composite.listTools();

            const invalidCall = new ToolCall('non_existent_tool_without_namespace', {});
            await expect(composite.executeTool(invalidCall)).rejects.toThrow('Nenhum servidor MCP encontrado');
        });
    });

    describe('Encerramento e Limpeza (close)', () => {
        it('deve fechar todos os servidores filhos e limpar estado interno', async () => {
            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            await composite.connect();
            await composite.listTools();
            expect(composite.getConnectedServers()).toHaveLength(2);

            await composite.close();

            expect(mockK8sClient.close).toHaveBeenCalledTimes(1);
            expect(mockLokiClient.close).toHaveBeenCalledTimes(1);
            expect(composite.getConnectedServers()).toHaveLength(0);
        });
    });

    describe('Isolamento de Circuit Breaker (getCircuitBreaker)', () => {
        it('deve expor o circuit breaker individual de um servidor específico', () => {
            const fakeBreaker = { isOpen: vi.fn().mockReturnValue(false) };
            (mockK8sClient as any).getCircuitBreaker = vi.fn().mockReturnValue(fakeBreaker);

            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient }
            ]);

            const breaker = composite.getCircuitBreaker('k8s');
            expect(breaker).toBe(fakeBreaker);
            expect(breaker?.isOpen()).toBe(false);
        });

        it('deve retornar proxy agregado que só fica aberto se TODOS os servidores com breaker estiverem abertos', () => {
            const k8sBreaker = { isOpen: vi.fn().mockReturnValue(true) }; // K8s aberto (quebrado)
            const lokiBreaker = { isOpen: vi.fn().mockReturnValue(false) }; // Loki fechado (saudável)

            (mockK8sClient as any).getCircuitBreaker = vi.fn().mockReturnValue(k8sBreaker);
            (mockLokiClient as any).getCircuitBreaker = vi.fn().mockReturnValue(lokiBreaker);

            const composite = new CompositeMCPClient([
                { id: 'k8s', name: 'K8s', client: mockK8sClient },
                { id: 'loki', name: 'Loki', client: mockLokiClient }
            ]);

            const aggregatedBreaker = composite.getCircuitBreaker();
            expect(aggregatedBreaker?.isOpen()).toBe(false); // Loki ainda está operacional!

            // Agora simula Loki também abrindo
            lokiBreaker.isOpen.mockReturnValue(true);
            expect(aggregatedBreaker?.isOpen()).toBe(true); // Ambos abertos -> composite aberto
        });
    });
});
