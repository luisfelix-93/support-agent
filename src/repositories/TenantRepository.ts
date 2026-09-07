import { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { Tenant } from "../domain/Tenant.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";
import type { IEncryptionService } from "../domain/ports/IEncryptionService.js";
import { AESEncryptionService } from "../infrastructure/security/AESEncryptionService.js";

export class TenantRepository implements ITenantRepository {
    private readonly encryptionService: IEncryptionService;

    constructor(encryptionService?: IEncryptionService) {
        this.encryptionService = encryptionService ?? new AESEncryptionService();
    }

    private get collection(): Collection {
        return MongoConnection.getDb().collection("tenants");
    }

    async findByWorkspaceId(workspaceId: string): Promise<Tenant | null> {
        const document = await this.collection.findOne({ workspaceId });
        if (!document) return null;

        const rawApiKey = document.mcpConfig?.apiKey ?? '';
        const decryptedApiKey = this.decryptApiKey(rawApiKey);

        return new Tenant(
            document.workspaceId,
            {
                provider: document.llmConfig.provider,
                apiKey: document.llmConfig.apiKey,
                model: document.llmConfig.model
            },
            {
                url: document.mcpConfig.serverUrl ?? document.mcpConfig.url,
                apiKey: decryptedApiKey
            },
            document.isActive
        );
    }

    async findByWorkspaceIdSafe(workspaceId: string): Promise<Tenant | null> {
        const tenant = await this.findByWorkspaceId(workspaceId);
        if (!tenant) return null;

        return new Tenant(
            tenant.workspaceId,
            tenant.llmConfig,
            {
                ...tenant.mcpConfig,
                apiKey: this.maskApiKey(tenant.mcpConfig?.apiKey ?? '')
            },
            tenant.isActive
        );
    }

    async save(tenant: Tenant): Promise<void> {
        const rawApiKey = tenant.mcpConfig?.apiKey ?? '';
        const encryptedApiKey = rawApiKey
            ? this.encryptionService.encrypt(rawApiKey, 'mcp')
            : '';

        const documentToSave = {
            workspaceId: tenant.workspaceId,
            llmConfig: tenant.llmConfig,
            mcpConfig: {
                url: tenant.mcpConfig.url,
                apiKey: encryptedApiKey,
            },
            isActive: tenant.isActive,
        };

        await this.collection.updateOne(
            { workspaceId: tenant.workspaceId },
            { $set: documentToSave },
            { upsert: true }
        );
    }

    private decryptApiKey(cipherOrPlainText: string): string {
        if (!cipherOrPlainText) return '';
        try {
            // Se possui o formato de texto cifrado (iv:authTag:ciphertext)
            if (cipherOrPlainText.split(':').length === 3) {
                return this.encryptionService.decrypt(cipherOrPlainText, 'mcp');
            }
            return cipherOrPlainText;
        } catch {
            return cipherOrPlainText;
        }
    }

    private maskApiKey(key: string): string {
        if (!key) return '';
        if (key.length <= 4) return '****';
        return `***...${key.slice(-4)}`;
    }
}