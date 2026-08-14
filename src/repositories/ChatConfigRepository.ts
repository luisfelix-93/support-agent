import type { Collection } from 'mongodb';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { ChatConfig } from '../domain/ChatConfig.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';
import type { IEncryptionService } from '../domain/ports/IEncryptionService.js';
import { AESEncryptionService } from '../infrastructure/security/AESEncryptionService.js';

export interface ChatConfigDocument {
    _id?: any;
    workspaceId: string;
    provider: string;
    teamId: string;
    botToken: string; // encrypted
    appToken?: string; // encrypted
    signingSecret: string; // encrypted
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export class ChatConfigRepository implements IChatConfigRepository {
    private readonly encryptionService: IEncryptionService;

    constructor(encryptionService?: IEncryptionService) {
        this.encryptionService = encryptionService ?? new AESEncryptionService();
    }

    private get collection(): Collection<ChatConfigDocument> {
        return MongoConnection.getDb().collection<ChatConfigDocument>('chat_configs');
    }

    async findByWorkspaceId(workspaceId: string, provider: string = 'slack'): Promise<ChatConfig | null> {
        const doc = await this.collection.findOne({ workspaceId, provider });
        if (!doc) return null;

        return this.toDomain(doc);
    }

    async findByTeamId(teamId: string): Promise<ChatConfig | null> {
        const doc = await this.collection.findOne({ teamId });
        if (!doc) return null;

        return this.toDomain(doc);
    }

    async save(config: ChatConfig): Promise<void> {
        const now = new Date();
        const encryptedDoc: Omit<ChatConfigDocument, '_id'> = {
            workspaceId: config.workspaceId,
            provider: config.provider,
            teamId: config.teamId,
            botToken: this.encryptionService.encrypt(config.botToken),
            appToken: config.appToken ? this.encryptionService.encrypt(config.appToken) : undefined,
            signingSecret: this.encryptionService.encrypt(config.signingSecret),
            isActive: config.isActive,
            createdAt: config.createdAt ?? now,
            updatedAt: now,
        };

        await this.collection.updateOne(
            { workspaceId: config.workspaceId, provider: config.provider },
            { $set: encryptedDoc },
            { upsert: true }
        );
    }

    async delete(workspaceId: string, provider: string = 'slack'): Promise<void> {
        await this.collection.deleteOne({ workspaceId, provider });
    }

    private toDomain(doc: ChatConfigDocument): ChatConfig {
        return new ChatConfig({
            workspaceId: doc.workspaceId,
            provider: doc.provider,
            teamId: doc.teamId,
            botToken: this.encryptionService.decrypt(doc.botToken),
            appToken: doc.appToken ? this.encryptionService.decrypt(doc.appToken) : undefined,
            signingSecret: this.encryptionService.decrypt(doc.signingSecret),
            isActive: doc.isActive,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        });
    }
}
