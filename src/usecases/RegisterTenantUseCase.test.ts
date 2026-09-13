import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterTenantUseCase } from './RegisterTenantUseCase.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import type { Tenant, MCPServerConfig } from '../domain/Tenant.js';
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

    it('deve registrar um tenant com múltiplos servidores em mcpServers', async () => {
        const mcpServers: MCPServerConfig[] = [
            { id: 'k8s', name: 'K8s MCP', url: 'https://k8s.example.com', apiKey: 'k8s-key', domains: ['k8s'] },
            { id: 'loki', name: 'Loki MCP', url: 'https://loki.example.com', apiKey: 'loki-key', domains: ['logs'] },
        ];

        const result = await useCase.execute({
            workspaceId: 'ws-multi-mcp',
            llmConfig,
            mcpServers,
        });

        expect(result).toEqual({ workspaceId: 'ws-multi-mcp' });
        const saved = vi.mocked(repo.save).mock.calls[0][0] as Tenant;
        expect(saved.mcpServers).toHaveLength(2);
        expect(saved.mcpServers[0].id).toBe('k8s');
        expect(saved.mcpServers[1].id).toBe('loki');
        expect(saved.mcpConfig.url).toBe('https://k8s.example.com');
    });

    it('deve rejeitar se nem mcpConfig nem mcpServers forem informados', async () => {
        await expect(
            useCase.execute({ workspaceId: 'ws-invalid', llmConfig } as any)
        ).rejects.toThrow('Pelo menos uma configuração MCP');
    });

    it('deve rejeitar se mcpServers contiver IDs duplicados', async () => {
        const mcpServers: MCPServerConfig[] = [
            { id: 'k8s', name: 'K8s 1', url: 'https://k8s-1.com' },
            { id: 'k8s', name: 'K8s 2', url: 'https://k8s-2.com' },
        ];

        await expect(
            useCase.execute({ workspaceId: 'ws-dup', llmConfig, mcpServers })
        ).rejects.toThrow('ID de servidor duplicado');
    });

    it('deve rejeitar se algum servidor não possuir id ou url válidos', async () => {
        await expect(
            useCase.execute({
                workspaceId: 'ws-missing-id',
                llmConfig,
                mcpServers: [{ id: '', name: 'Invalid', url: 'https://valid.com' }],
            })
        ).rejects.toThrow('deve possuir um "id" válido');

        await expect(
            useCase.execute({
                workspaceId: 'ws-missing-url',
                llmConfig,
                mcpServers: [{ id: 'srv-1', name: 'No URL', url: '' }],
            })
        ).rejects.toThrow('deve possuir uma "url" válida');
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
