import type { Db } from 'mongodb';
import { logger } from '../../../config/logger.js';
import type { Migration } from './Migration.js';
import { setExistingUsersAdminMigration } from './001_set_existing_users_admin.js';

const log = logger.child({ module: 'MigrationRunner' });

export const defaultMigrations: Migration[] = [
    setExistingUsersAdminMigration,
];

export interface MigrationDocument {
    name: string;
    executedAt: Date;
}

export class MigrationRunner {
    constructor(
        private readonly db: Db,
        private readonly migrations: Migration[] = defaultMigrations
    ) {}

    async run(): Promise<{ executed: string[]; skipped: string[] }> {
        const migrationsCollection = this.db.collection<MigrationDocument>('_migrations');

        try {
            await migrationsCollection.createIndex({ name: 1 }, { unique: true });
        } catch {
            // Se já existir ou não suportar índice no ambiente mock, segue em frente
        }

        const executed: string[] = [];
        const skipped: string[] = [];

        for (const migration of this.migrations) {
            const alreadyExecuted = await migrationsCollection.findOne({ name: migration.name });

            if (alreadyExecuted) {
                log.debug({ migration: migration.name }, 'Migração já executada previamente. Ignorando.');
                skipped.push(migration.name);
                continue;
            }

            log.info({ migration: migration.name }, 'Executando migração...');
            await migration.up(this.db);

            await migrationsCollection.insertOne({
                name: migration.name,
                executedAt: new Date(),
            });

            log.info({ migration: migration.name }, 'Migração concluída e registrada com sucesso.');
            executed.push(migration.name);
        }

        return { executed, skipped };
    }
}
