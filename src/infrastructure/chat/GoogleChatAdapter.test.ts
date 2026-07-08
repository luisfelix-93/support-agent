import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleChatAdapter } from './GoogleChatAdapter.js';

// Mock da biblioteca google-auth-library
// IMPORTANTE: usar `function` (não arrow function) para que possa ser chamada com `new`
vi.mock('google-auth-library', () => ({
    GoogleAuth: vi.fn().mockImplementation(function () {
        return {
            getClient: vi.fn().mockResolvedValue({
                getAccessToken: vi.fn().mockResolvedValue({ token: 'fake-access-token-xyz' }),
            }),
        };
    }),
}));

describe('GoogleChatAdapter', () => {
    let adapter: GoogleChatAdapter;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        adapter = new GoogleChatAdapter();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deve enviar mensagem com sucesso para a thread correta', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ name: 'spaces/AAA/messages/111' }), { status: 200 })
        );

        await expect(
            adapter.sendMessage('spaces/AAA/threads/BBB', 'Olá, tudo bem?')
        ).resolves.toBeUndefined();

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('deve usar o Authorization header com o token Bearer', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({}), { status: 200 })
        );

        await adapter.sendMessage('spaces/AAA/threads/BBB', 'Teste de token');

        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers['Authorization']).toBe('Bearer fake-access-token-xyz');
    });

    it('deve enviar o conteúdo e a thread corretamente no body', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({}), { status: 200 })
        );

        const threadId = 'spaces/AAA/threads/BBB';
        const content = 'Mensagem de teste';
        await adapter.sendMessage(threadId, content);

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.text).toBe(content);
        expect(body.thread.name).toBe(threadId);
    });

    it('deve usar a URL correta da API do Google Chat com o threadId', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({}), { status: 200 })
        );

        const threadId = 'spaces/CCCC/threads/DDDD';
        await adapter.sendMessage(threadId, 'Olá!');

        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain(`https://chat.googleapis.com/v1/${threadId}/messages`);
        expect(url).toContain('messageReplyOption=REPLY_MESSAGE_OR_FAIL');
    });

    it('deve lançar erro se a API do Google Chat retornar status de erro', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response('Forbidden', { status: 403 })
        );

        await expect(
            adapter.sendMessage('spaces/AAA/threads/BBB', 'Mensagem')
        ).rejects.toThrow('Erro na API do Google Chat: 403');
    });

    it('deve lançar erro se não conseguir obter o access token', async () => {
        const { GoogleAuth } = await import('google-auth-library');
        vi.mocked(GoogleAuth).mockImplementationOnce(function () {
            return {
                getClient: vi.fn().mockResolvedValue({
                    getAccessToken: vi.fn().mockResolvedValue({ token: null }),
                }),
            };
        } as any);

        const adapterWithBadAuth = new GoogleChatAdapter();

        await expect(
            adapterWithBadAuth.sendMessage('spaces/AAA/threads/BBB', 'Teste')
        ).rejects.toThrow('Não foi possível gerar o Token de acesso do Google Cloud');
    });
});
