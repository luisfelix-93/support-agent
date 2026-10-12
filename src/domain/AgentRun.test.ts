import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRun } from './AgentRun.js';
import { resetAgentVersionCache } from '../config/version.js';

describe('AgentRun domain entity', () => {
    const originalEnv = process.env.AGENT_VERSION;

    beforeEach(() => {
        resetAgentVersionCache();
        delete process.env.AGENT_VERSION;
    });

    afterEach(() => {
        resetAgentVersionCache();
        if (originalEnv !== undefined) {
            process.env.AGENT_VERSION = originalEnv;
        } else {
            delete process.env.AGENT_VERSION;
        }
    });

    it('deve inicializar agentVersion com a versão do package.json (1.3.0) por padrão', () => {
        const run = new AgentRun('run-1', 'tenant-1', 'ws-1', 'thread-1');
        expect(run.agentVersion).toBe('1.3.0');
    });

    it('deve respeitar a variável de ambiente AGENT_VERSION quando definida', () => {
        process.env.AGENT_VERSION = '2.1.0';
        const run = new AgentRun('run-2', 'tenant-1', 'ws-1', 'thread-1');
        expect(run.agentVersion).toBe('2.1.0');
    });
});
