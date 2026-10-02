import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionPolicy } from './ExecutionPolicy.js';

describe('ExecutionPolicy', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.MAX_TOOL_ITERATIONS;
        delete process.env.MAX_IDENTICAL_TOOL_CALLS;
        delete process.env.MCP_TIMEOUT_MS;
        delete process.env.MAX_CONTEXT_TOKENS;
        delete process.env.MAX_RUN_TIME_MS;
        delete process.env.LLM_TIMEOUT_MS;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('deve inicializar com valores padrão esperados', () => {
        const policy = new ExecutionPolicy();

        expect(policy.maxIterations).toBe(12);
        expect(policy.maxIdenticalToolCalls).toBe(2);
        expect(policy.mcpTimeoutMs).toBe(25000);
        expect(policy.maxContextTokens).toBe(4096);
        expect(policy.maxRunTimeMs).toBe(120000);
        expect(policy.llmTimeoutMs).toBe(60000);
    });

    it('deve priorizar valores passados no construtor', () => {
        const policy = new ExecutionPolicy({
            maxIterations: 8,
            maxIdenticalToolCalls: 3,
            mcpTimeoutMs: 10000,
            maxContextTokens: 8192,
            maxRunTimeMs: 60000,
            llmTimeoutMs: 30000,
        });

        expect(policy.maxIterations).toBe(8);
        expect(policy.maxIdenticalToolCalls).toBe(3);
        expect(policy.mcpTimeoutMs).toBe(10000);
        expect(policy.maxContextTokens).toBe(8192);
        expect(policy.maxRunTimeMs).toBe(60000);
        expect(policy.llmTimeoutMs).toBe(30000);
    });

    it('deve carregar valores de variáveis de ambiente quando não fornecidos no construtor', () => {
        process.env.MAX_TOOL_ITERATIONS = '15';
        process.env.MAX_IDENTICAL_TOOL_CALLS = '4';
        process.env.MCP_TIMEOUT_MS = '15000';
        process.env.MAX_CONTEXT_TOKENS = '2048';
        process.env.MAX_RUN_TIME_MS = '90000';
        process.env.LLM_TIMEOUT_MS = '45000';

        const policy = new ExecutionPolicy();

        expect(policy.maxIterations).toBe(15);
        expect(policy.maxIdenticalToolCalls).toBe(4);
        expect(policy.mcpTimeoutMs).toBe(15000);
        expect(policy.maxContextTokens).toBe(2048);
        expect(policy.maxRunTimeMs).toBe(90000);
        expect(policy.llmTimeoutMs).toBe(45000);
    });

    it('deve avaliar shouldContinue corretamente com base no número de iterações', () => {
        const policy = new ExecutionPolicy({ maxIterations: 3 });

        expect(policy.shouldContinue(0)).toBe(true);
        expect(policy.shouldContinue(1)).toBe(true);
        expect(policy.shouldContinue(2)).toBe(true);
        expect(policy.shouldContinue(3)).toBe(false);
        expect(policy.shouldContinue(4)).toBe(false);
    });
});
