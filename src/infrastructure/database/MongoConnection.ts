import { Db, MongoClient } from "mongodb";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: 'MongoConnection' });

export class MongoConnection {
    private static client: MongoClient;
    private static db: Db;

    static async connect(uri: string, dbName: string): Promise<Db> {
        if (!this.client) {
            this.client = new MongoClient(uri);
            await this.client.connect();
            this.db = this.client.db(dbName);
            log.info({ dbName }, 'Conectado ao banco de dados MongoDB.');
        }
        return this.db;
    }

    static getDb(): Db {
        if (!this.db) {
            throw new Error("Sem conexão com o banco de dados");
        }
        return this.db;
    }
}