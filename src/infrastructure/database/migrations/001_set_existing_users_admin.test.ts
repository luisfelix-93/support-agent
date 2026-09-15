import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setExistingUsersAdminMigration } from './001_set_existing_users_admin.js';
import { Role } from '../../../domain/Role.js';
import type { Db } from 'mongodb';

describe('Migration: 001_set_existing_users_admin', () => {
    let mockDb: any;
    let mockUsersCollection: any;

    beforeEach(() => {
        mockUsersCollection = {
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 3, modifiedCount: 3 }),
        };

        mockDb = {
            collection: vi.fn().mockImplementation((name: string) => {
                if (name === 'users') return mockUsersCollection;
                throw new Error(`Unexpected collection: ${name}`);
            }),
        } as unknown as Db;
    });

    it('deve possuir o nome correto de identificação', () => {
        expect(setExistingUsersAdminMigration.name).toBe('001_set_existing_users_admin');
    });

    it('deve atualizar todos os usuários cujo role não seja ADMIN para ADMIN no método up()', async () => {
        await setExistingUsersAdminMigration.up(mockDb);

        expect(mockDb.collection).toHaveBeenCalledWith('users');
        expect(mockUsersCollection.updateMany).toHaveBeenCalledWith(
            { role: { $ne: Role.ADMIN } },
            {
                $set: {
                    role: Role.ADMIN,
                    updatedAt: expect.any(Date),
                },
            }
        );
    });

    it('deve executar com sucesso mesmo se a collection estiver vazia (0 usuários)', async () => {
        mockUsersCollection.updateMany.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });

        await expect(setExistingUsersAdminMigration.up(mockDb)).resolves.not.toThrow();
        expect(mockUsersCollection.updateMany).toHaveBeenCalledWith(
            { role: { $ne: Role.ADMIN } },
            expect.any(Object)
        );
    });

    it('deve reverter os usuários ADMIN para OPERATOR no método down()', async () => {
        if (!setExistingUsersAdminMigration.down) {
            throw new Error('down method should be defined');
        }

        await setExistingUsersAdminMigration.down(mockDb);

        expect(mockDb.collection).toHaveBeenCalledWith('users');
        expect(mockUsersCollection.updateMany).toHaveBeenCalledWith(
            { role: Role.ADMIN },
            {
                $set: {
                    role: Role.OPERATOR,
                    updatedAt: expect.any(Date),
                },
            }
        );
    });
});
