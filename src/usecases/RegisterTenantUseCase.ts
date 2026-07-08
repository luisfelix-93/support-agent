import { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { Tenant } from '../domain/Tenant.js';
import { LLMConfig } from '../domain/LLMConfig.js';
import { MCPConfig } from '../domain/Tenant.js';

interface RegisterTenantInput {
    workspaceId: string;
    llmConfig: LLMConfig;
    mcpConfig: MCPConfig;
}

export class RegisterTenantUseCase {
    constructor(private readonly tenantRepository: ITenantRepository) {}

    async execute(input: RegisterTenantInput): Promise<{ workspaceId: string }> {
        const existing = await this.tenantRepository.findByWorkspaceId(input.workspaceId);
        if (existing) {
            throw new Error(`Tenant with workspaceId '${input.workspaceId}' already exists.`);
        }

        const tenant = new Tenant(
            input.workspaceId,
            input.llmConfig,
            input.mcpConfig,
            true
        );

        await this.tenantRepository.save(tenant);
        return { workspaceId: tenant.workspaceId };
    }
}
