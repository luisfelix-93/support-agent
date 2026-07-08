import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterTenantUseCase } from './RegisterTenantUseCase.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import type { Tenant } from '../domain/Tenant.js';
import type { LLMConfig } from '../domain/LLMConfig.js';
import type { MCPConfig } from '../domain/Tenant.js';

function makeTenantRepo(overrides: Partial<ITenantRepository> = {}): ITenantRepository {
    return {
        findByWorkspaceId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

const llmConfig: LLMConfig = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' };
const mcpConfig: MCPConfig = { url: 'https://mcp.example.com', apiKey: 'mcp-key' };

describe('RegisterTenantUseCase', () => {
    let repo: ITenantRepository;
    let useCase: RegisterTenantUseCase;

    beforeEach(() => {
        repo = makeTenantRepo();
        useCase = new RegisterTenantUseCase(repo);
    });

    it('deve registrar um novo tenant e retornar o workspaceId', async () => {
        const result = await useCase.execute({
            workspaceId: 'workspace-abc',
            llmConfig,
            mcpConfig,
        });

        expect(result).toEqual({ workspaceId: 'workspace-abc' });
        expect(repo.save).toHaveBeenCalledOnce();
    });

    it('deve salvar o tenant com isActive = true por padrão', async () => {
        await useCase.execute({ workspaceId: 'ws-1', llmConfig, mcpConfig });

        const saved = vi.mocked(repo.save).mock.calls[0][0] as Tenant;
        expect(saved.isActive).toBe(true);
    });

    it('deve salvar o tenant com as configs de LLM e MCP corretas', async () => {
        await useCase.execute({ workspaceId: 'ws-2', llmConfig, mcpConfig });

        const saved = vi.mocked(repo.save).mock.calls[0][0] as Tenant;
        expect(saved.llmConfig).toEqual(llmConfig);
        expect(saved.mcpConfig).toEqual(mcpConfig);
    });

    it('deve lançar erro se o tenant já existir', async () => {
        const existingTenant = { workspaceId: 'ws-existente' } as Tenant;
        repo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(existingTenant) });
        useCase = new RegisterTenantUseCase(repo);

        await expect(
            useCase.execute({ workspaceId: 'ws-existente', llmConfig, mcpConfig })
        ).rejects.toThrow("Tenant with workspaceId 'ws-existente' already exists.");
    });

    it('não deve chamar save se o tenant já existir', async () => {
        const existingTenant = { workspaceId: 'ws-existente' } as Tenant;
        repo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(existingTenant) });
        useCase = new RegisterTenantUseCase(repo);

        await expect(
            useCase.execute({ workspaceId: 'ws-existente', llmConfig, mcpConfig })
        ).rejects.toThrow();

        expect(repo.save).not.toHaveBeenCalled();
    });
});
