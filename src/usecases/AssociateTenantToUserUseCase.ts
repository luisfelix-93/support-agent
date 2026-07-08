import { IUserRepository } from '../domain/ports/IUserRepository.js';
import { ITenantRepository } from '../domain/ports/ITenantRepository.js';

interface AssociateTenantInput {
    userId: string;
    workspaceId: string;
}

export class AssociateTenantToUserUseCase {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly tenantRepository: ITenantRepository
    ) {}

    async execute(input: AssociateTenantInput): Promise<void> {
        const user = await this.userRepository.findById(input.userId);
        if (!user) {
            throw new Error(`User '${input.userId}' not found.`);
        }

        const tenant = await this.tenantRepository.findByWorkspaceId(input.workspaceId);
        if (!tenant) {
            throw new Error(`Tenant with workspaceId '${input.workspaceId}' not found.`);
        }

        await this.userRepository.updateTenantId(input.userId, input.workspaceId);
    }
}
