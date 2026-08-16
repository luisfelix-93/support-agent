import { describe, it, expect, vi } from 'vitest';
import { RedisShortTermMemory } from './RedisShortTermMemory.js';
import { Message } from '../../domain/Message.js';

describe('RedisShortTermMemory', () => {
    it('deve armazenar e ler contexto do Redis', async () => {
        let storage: Record<string, string> = {};

        const mockRedis = {
            get: vi.fn().mockImplementation((key: string) => Promise.resolve(storage[key] || null)),
            set: vi.fn().mockImplementation((key: string, val: string) => {
                storage[key] = val;
                return Promise.resolve('OK');
            }),
            del: vi.fn().mockImplementation((key: string) => {
                delete storage[key];
                return Promise.resolve(1);
            })
        };

        const stm = new RedisShortTermMemory(mockRedis as any);
        const messages = [new Message('1', 'user', 'Mensagem teste')];

        await stm.set('ws-1', 'thread-1', messages);

        expect(mockRedis.set).toHaveBeenCalledWith(
            'memory:short:ws-1:thread-1',
            expect.any(String),
            'EX',
            expect.any(Number)
        );

        const retrieved = await stm.get('ws-1', 'thread-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.recentMessages.length).toBe(1);
        expect(retrieved?.recentMessages[0].content).toBe('Mensagem teste');

        await stm.clear('ws-1', 'thread-1');
        const afterClear = await stm.get('ws-1', 'thread-1');
        expect(afterClear).toBeNull();
    });
});
