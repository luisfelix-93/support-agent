import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from './cli.js';
import { MongoConnection } from '../MongoConnection.js';
import { MigrationRunner } from './MigrationRunner.js';

describe('Migration CLI', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        process.env.MONGODB_URI = 'mongodb://localhost:27017';
        process.env.MONGODB_DB_NAME = 'test_db';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('deve executar o runner e desconectar do Mongo com sucesso', async () => {
        const mockDb = {} as any;
        vi.spyOn(MongoConnection, 'connect').mockResolvedValue(mockDb);
        vi.spyOn(MongoConnection, 'disconnect').mockResolvedValue(undefined);
        vi.spyOn(MigrationRunner.prototype, 'run').mockResolvedValue({
            executed: ['001_set_existing_users_admin'],
            skipped: [],
        });

        await runCli();

        expect(MongoConnection.connect).toHaveBeenCalledWith('mongodb://localhost:27017', 'test_db');
        expect(MigrationRunner.prototype.run).toHaveBeenCalled();
        expect(MongoConnection.disconnect).toHaveBeenCalled();
    });

    it('deve encerrar com erro se variáveis de ambiente estiverem ausentes', async () => {
        delete process.env.MONGODB_URI;
        process.exitCode = 0;

        await runCli();

        expect(process.exitCode).toBe(1);
    });

    it('deve capturar erro e desconectar caso runner lance exceção', async () => {
        const mockDb = {} as any;
        vi.spyOn(MongoConnection, 'connect').mockResolvedValue(mockDb);
        vi.spyOn(MongoConnection, 'disconnect').mockResolvedValue(undefined);
        vi.spyOn(MigrationRunner.prototype, 'run').mockRejectedValue(new Error('DB Error'));
        process.exitCode = 0;

        await runCli();

        expect(process.exitCode).toBe(1);
        expect(MongoConnection.disconnect).toHaveBeenCalled();
    });
});
