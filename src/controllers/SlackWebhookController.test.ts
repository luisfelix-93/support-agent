import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { SlackWebhookController } from './SlackWebhookController.js';
import type { IQueueService } from '../domain/ports/IQueueService.js';

// ─── Constantes de teste ──────────────────────────────────────────────────────

const SIGNING_SECRET = 'test-signing-secret-32chars-long!!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Gera uma assinatura HMAC-SHA256 válida para um dado body e timestamp,
 * simulando o que o Slack faz ao enviar requests.
 */
function makeSlackSignature(body: string, timestamp: string): string {
    const sigBase = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', SIGNING_SECRET).update(sigBase).digest('hex');
    return `v0=${hmac}`;
}

/** Timestamp válido (now) como string de segundos */
function nowTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
}

/** Timestamp expirado (6 minutos atrás) */
function expiredTimestamp(): string {
    return (Math.floor(Date.now() / 1000) - 6 * 60).toString();
}

/**
 * Cria um mock de Request do Express com as propriedades necessárias.
 */
function makeRequest(
    body: unknown,
    rawBody: string,
    headers: Record<string, string> = {}
): Request {
    return {
        body,
        rawBody,
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
    } as unknown as Request;
}

/**
 * Cria um mock de Response com encadeamento de métodos (status → json/send).
 */
function makeResponse(): Response {
    const res = {
        status: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
    } as unknown as Response;
    (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
    (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);
    (res.send as ReturnType<typeof vi.fn>).mockReturnValue(res);
    return res;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('SlackWebhookController', () => {
    let queueService: IQueueService;
    let controller: SlackWebhookController;

    beforeEach(() => {
        queueService = {
            dispatchMessageProcessing: vi.fn().mockResolvedValue(undefined),
        } as IQueueService;
        controller = new SlackWebhookController(queueService, SIGNING_SECRET);
    });

    // ── URL Verification Challenge ────────────────────────────────────────────

    describe('url_verification', () => {
        it('deve responder com o challenge sem verificar assinatura', async () => {
            const challenge = 'abc123xyz';
            const body = { type: 'url_verification', challenge };
            const req = makeRequest(body, JSON.stringify(body));
            const res = makeResponse();

            await controller.handle(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ challenge });
        });
    });

    // ── Verificação de assinatura ─────────────────────────────────────────────

    describe('verificação de assinatura', () => {
        it('deve retornar 401 se os headers de assinatura estiverem ausentes', async () => {
            const rawBody = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'oi' } });
            const req = makeRequest(JSON.parse(rawBody), rawBody);
            const res = makeResponse();

            await controller.handle(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('deve retornar 401 se a assinatura for inválida', async () => {
            const rawBody = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'oi' } });
            const ts = nowTimestamp();
            const req = makeRequest(JSON.parse(rawBody), rawBody, {
                'x-slack-signature': 'v0=invalida',
                'x-slack-request-timestamp': ts,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('deve retornar 401 se o timestamp estiver expirado (replay attack)', async () => {
            const rawBody = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'oi' } });
            const ts = expiredTimestamp();
            const sig = makeSlackSignature(rawBody, ts);
            const req = makeRequest(JSON.parse(rawBody), rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': ts,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });
    });

    // ── event_callback: mensagem de usuário ───────────────────────────────────

    describe('event_callback — mensagem de usuário', () => {
        it('deve despachar a mensagem para a fila com os dados corretos', async () => {
            const channel = 'C0123456';
            const ts = '1720000000.000001';
            const text = 'Olá agente!';
            const event = { type: 'message', channel, ts, text };
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(queueService.dispatchMessageProcessing).toHaveBeenCalledOnce();
            expect(queueService.dispatchMessageProcessing).toHaveBeenCalledWith(
                channel,           // spaceId
                `${channel}:${ts}`, // threadId = "channel:ts"
                text,
                'slack'
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('deve usar thread_ts quando disponível (mensagem dentro de uma thread)', async () => {
            const channel = 'C0123456';
            const ts = '1720000001.000001';
            const thread_ts = '1720000000.000000'; // thread pai
            const text = 'Resposta na thread';
            const event = { type: 'message', channel, ts, thread_ts, text };
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(queueService.dispatchMessageProcessing).toHaveBeenCalledWith(
                channel,
                `${channel}:${thread_ts}`, // usa thread_ts, não ts
                text,
                'slack'
            );
        });
    });

    // ── event_callback: mensagens de bot ─────────────────────────────────────

    describe('event_callback — mensagens de bot (anti-loop)', () => {
        it('deve ignorar mensagens com bot_id e não despachar para a fila', async () => {
            const event = { type: 'message', channel: 'C0123456', ts: '1720000000.0', text: 'Sou um bot', bot_id: 'B123' };
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(queueService.dispatchMessageProcessing).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('deve ignorar mensagens com subtype "bot_message"', async () => {
            const event = { type: 'message', subtype: 'bot_message', channel: 'C0123456', ts: '1720000000.0', text: 'Bot reply' };
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(queueService.dispatchMessageProcessing).not.toHaveBeenCalled();
        });
    });

    // ── event_callback: evento sem texto ──────────────────────────────────────

    describe('event_callback — evento sem texto', () => {
        it('deve ignorar eventos de message sem campo text e retornar 200', async () => {
            const event = { type: 'message', channel: 'C0123456', ts: '1720000000.0' }; // sem text
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(queueService.dispatchMessageProcessing).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // ── Tratamento de erros ───────────────────────────────────────────────────

    describe('tratamento de erros', () => {
        it('deve retornar 500 se o queueService lançar um erro', async () => {
            (queueService.dispatchMessageProcessing as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('QStash indisponível')
            );

            const channel = 'C0123456';
            const ts = '1720000000.000001';
            const event = { type: 'message', channel, ts, text: 'Teste de erro' };
            const body = { type: 'event_callback', event };
            const rawBody = JSON.stringify(body);
            const timestamp = nowTimestamp();
            const sig = makeSlackSignature(rawBody, timestamp);

            const req = makeRequest(body, rawBody, {
                'x-slack-signature': sig,
                'x-slack-request-timestamp': timestamp,
            });
            const res = makeResponse();

            await controller.handle(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
