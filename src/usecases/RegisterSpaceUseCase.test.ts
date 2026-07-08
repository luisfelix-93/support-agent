import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterSpaceUseCase } from './RegisterSpaceUseCase.js';
import type { ISpaceMappingRepository } from '../domain/ports/ISpaceMappingRepository.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { Tenant } from '../domain/Tenant.js';
import type { SpaceMapping } from '../domain/SpaceMapping.js';

function makeSpaceMappingRepo(overrides: Partial<ISpaceMappingRepository> = {}): ISpaceMappingRepository {
    return {
        findBySpaceId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeTenantRepo(overrides: Partial<ITenantRepository> = {}): ITenantRepository {
    return {
        findByWorkspaceId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

const fakeTenant = new Tenant(
    'workspace-abc',
    { provider: 'openai', apiKey: 'sk-test' },
    { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
    true
);

describe('RegisterSpaceUseCase', () => {
    let spaceMappingRepo: ISpaceMappingRepository;
    let tenantRepo: ITenantRepository;
    let useCase: RegisterSpaceUseCase;

    beforeEach(() => {
        tenantRepo = makeTenantRepo({
            findByWorkspaceId: vi.fn().mockResolvedValue(fakeTenant),
        });
        spaceMappingRepo = makeSpaceMappingRepo();
        useCase = new RegisterSpaceUseCase(spaceMappingRepo, tenantRepo);
    });

    it('deve registrar um space e retornar o spaceId', async () => {
        const result = await useCase.execute({
            spaceId: 'spaces/AAAA1111',
            workspaceId: 'workspace-abc',
        });

        expect(result).toEqual({ spaceId: 'spaces/AAAA1111' });
        expect(spaceMappingRepo.save).toHaveBeenCalledOnce();
    });

    it('deve salvar o SpaceMapping com os dados corretos', async () => {
        await useCase.execute({ spaceId: 'spaces/BBBB2222', workspaceId: 'workspace-abc' });

        const saved = vi.mocked(spaceMappingRepo.save).mock.calls[0][0] as SpaceMapping;
        expect(saved.spaceId).toBe('spaces/BBBB2222');
        expect(saved.workspaceId).toBe('workspace-abc');
    });

    it('deve lançar erro se o tenant não existir', async () => {
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(null) });
        useCase = new RegisterSpaceUseCase(spaceMappingRepo, tenantRepo);

        await expect(
            useCase.execute({ spaceId: 'spaces/XXXX', workspaceId: 'ws-inexistente' })
        ).rejects.toThrow("Tenant with workspaceId 'ws-inexistente' not found.");
    });

    it('não deve salvar o SpaceMapping se o tenant não existir', async () => {
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(null) });
        useCase = new RegisterSpaceUseCase(spaceMappingRepo, tenantRepo);

        await expect(
            useCase.execute({ spaceId: 'spaces/XXXX', workspaceId: 'ws-inexistente' })
        ).rejects.toThrow();

        expect(spaceMappingRepo.save).not.toHaveBeenCalled();
    });
});
