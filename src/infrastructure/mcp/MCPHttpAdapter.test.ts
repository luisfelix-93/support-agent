import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPHttpAdapter } from './MCPHttpAdapter.js';

// Classe auxiliar para mockar streams SSE nos testes
class SSEMockStream {
    private controller!: ReadableStreamDefaultController<Uint8Array>;
    public stream: ReadableStream<Uint8Array>;
    private encoder = new TextEncoder();

    constructor() {
        this.stream = new ReadableStream({
            start: (controller) => {
                this.controller = controller;
            }
        });
    }

    sendEvent(event: string, data: any) {
        let block = `event: ${event}\n`;
        if (typeof data === 'object') {
            block += `data: ${JSON.stringify(data)}\n\n`;
        } else {
            block += `data: ${data}\n\n`;
        }
        if (this.controller) {
            this.controller.enqueue(this.encoder.encode(block));
        }
    }

    close() {
        if (this.controller) {
            try {
                this.controller.close();
            } catch (err) {
                // já fechado
            }
        }
    }
}

const INIT_RESULT = {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    serverInfo: { name: 'test-mcp-server', version: '1.0.0' },
};

describe('MCPHttpAdapter', () => {
    let adapter: MCPHttpAdapter;
    let fetchMock: ReturnType<typeof vi.fn>;
    let mockSse: SSEMockStream;
    let toolCallResult: any = {};

    beforeEach(() => {
        mockSse = new SSEMockStream();
        toolCallResult = {};
        
        fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
            const method = init?.method ?? 'GET';
            
            if (method === 'GET' && url.includes('/sse')) {
                setTimeout(() => {
                    mockSse.sendEvent('endpoint', '/message?sessionId=123');
                }, 5);

                return new Response(mockSse.stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }

            if (method === 'POST' && url.includes('/message')) {
                const body = JSON.parse(init?.body as string);
                
                setTimeout(() => {
                    if (body.method === 'initialize') {
                        mockSse.sendEvent('message', {
                            jsonrpc: '2.0',
                            id: body.id,
                            result: INIT_RESULT
                        });
                    } else if (body.method === 'tools/list') {
                        mockSse.sendEvent('message', {
                            jsonrpc: '2.0',
                            id: body.id,
                            result: { tools: [] }
                        });
                    } else if (body.method === 'tools/call') {
                        mockSse.sendEvent('message', {
                            jsonrpc: '2.0',
                            id: body.id,
                            result: toolCallResult
                        });
                    }
                }, 5);

                return new Response(null, { status: 204 });
            }

            return new Response(null, { status: 404 });
        });

        vi.stubGlobal('fetch', fetchMock);
        adapter = new MCPHttpAdapter('https://mcp.example.com', 'my-api-key');
    });

    afterEach(async () => {
        await adapter.close();
        mockSse.close();
        vi.unstubAllGlobals();
    });

    describe('isConnected()', () => {
        it('deve retornar false antes de chamar connect()', () => {
            expect(adapter.isConnected()).toBe(false);
        });
    });

    describe('connect()', () => {
        it('deve realizar o handshake completo e retornar o resultado do servidor', async () => {
            const result = await adapter.connect();

            expect(result.protocolVersion).toBe('2025-03-26');
            expect(result.serverInfo.name).toBe('test-mcp-server');
            expect(adapter.isConnected()).toBe(true);
        });

        it('deve enviar o método "initialize" no primeiro request de POST', async () => {
            await adapter.connect();

            // Chamada 0: GET /sse
            // Chamada 1: POST /message (initialize)
            const initializeCall = fetchMock.mock.calls[1];
            const body = JSON.parse(initializeCall[1].body);
            expect(body.method).toBe('initialize');
            expect(body.params.protocolVersion).toBe('2025-03-26');
        });

        it('deve enviar a notification "notifications/initialized" após o initialize', async () => {
            await adapter.connect();

            // Chamada 0: GET /sse
            // Chamada 1: POST /message (initialize)
            // Chamada 2: POST /message (notifications/initialized)
            const thirdCall = fetchMock.mock.calls[2];
            const body = JSON.parse(thirdCall[1].body);
            expect(body.method).toBe('notifications/initialized');
            expect(body.id).toBeUndefined();
        });

        it('deve reutilizar a conexão existente se já estiver inicializado', async () => {
            await adapter.connect();
            const fetchCallsAfterFirst = fetchMock.mock.calls.length;

            await adapter.connect();
            expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterFirst);
        });

        it('deve lançar erro se a resposta do initialize não tiver protocolVersion', async () => {
            fetchMock.mockImplementationOnce(async () => {
                setTimeout(() => {
                    mockSse.sendEvent('endpoint', '/message?sessionId=123');
                }, 5);
                return new Response(mockSse.stream, { status: 200 });
            });

            fetchMock.mockImplementationOnce(async (url, init) => {
                const body = JSON.parse(init?.body as string);
                setTimeout(() => {
                    mockSse.sendEvent('message', {
                        jsonrpc: '2.0',
                        id: body.id,
                        result: { serverInfo: { name: 'test' } } // Sem protocolVersion
                    });
                }, 5);
                return new Response(null, { status: 204 });
            });

            await expect(adapter.connect()).rejects.toThrow(
                "campo 'protocolVersion' ausente"
            );
        });

        it('deve lançar erro em caso de status HTTP 401 no GET do SSE', async () => {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

            await expect(adapter.connect()).rejects.toThrow('API Key inválida ou ausente');
        });

        it('deve lançar erro em caso de erro JSON-RPC retornado pelo servidor no stream', async () => {
            fetchMock.mockImplementationOnce(async () => {
                setTimeout(() => {
                    mockSse.sendEvent('endpoint', '/message?sessionId=123');
                }, 5);
                return new Response(mockSse.stream, { status: 200 });
            });

            fetchMock.mockImplementationOnce(async (url, init) => {
                const body = JSON.parse(init?.body as string);
                setTimeout(() => {
                    mockSse.sendEvent('message', {
                        jsonrpc: '2.0',
                        id: body.id,
                        error: { code: -32600, message: 'Invalid Request' }
                    });
                }, 5);
                return new Response(null, { status: 204 });
            });

            await expect(adapter.connect()).rejects.toThrow('Erro JSON-RPC');
        });
    });

    describe('executeTool()', () => {
        beforeEach(async () => {
            await adapter.connect();
            fetchMock.mockClear(); // Limpa chamadas do connect
        });

        it('deve enviar o método "tools/call" com o nome e parâmetros corretos', async () => {
            toolCallResult = { content: [{ type: 'text', text: 'dados retornados' }] };

            await adapter.executeTool({ name: 'query_logs', parameters: { level: 'error' } });

            const call = fetchMock.mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body.method).toBe('tools/call');
            expect(body.params.name).toBe('query_logs');
            expect(body.params.arguments).toEqual({ level: 'error' });
        });

        it('deve retornar o resultado da ferramenta', async () => {
            toolCallResult = { content: [{ type: 'text', text: 'resultado' }] };

            const result = await adapter.executeTool({ name: 'my_tool', parameters: {} });

            expect(result).toEqual(toolCallResult);
        });

        it('deve lançar erro de timeout se o servidor não responder a tempo', async () => {
            const shortTimeoutAdapter = new MCPHttpAdapter('https://mcp.example.com', 'my-api-key', 20);
            
            fetchMock.mockImplementationOnce(async () => {
                setTimeout(() => {
                    mockSse.sendEvent('endpoint', '/message?sessionId=123');
                }, 5);
                return new Response(mockSse.stream, { status: 200 });
            });

            fetchMock.mockImplementationOnce(async (url, init) => {
                const body = JSON.parse(init?.body as string);
                setTimeout(() => {
                    mockSse.sendEvent('message', {
                        jsonrpc: '2.0',
                        id: body.id,
                        result: INIT_RESULT
                    });
                }, 5);
                return new Response(null, { status: 204 });
            });

            await shortTimeoutAdapter.connect();
            fetchMock.mockClear();

            fetchMock.mockImplementationOnce(async () => {
                return new Response(null, { status: 204 });
            });

            await expect(shortTimeoutAdapter.executeTool({ name: 'slow_tool', parameters: {} }))
                .rejects.toThrow('Timeout de 0.02s aguardando resposta da ferramenta');
            
            await shortTimeoutAdapter.close();
        });

        it('deve rejeitar requisições pendentes se a conexão SSE for encerrada prematuramente', async () => {
            fetchMock.mockImplementationOnce(async () => {
                setTimeout(() => {
                    mockSse.close();
                }, 10);
                return new Response(null, { status: 204 });
            });

            await expect(adapter.executeTool({ name: 'hanging_tool', parameters: {} }))
                .rejects.toThrow('Conexão SSE encerrada pelo servidor antes de receber resposta');
        });
    });
});
