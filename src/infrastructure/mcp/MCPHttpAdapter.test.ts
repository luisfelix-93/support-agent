import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPHttpAdapter } from './MCPHttpAdapter.js';

// Helper para criar uma resposta JSON-RPC de sucesso mockada
function jsonRpcResponse(result: unknown, status = 200): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Helper para uma resposta JSON-RPC de erro
function jsonRpcErrorResponse(code: number, message: string): Response {
    return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

const INIT_RESULT = {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    serverInfo: { name: 'test-mcp-server', version: '1.0.0' },
};

describe('MCPHttpAdapter', () => {
    let adapter: MCPHttpAdapter;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        adapter = new MCPHttpAdapter('https://mcp.example.com', 'my-api-key');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isConnected()', () => {
        it('deve retornar false antes de chamar connect()', () => {
            expect(adapter.isConnected()).toBe(false);
        });
    });

    describe('connect()', () => {
        it('deve realizar o handshake completo e retornar o resultado do servidor', async () => {
            // Passo 1: resposta do initialize
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(INIT_RESULT));
            // Passo 2: resposta do notifications/initialized
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            const result = await adapter.connect();

            expect(result.protocolVersion).toBe('2025-03-26');
            expect(result.serverInfo.name).toBe('test-mcp-server');
            expect(adapter.isConnected()).toBe(true);
        });

        it('deve enviar o método "initialize" no primeiro request', async () => {
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(INIT_RESULT));
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            await adapter.connect();

            const firstCall = fetchMock.mock.calls[0];
            const body = JSON.parse(firstCall[1].body);
            expect(body.method).toBe('initialize');
            expect(body.params.protocolVersion).toBe('2025-03-26');
        });

        it('deve enviar a notification "notifications/initialized" após o initialize', async () => {
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(INIT_RESULT));
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            await adapter.connect();

            const secondCall = fetchMock.mock.calls[1];
            const body = JSON.parse(secondCall[1].body);
            expect(body.method).toBe('notifications/initialized');
            // Notification não deve ter `id`
            expect(body.id).toBeUndefined();
        });

        it('deve reutilizar a conexão existente se já estiver inicializado', async () => {
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(INIT_RESULT));
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            await adapter.connect();
            const fetchCallsAfterFirst = fetchMock.mock.calls.length;

            // Segunda chamada ao connect() não deve fazer novos requests
            await adapter.connect();
            expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterFirst);
        });

        it('deve lançar erro se a resposta do initialize não tiver protocolVersion', async () => {
            fetchMock.mockResolvedValueOnce(jsonRpcResponse({ serverInfo: { name: 'test' } }));

            await expect(adapter.connect()).rejects.toThrow(
                "campo 'protocolVersion' ausente"
            );
        });

        it('deve lançar erro em caso de status HTTP 401', async () => {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

            await expect(adapter.connect()).rejects.toThrow('API Key inválida ou ausente');
        });

        it('deve lançar erro em caso de erro JSON-RPC retornado pelo servidor', async () => {
            fetchMock.mockResolvedValueOnce(jsonRpcErrorResponse(-32600, 'Invalid Request'));

            await expect(adapter.connect()).rejects.toThrow('Erro JSON-RPC');
        });
    });

    describe('executeTool()', () => {
        beforeEach(async () => {
            // Realiza o handshake antes de cada teste de executeTool
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(INIT_RESULT));
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
            await adapter.connect();
            fetchMock.mockClear(); // Limpa chamadas do connect
        });

        it('deve enviar o método "tools/call" com o nome e parâmetros corretos', async () => {
            const toolResult = { content: [{ type: 'text', text: 'dados retornados' }] };
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(toolResult));

            await adapter.executeTool({ name: 'query_logs', parameters: { level: 'error' } });

            const call = fetchMock.mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.method).toBe('tools/call');
            expect(body.params.name).toBe('query_logs');
            expect(body.params.arguments).toEqual({ level: 'error' });
        });

        it('deve retornar o resultado da ferramenta', async () => {
            const toolResult = { content: [{ type: 'text', text: 'resultado' }] };
            fetchMock.mockResolvedValueOnce(jsonRpcResponse(toolResult));

            const result = await adapter.executeTool({ name: 'my_tool', parameters: {} });

            expect(result).toEqual(toolResult);
        });
    });
});
