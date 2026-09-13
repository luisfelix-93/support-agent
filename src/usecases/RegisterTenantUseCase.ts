import { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { Tenant, type MCPServerConfig, type MCPConfig } from '../domain/Tenant.js';
import type { LLMConfig } from '../domain/LLMConfig.js';

export interface RegisterTenantInput {
    workspaceId: string;
    llmConfig: LLMConfig;
    mcpConfig?: MCPConfig;
    mcpServers?: MCPServerConfig[];
}

export class RegisterTenantUseCase {
    constructor(private readonly tenantRepository: ITenantRepository) {}

    async execute(input: RegisterTenantInput): Promise<{ workspaceId: string }> {
        if (!input.workspaceId || typeof input.workspaceId !== 'string' || input.workspaceId.trim() === '') {
            throw new Error('O campo "workspaceId" é obrigatório.');
        }

        if (!input.llmConfig) {
            throw new Error('O campo "llmConfig" é obrigatório.');
        }

        const hasMcpConfig = !!(input.mcpConfig && input.mcpConfig.url);
        const hasMcpServers = !!(Array.isArray(input.mcpServers) && input.mcpServers.length > 0);

        if (!hasMcpConfig && !hasMcpServers) {
            throw new Error('Pelo menos uma configuração MCP ("mcpConfig" ou "mcpServers") deve ser informada.');
        }

        // Validação de integridade para mcpServers
        if (hasMcpServers) {
            const seenIds = new Set<string>();
            for (const server of input.mcpServers!) {
                if (!server.id || typeof server.id !== 'string' || server.id.trim() === '') {
                    throw new Error('Todo servidor em "mcpServers" deve possuir um "id" válido.');
                }
                const cleanId = server.id.trim();
                if (seenIds.has(cleanId)) {
                    throw new Error(`ID de servidor duplicado em "mcpServers": "${cleanId}".`);
                }
                seenIds.add(cleanId);

                if (!server.url || typeof server.url !== 'string' || server.url.trim() === '') {
                    throw new Error(`Servidor "${cleanId}" deve possuir uma "url" válida.`);
                }
            }
        }

        const existing = await this.tenantRepository.findByWorkspaceId(input.workspaceId);
        if (existing) {
            throw new Error(`Tenant with workspaceId '${input.workspaceId}' already exists.`);
        }

        const effectiveMcpConfig: MCPConfig = input.mcpConfig ?? {
            url: input.mcpServers![0].url,
            apiKey: input.mcpServers![0].apiKey ?? '',
        };

        const tenant = new Tenant(
            input.workspaceId,
            input.llmConfig,
            effectiveMcpConfig,
            true,
            input.mcpServers
        );

        await this.tenantRepository.save(tenant);
        return { workspaceId: tenant.workspaceId };
    }
}
