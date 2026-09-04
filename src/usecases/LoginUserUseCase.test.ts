import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginUserUseCase } from './LoginUserUseCase.js';
import type { IUserRepository } from '../domain/ports/IUserRepository.js';
import { User } from '../domain/User.js';
import { Password } from '../domain/Password.js';
import { Role } from '../domain/Role.js';
import { createHash } from 'crypto';

function makeUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
    return {
        findById: vi.fn().mockResolvedValue(null),
        findByEmail: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        addWorkspaceId: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeFakeUser(plainPassword: string, role: Role = Role.OPERATOR): User {
    return new User(
        'user-uuid-123',
        'João Silva',
        'joao@example.com',
        Password.create(plainPassword),
        ['workspace-abc'],
        role,
        new Date(),
        new Date()
    );
}

function makeLegacyUser(plainPassword: string): User {
    const legacyHash = createHash('sha256').update(plainPassword).digest('hex');
    return new User(
        'user-uuid-legacy',
        'Legacy User',
        'legacy@example.com',
        Password.restore(legacyHash),
        ['workspace-abc'],
        Role.OPERATOR,
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

    it('deve gerar um token verificável com role no payload', async () => {
        const fakeUser = makeFakeUser('senha-correta', Role.ADMIN);
        const repo = makeUserRepo({ findByEmail: vi.fn().mockResolvedValue(fakeUser) });
        const useCase = new LoginUserUseCase(repo);

        const { token } = await useCase.execute({
            email: 'joao@example.com',
            password: 'senha-correta',
        });

        const payload = await LoginUserUseCase.verify(token);

        expect(payload.sub).toBe('user-uuid-123');
        expect(payload.email).toBe('joao@example.com');
        expect(payload.role).toBe(Role.ADMIN);
        expect(payload.workspaceIds).toEqual(['workspace-abc']);
    });

    it('verify() deve lançar erro com token inválido', async () => {
        await expect(
            LoginUserUseCase.verify('token.invalido.aqui')
        ).rejects.toThrow();
    });

    it('deve re-hash senha legada SHA-256 para scrypt no login', async () => {
        const legacyUser = makeLegacyUser('senha-legado');
        const saveMock = vi.fn().mockResolvedValue(undefined);
        const repo = makeUserRepo({
            findByEmail: vi.fn().mockResolvedValue(legacyUser),
            save: saveMock,
        });
        const useCase = new LoginUserUseCase(repo);

        const result = await useCase.execute({
            email: 'legacy@example.com',
            password: 'senha-legado',
        });

        expect(result).toHaveProperty('token');
        expect(saveMock).toHaveBeenCalledOnce();
        const savedUser = saveMock.mock.calls[0][0] as User;
        expect(savedUser.password.getValue()).toMatch(/^scrypt:/);
        expect(savedUser.password.needsRehash()).toBe(false);
    });

    it('não deve re-hash se senha já está em scrypt', async () => {
        const fakeUser = makeFakeUser('senha-scrypt');
        const saveMock = vi.fn().mockResolvedValue(undefined);
        const repo = makeUserRepo({
            findByEmail: vi.fn().mockResolvedValue(fakeUser),
            save: saveMock,
        });
        const useCase = new LoginUserUseCase(repo);

        await useCase.execute({
            email: 'joao@example.com',
            password: 'senha-scrypt',
        });

        expect(saveMock).not.toHaveBeenCalled();
    });
});
