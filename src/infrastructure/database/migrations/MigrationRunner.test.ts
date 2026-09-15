import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationRunner } from './MigrationRunner.js';
import type { Migration } from './Migration.js';
import type { Db } from 'mongodb';

describe('MigrationRunner', () => {
    let mockDb: any;
    let mockMigrationsCollection: any;

    beforeEach(() => {
        mockMigrationsCollection = {
            createIndex: vi.fn().mockResolvedValue('name_1'),
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        };

        mockDb = {
            collection: vi.fn().mockImplementation((name: string) => {
                if (name === '_migrations') return mockMigrationsCollection;
                return {};
            }),
        } as unknown as Db;
    });

    it('deve executar migrações pendentes e registrar no _migrations', async () => {
        const fakeMigration: Migration = {
            name: '001_test_migration',
            up: vi.fn().mockResolvedValue(undefined),
        };

        const runner = new MigrationRunner(mockDb, [fakeMigration]);
        const result = await runner.run();

        expect(mockMigrationsCollection.createIndex).toHaveBeenCalledWith({ name: 1 }, { unique: true });
        expect(fakeMigration.up).toHaveBeenCalledWith(mockDb);
        expect(mockMigrationsCollection.insertOne).toHaveBeenCalledWith(
            expect.objectContaining({
                name: '001_test_migration',
                executedAt: expect.any(Date),
            })
        );
        expect(result.executed).toEqual(['001_test_migration']);
        expect(result.skipped).toEqual([]);
    });

    it('deve pular migração já executada', async () => {
        mockMigrationsCollection.findOne.mockResolvedValue({
            name: '001_test_migration',
            executedAt: new Date(),
        });

        const fakeMigration: Migration = {
            name: '001_test_migration',
            up: vi.fn().mockResolvedValue(undefined),
        };

        const runner = new MigrationRunner(mockDb, [fakeMigration]);
        const result = await runner.run();

        expect(fakeMigration.up).not.toHaveBeenCalled();
        expect(mockMigrationsCollection.insertOne).not.toHaveBeenCalled();
        expect(result.executed).toEqual([]);
        expect(result.skipped).toEqual(['001_test_migration']);
    });

    it('deve continuar mesmo se createIndex falhar', async () => {
        mockMigrationsCollection.createIndex.mockRejectedValue(new Error('Index error'));

        const fakeMigration: Migration = {
            name: '001_test_migration',
            up: vi.fn().mockResolvedValue(undefined),
        };

        const runner = new MigrationRunner(mockDb, [fakeMigration]);
        const result = await runner.run();

        expect(fakeMigration.up).toHaveBeenCalled();
        expect(result.executed).toEqual(['001_test_migration']);
    });
});
