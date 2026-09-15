import type { Db } from 'mongodb';
import { Role } from '../../../domain/Role.js';
import type { Migration } from './Migration.js';
import { logger } from '../../../config/logger.js';

const log = logger.child({ module: 'Migration_001_SetExistingUsersAdmin' });

export const setExistingUsersAdminMigration: Migration = {
    name: '001_set_existing_users_admin',

    async up(db: Db): Promise<void> {
        const usersCollection = db.collection('users');

        log.info('Iniciando migração para atualizar usuários existentes para a role ADMIN...');

        const result = await usersCollection.updateMany(
            { role: { $ne: Role.ADMIN } },
            {
                $set: {
                    role: Role.ADMIN,
                    updatedAt: new Date(),
                },
            }
        );

        log.info(
            { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
            'Migração 001 concluída: usuários existentes atualizados para ADMIN.'
        );
    },

    async down(db: Db): Promise<void> {
        const usersCollection = db.collection('users');
        log.warn('Executando rollback da migração 001: revertendo role para OPERATOR...');

        const result = await usersCollection.updateMany(
            { role: Role.ADMIN },
            {
                $set: {
                    role: Role.OPERATOR,
                    updatedAt: new Date(),
                },
            }
        );

        log.info(
            { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
            'Rollback da migração 001 concluído.'
        );
    },
};
