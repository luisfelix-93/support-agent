import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginUserUseCase } from './LoginUserUseCase.js';
import type { IUserRepository } from '../domain/ports/IUserRepository.js';
import { User } from '../domain/User.js';
import { Password } from '../domain/Password.js';

function makeUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
    return {
        findById: vi.fn().mockResolvedValue(null),
        findByEmail: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        addWorkspaceId: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// Cria um User real com senha hasheada, simulando o que viria do banco
function makeFakeUser(plainPassword: string): User {
    return new User(
        'user-uuid-123',
        'João Silva',
        'joao@example.com',
        Password.create(plainPassword),
        ['workspace-abc'],
        new Date(),
        new Date()
    );
}

describe('LoginUserUseCase', () => {
    const JWT_SECRET = 'test-secret-key-for-vitest-must-be-long-enough';

    beforeEach(() => {
        process.env.JWT_SECRET = JWT_SECRET;
        process.env.JWT_EXPIRES_IN = '1h';
    });

    afterEach(() => {
        delete process.env.JWT_SECRET;
        delete process.env.JWT_EXPIRES_IN;
    });

    it('deve lançar erro no constructor se JWT_SECRET não estiver definido', () => {
        delete process.env.JWT_SECRET;
        const repo = makeUserRepo();
        expect(() => new LoginUserUseCase(repo)).toThrow(
            'JWT_SECRET environment variable is not defined.'
        );
    });

    it('deve retornar um token JWT ao autenticar com credenciais válidas', async () => {
        const fakeUser = makeFakeUser('senha-correta');
        const repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(fakeUser) });
        const useCase = new LoginUserUseCase(repo);

        const result = await useCase.execute({
            email: 'joao@example.com',
            password: 'senha-correta',
        });

        expect(result).toHaveProperty('token');
        expect(typeof result.token).toBe('string');
        // JWTs têm 3 partes separadas por ponto
        expect(result.token.split('.')).toHaveLength(3);
    });

    it('deve lançar erro se o usuário não for encontrado', async () => {
        const repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(null) });
        const useCase = new LoginUserUseCase(repo);

        await expect(
            useCase.execute({ email: 'naoexiste@example.com', password: 'qualquer' })
        ).rejects.toThrow('Invalid credentials.');
    });

    it('deve lançar erro se a senha estiver incorreta', async () => {
        const fakeUser = makeFakeUser('senha-correta');
        const repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(fakeUser) });
        const useCase = new LoginUserUseCase(repo);

        await expect(
            useCase.execute({ email: 'joao@example.com', password: 'senha-errada' })
        ).rejects.toThrow('Invalid credentials.');
    });

    it('deve gerar um token verificável com LoginUserUseCase.verify()', async () => {
        const fakeUser = makeFakeUser('senha-correta');
        const repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(fakeUser) });
        const useCase = new LoginUserUseCase(repo);

        const { token } = await useCase.execute({
            email: 'joao@example.com',
            password: 'senha-correta',
        });

        const payload = await LoginUserUseCase.verify(token);

        expect(payload.sub).toBe('user-uuid-123');
        expect(payload.email).toBe('joao@example.com');
        expect(payload.workspaceIds).toEqual(['workspace-abc']);
    });

    it('verify() deve lançar erro com token inválido', async () => {
        await expect(
            LoginUserUseCase.verify('token.invalido.aqui')
        ).rejects.toThrow();
    });
});
