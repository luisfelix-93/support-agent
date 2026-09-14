import { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { Tenant, type MCPServerConfig } from "../domain/Tenant.js";
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

        // 1. Trata servidores na nova lista multi-MCP (mcpServers)
        let decryptedServers: MCPServerConfig[] = [];
        if (Array.isArray(document.mcpServers) && document.mcpServers.length > 0) {
            decryptedServers = document.mcpServers.map((server: any) => ({
                id: server.id,
                name: server.name ?? server.id,
                url: server.url,
                apiKey: this.decryptApiKey(server.apiKey ?? ''),
                domains: Array.isArray(server.domains) ? server.domains : undefined,
                timeoutMs: server.timeoutMs,
                enabled: server.enabled !== false,
            }));
        }

        // 2. Trata configuração legada (mcpConfig) para retrocompatibilidade
        const rawLegacyApiKey = document.mcpConfig?.apiKey ?? '';
        const decryptedLegacyApiKey = this.decryptApiKey(rawLegacyApiKey);
        const legacyUrl = document.mcpConfig?.serverUrl ?? document.mcpConfig?.url ?? '';

        // Se não havia lista explícita de servidores, mas há configuração legada, promove-a a servidor default
        if (decryptedServers.length === 0 && legacyUrl) {
            decryptedServers = [{
                id: 'default',
                name: 'Default MCP Server',
                url: legacyUrl,
                apiKey: decryptedLegacyApiKey,
                enabled: true
            }];
        }

        const effectiveLegacyUrl = legacyUrl || (decryptedServers[0]?.url ?? '');
        const effectiveLegacyApiKey = decryptedLegacyApiKey || (decryptedServers[0]?.apiKey ?? '');

        return new Tenant(
            document.workspaceId,
            {
                provider: document.llmConfig.provider,
                apiKey: document.llmConfig.apiKey,
                model: document.llmConfig.model
            },
            {
                url: effectiveLegacyUrl,
                apiKey: effectiveLegacyApiKey
            },
            document.isActive,
            decryptedServers
        );
    }

    async findByWorkspaceIdSafe(workspaceId: string): Promise<Tenant | null> {
        const tenant = await this.findByWorkspaceId(workspaceId);
        if (!tenant) return null;

        const maskedServers: MCPServerConfig[] = (tenant.mcpServers ?? []).map(server => ({
            ...server,
            apiKey: this.maskApiKey(server.apiKey ?? '')
        }));

        return new Tenant(
            tenant.workspaceId,
            tenant.llmConfig,
            {
                ...tenant.mcpConfig,
                apiKey: this.maskApiKey(tenant.mcpConfig?.apiKey ?? '')
            },
            tenant.isActive,
            maskedServers
        );
    }

    async save(tenant: Tenant): Promise<void> {
        // Criptografa as API keys de todos os servidores na lista mcpServers
        const encryptedServers: MCPServerConfig[] = (tenant.mcpServers ?? []).map(server => {
            const rawKey = server.apiKey ?? '';
            return {
                ...server,
                apiKey: rawKey ? this.encryptionService.encrypt(rawKey, 'mcp') : ''
            };
        });

        // Garante que o campo legado mcpConfig também seja persistido de forma criptografada
        const primaryServer = tenant.mcpServers?.[0];
        const legacyUrl = tenant.mcpConfig?.url || primaryServer?.url || '';
        const rawLegacyKey = tenant.mcpConfig?.apiKey || primaryServer?.apiKey || '';
        const encryptedLegacyApiKey = rawLegacyKey
            ? this.encryptionService.encrypt(rawLegacyKey, 'mcp')
            : '';

        const documentToSave = {
            workspaceId: tenant.workspaceId,
            llmConfig: tenant.llmConfig,
            mcpConfig: {
                url: legacyUrl,
                apiKey: encryptedLegacyApiKey,
            },
            mcpServers: encryptedServers,
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