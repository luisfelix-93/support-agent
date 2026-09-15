import 'dotenv/config';
import { MongoConnection } from '../MongoConnection.js';
import { MigrationRunner } from './MigrationRunner.js';
import { logger } from '../../../config/logger.js';

const log = logger.child({ module: 'MigrationCLI' });

export async function runCli(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME;

    if (!mongoUri || !dbName) {
        log.error('MONGODB_URI ou MONGODB_DB_NAME não configurados nas variáveis de ambiente.');
        process.exitCode = 1;
        return;
    }

    try {
        log.info('Conectando ao MongoDB para execução das migrações...');
        const db = await MongoConnection.connect(mongoUri, dbName);

        const runner = new MigrationRunner(db);
        const result = await runner.run();

        log.info(
            { executed: result.executed, skipped: result.skipped },
            'Migrações processadas com sucesso.'
        );
    } catch (error) {
        log.error({ err: error }, 'Erro fatal durante a execução das migrações.');
        process.exitCode = 1;
    } finally {
        await MongoConnection.disconnect();
    }
}

// Executa se chamado diretamente via CLI
if (process.argv[1]?.includes('cli.ts') || process.argv[1]?.includes('cli.js')) {
    runCli();
}
