import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatWebhookController } from './ChatWebhookController.js';
import type { IQueueService } from '../domain/ports/IQueueService.js';
import type { IdempotencyGuard } from '../infrastructure/resilience/IdempotencyGuard.js';

describe('ChatWebhookController', () => {
    let queueServiceMock: IQueueService;
    let idempotencyGuardMock: IdempotencyGuard;
    let controller: ChatWebhookController;

    beforeEach(() => {
        queueServiceMock = {
            dispatchMessageProcessing: vi.fn().mockResolvedValue(undefined),
            dispatchMemoryPromotion: vi.fn().mockResolvedValue(undefined),
        };

        idempotencyGuardMock = {
            isDuplicate: vi.fn().mockResolvedValue(false),
            ttlSeconds: 3600,
            prefix: 'idempotency:',
        } as unknown as IdempotencyGuard;

        controller = new ChatWebhookController(queueServiceMock, idempotencyGuardMock);
    });

    const createMockRes = () => {
        const res: any = {};
        res.status = vi.fn().mockReturnValue(res);
        res.send = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    it('responde com link de setup no evento ADD_TO_SPACE', async () => {
        const req: any = {
            body: {
                type: 'ADD_TO_SPACE',
                space: { name: 'spaces/space-123' },
            },
        };
        const res = createMockRes();

        await controller.handle(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('spaces%2Fspace-123'),
            })
        );
        expect(queueServiceMock.dispatchMessageProcessing).not.toHaveBeenCalled();
    });

    it('enfileira mensagem e retorna 200 quando não for duplicada', async () => {
        const req: any = {
            body: {
                type: 'MESSAGE',
                space: { name: 'spaces/space-123' },
                message: {
                    name: 'spaces/space-123/messages/msg-456',
                    thread: { name: 'spaces/space-123/threads/th-789' },
                    text: 'Olá suporte',
                },
            },
        };
        const res = createMockRes();

        await controller.handle(req, res);

        expect(idempotencyGuardMock.isDuplicate).toHaveBeenCalled();
        expect(queueServiceMock.dispatchMessageProcessing).toHaveBeenCalledWith(
            'spaces/space-123',
            'spaces/space-123/threads/th-789',
            'Olá suporte',
            'google'
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
    });

    it('ignora silenciosamente e não enfileira quando a mensagem for duplicada (idempotência)', async () => {
        vi.mocked(idempotencyGuardMock.isDuplicate).mockResolvedValue(true);

        const req: any = {
            body: {
                type: 'MESSAGE',
                space: { name: 'spaces/space-123' },
                message: {
                    name: 'spaces/space-123/messages/msg-duplicate',
                    text: 'Mensagem repetida',
                },
            },
        };
        const res = createMockRes();

        await controller.handle(req, res);

        expect(idempotencyGuardMock.isDuplicate).toHaveBeenCalled();
        expect(queueServiceMock.dispatchMessageProcessing).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
    });
});
