import { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { Tenant } from "../domain/Tenant.js";
import { ITenantRepository } from "../domain/ports/ITenantRepository.js";

export class TenantRepository implements ITenantRepository {
    private get collection(): Collection {
        return MongoConnection.getDb().collection("tenants");
    }

    async findByWorkspaceId(workspaceId: string): Promise<Tenant | null> {
        const document = await this.collection.findOne({ workspaceId });
        if (!document) return null;

        return new Tenant(
            document.workspaceId,
            {
                provider: document.llmConfig.provider,
                apiKey: document.llmConfig.apiKey,
                model: document.llmConfig.model
            },
            {
                url: document.mcpConfig.serverUrl ?? document.mcpConfig.url,
                apiKey: document.mcpConfig.apiKey
            },
            document.isActive
        );
    }

    async save(tenant: Tenant): Promise<void> {
        await this.collection.updateOne(
            { workspaceId: tenant.workspaceId },
            { $set: tenant },
            { upsert: true }
        );
    }
}