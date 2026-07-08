import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterUserUseCase } from './RegisterUserUseCase.js';
import type { IUserRepository } from '../domain/ports/IUserRepository.js';
import type { User } from '../domain/User.js';

// Mock de repositório reutilizável
function makeUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
    return {
        findById: vi.fn().mockResolvedValue(null),
        findByEmail: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        addWorkspaceId: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('RegisterUserUseCase', () => {
    let repo: IUserRepository;
    let useCase: RegisterUserUseCase;

    beforeEach(() => {
        repo = makeUserRepo();
        useCase = new RegisterUserUseCase(repo);
    });

    it('deve registrar um novo usuário e retornar seu id', async () => {
        const result = await useCase.execute({
            name: 'João Silva',
            email: 'joao@example.com',
            password: 'senha123',
        });

        expect(result).toHaveProperty('id');
        expect(typeof result.id).toBe('string');
        expect(repo.save).toHaveBeenCalledOnce();
    });

    it('deve salvar o usuário com a senha hasheada (não em texto plano)', async () => {
        await useCase.execute({
            name: 'Maria',
            email: 'maria@example.com',
            password: 'senha-segura',
        });

        const savedUser = vi.mocked(repo.save).mock.calls[0][0] as User;
        expect(savedUser.password.getValue()).not.toBe('senha-segura');
        expect(savedUser.password.getValue()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('deve criar o usuário com workspaceId vazio', async () => {
        await useCase.execute({
            name: 'Carlos',
            email: 'carlos@example.com',
            password: 'senha456',
        });

        const savedUser = vi.mocked(repo.save).mock.calls[0][0] as User;
        expect(savedUser.workspaceId).toEqual([]);
    });

    it('deve lançar erro se o email já estiver cadastrado', async () => {
        const existingUser = { id: 'user-1', email: 'joao@example.com' } as User;
        repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(existingUser) });
        useCase = new RegisterUserUseCase(repo);

        await expect(
            useCase.execute({ name: 'João', email: 'joao@example.com', password: 'senha123' })
        ).rejects.toThrow('Email already registered.');
    });

    it('não deve chamar save se o email já existir', async () => {
        const existingUser = { id: 'user-1' } as User;
        repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(existingUser) });
        useCase = new RegisterUserUseCase(repo);

        await expect(
            useCase.execute({ name: 'X', email: 'x@x.com', password: 'senha123' })
        ).rejects.toThrow();

        expect(repo.save).not.toHaveBeenCalled();
    });
});
