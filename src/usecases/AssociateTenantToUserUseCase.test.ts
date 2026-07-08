import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssociateTenantToUserUseCase } from './AssociateTenantToUserUseCase.js';
import type { IUserRepository } from '../domain/ports/IUserRepository.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { User } from '../domain/User.js';
import { Password } from '../domain/Password.js';
import { Tenant } from '../domain/Tenant.js';

function makeUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
    return {
        findById: vi.fn().mockResolvedValue(null),
        findByEmail: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        addWorkspaceId: vi.fn().mockResolvedValue(undefined),
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

const fakeUser = new User(
    'user-123',
    'João Silva',
    'joao@example.com',
    Password.restore('hashed-password'),
    [],
    new Date(),
    new Date()
);

const fakeTenant = new Tenant(
    'workspace-abc',
    { provider: 'openai', apiKey: 'sk-test' },
    { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
    true
);

describe('AssociateTenantToUserUseCase', () => {
    let userRepo: IUserRepository;
    let tenantRepo: ITenantRepository;
    let useCase: AssociateTenantToUserUseCase;

    beforeEach(() => {
        userRepo = makeUserRepo({ findById: vi.fn().mockResolvedValue(fakeUser) });
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(fakeTenant) });
        useCase = new AssociateTenantToUserUseCase(userRepo, tenantRepo);
    });

    it('deve associar um tenant ao usuário com sucesso', async () => {
        await expect(
            useCase.execute({ userId: 'user-123', workspaceId: 'workspace-abc' })
        ).resolves.toBeUndefined();

        expect(userRepo.addWorkspaceId).toHaveBeenCalledWith('user-123', 'workspace-abc');
    });

    it('deve lançar erro se o usuário não for encontrado', async () => {
        userRepo = makeUserRepo({ findById: vi.fn().mockResolvedValue(null) });
        useCase = new AssociateTenantToUserUseCase(userRepo, tenantRepo);

        await expect(
            useCase.execute({ userId: 'user-inexistente', workspaceId: 'workspace-abc' })
        ).rejects.toThrow("User 'user-inexistente' not found.");
    });

    it('deve lançar erro se o tenant não for encontrado', async () => {
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(null) });
        useCase = new AssociateTenantToUserUseCase(userRepo, tenantRepo);

        await expect(
            useCase.execute({ userId: 'user-123', workspaceId: 'ws-inexistente' })
        ).rejects.toThrow("Tenant with workspaceId 'ws-inexistente' not found.");
    });

    it('não deve chamar addWorkspaceId se o usuário não existir', async () => {
        userRepo = makeUserRepo({ findById: vi.fn().mockResolvedValue(null) });
        useCase = new AssociateTenantToUserUseCase(userRepo, tenantRepo);

        await expect(
            useCase.execute({ userId: 'user-inexistente', workspaceId: 'workspace-abc' })
        ).rejects.toThrow();

        expect(userRepo.addWorkspaceId).not.toHaveBeenCalled();
    });

    it('não deve chamar addWorkspaceId se o tenant não existir', async () => {
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(null) });
        useCase = new AssociateTenantToUserUseCase(userRepo, tenantRepo);

        await expect(
            useCase.execute({ userId: 'user-123', workspaceId: 'ws-inexistente' })
        ).rejects.toThrow();

        expect(userRepo.addWorkspaceId).not.toHaveBeenCalled();
    });
});
