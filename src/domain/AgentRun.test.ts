import { describe, it, expect } from 'vitest';
import { AgentRun } from './AgentRun.js';
import type { LLMCallRecord } from './LLMCallRecord.js';

describe('AgentRun', () => {
    it('deve inicializar com valores padrão', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');

        expect(run.id).toBe('run-1');
        expect(run.tenantId).toBe('tenant-1');
        expect(run.workspaceId).toBe('ws-1');
        expect(run.threadId).toBe('thread-1');
        expect(run.status).toBe('running');
        expect(run.iterations).toBe(0);
        expect(run.toolCalls).toEqual([]);
        expect(run.llmCalls).toEqual([]);
        expect(run.totalInputTokens).toBe(0);
        expect(run.totalOutputTokens).toBe(0);
        expect(run.totalTokens).toBe(0);
        expect(run.costUsd).toBe(0);
        expect(run.memoriesInjected).toBe(0);
        expect(run.contextUtilization).toBe(0);
        expect(run.startedAt).toBeInstanceOf(Date);
        expect(run.completedAt).toBeUndefined();
    });

    it('deve registrar tool calls', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');
        run.recordToolCall({
            toolName: 'query_db',
            args: { query: 'SELECT 1' },
            result: [{ 1: 1 }],
            durationMs: 15,
        });

        expect(run.toolCalls).toHaveLength(1);
        expect(run.toolCalls[0].toolName).toBe('query_db');
    });

    it('deve registrar LLM calls e atualizar totais automaticamente', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');

        const call1: LLMCallRecord = {
            provider: 'openai',
            model: 'gpt-4o',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            latencyMs: 300,
            resultType: 'tool_call',
            costUsd: 0.00075,
        };

        const call2: LLMCallRecord = {
            provider: 'openai',
            model: 'gpt-4o',
            inputTokens: 200,
            outputTokens: 80,
            totalTokens: 280,
            latencyMs: 450,
            resultType: 'text',
            costUsd: 0.0013,
        };

        run.recordLLMCall(call1);
        expect(run.llmCalls).toHaveLength(1);
        expect(run.totalInputTokens).toBe(100);
        expect(run.totalOutputTokens).toBe(50);
        expect(run.totalTokens).toBe(150);
        expect(run.costUsd).toBe(0.00075);

        run.recordLLMCall(call2);
        expect(run.llmCalls).toHaveLength(2);
        expect(run.totalInputTokens).toBe(300);
        expect(run.totalOutputTokens).toBe(130);
        expect(run.totalTokens).toBe(430);
        expect(run.costUsd).toBe(0.00205);
    });

    it('deve finalizar o run corretamente e recalcular totais', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');
        run.recordLLMCall({
            provider: 'google',
            model: 'gemini-2.0-flash',
            inputTokens: 500,
            outputTokens: 100,
            totalTokens: 600,
            latencyMs: 200,
            resultType: 'text',
            costUsd: 0.00009,
        });

        run.finish('completed');
        expect(run.status).toBe('completed');
        expect(run.completedAt).toBeInstanceOf(Date);
        expect(run.error).toBeUndefined();
        expect(run.totalTokens).toBe(600);
    });

    it('deve registrar erro ao finalizar com falha', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');
        run.finish('failed', 'Timeout error');

        expect(run.status).toBe('failed');
        expect(run.error).toBe('Timeout error');
        expect(run.completedAt).toBeInstanceOf(Date);
    });
});
