import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackChatAdapter } from './SlackChatAdapter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'xoxb-fake-token-for-tests';

/** Constrói uma Response simulando a Slack API */
function makeSlackResponse(ok: boolean, extra: Record<string, unknown> = {}, status = 200) {
    return new Response(JSON.stringify({ ok, ...extra }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('SlackChatAdapter', () => {
    let adapter: SlackChatAdapter;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        adapter = new SlackChatAdapter(FAKE_TOKEN);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // ─── Construtor ───────────────────────────────────────────────────────────

    it('deve lançar erro se o botToken estiver vazio', () => {
        expect(() => new SlackChatAdapter('')).toThrow(
            '[SlackChatAdapter] SLACK_BOT_TOKEN não configurado.'
        );
    });

    // ─── sendMessage — sucesso ─────────────────────────────────────────────────

    it('deve chamar a Slack API com o endpoint correto', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await adapter.sendMessage('C0123456:1234567890.123456', 'Olá Slack!');

        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('https://slack.com/api/chat.postMessage');
    });

    it('deve incluir o Authorization header com o Bearer token', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await adapter.sendMessage('C0123456:1234567890.123456', 'Token test');

        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    });

    it('deve decodificar o threadId e enviar channel e thread_ts corretos no body', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        const channel = 'C0123456';
        const thread_ts = '1234567890.123456';
        await adapter.sendMessage(`${channel}:${thread_ts}`, 'Mensagem na thread');

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.channel).toBe(channel);
        expect(body.thread_ts).toBe(thread_ts);
        expect(body.text).toBe('Mensagem na thread');
    });

    it('deve enviar sem thread_ts quando o threadId não contém ":"', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await adapter.sendMessage('C0123456', 'Mensagem sem thread');

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.channel).toBe('C0123456');
        expect(body.thread_ts).toBeUndefined();
    });

    it('deve resolver sem retorno em caso de sucesso', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await expect(
            adapter.sendMessage('C0123456:1234567890.123456', 'Sucesso')
        ).resolves.toBeUndefined();
    });

    // ─── sendMessage — erros HTTP ──────────────────────────────────────────────

    it('deve lançar erro quando a resposta HTTP não for ok (ex: 401)', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response('Unauthorized', { status: 401 })
        );

        await expect(
            adapter.sendMessage('C0123456:1234567890.123456', 'Erro HTTP')
        ).rejects.toThrow('[SlackChatAdapter] Erro HTTP 401');
    });

    it('deve lançar erro quando a Slack API retornar ok=false', async () => {
        fetchMock.mockResolvedValueOnce(
            makeSlackResponse(false, { error: 'channel_not_found' })
        );

        await expect(
            adapter.sendMessage('C_INVALIDO:1234567890.123456', 'Erro de API')
        ).rejects.toThrow('[SlackChatAdapter] Slack API retornou erro: channel_not_found');
    });

    it('deve propagar erros de rede (fetch rejeitado)', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network failure'));

        await expect(
            adapter.sendMessage('C0123456:1234567890.123456', 'Sem rede')
        ).rejects.toThrow('Network failure');
    });

    // ─── Decodificação de threadId ─────────────────────────────────────────────

    it('deve lidar corretamente com thread_ts que contém "." (timestamp do Slack)', async () => {
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await adapter.sendMessage('C0123456:1720000000.000001', 'Timestamp test');

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.channel).toBe('C0123456');
        expect(body.thread_ts).toBe('1720000000.000001');
    });

    it('deve usar apenas a primeira ocorrência de ":" como separador', async () => {
        // Cenário hipotético onde o channel_id tenha ":" (improvável, mas garante robustez)
        fetchMock.mockResolvedValueOnce(makeSlackResponse(true));

        await adapter.sendMessage('C0123456:1720000000.000001', 'Separador único');

        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.channel).toBe('C0123456');
        expect(body.thread_ts).toBe('1720000000.000001');
    });
});
