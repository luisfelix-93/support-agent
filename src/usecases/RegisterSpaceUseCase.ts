import { ISpaceMappingRepository } from '../domain/ports/ISpaceMappingRepository.js';
import { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { SpaceMapping } from '../domain/SpaceMapping.js';

interface RegisterSpaceInput {
    spaceId: string;
    workspaceId: string;
}

export class RegisterSpaceUseCase {
    constructor(
        private readonly spaceMappingRepository: ISpaceMappingRepository,
        private readonly tenantRepository: ITenantRepository
    ) {}

    async execute(input: RegisterSpaceInput): Promise<{ spaceId: string }> {
        const tenant = await this.tenantRepository.findByWorkspaceId(input.workspaceId);
        if (!tenant) {
            throw new Error(`Tenant with workspaceId '${input.workspaceId}' not found.`);
        }

        const mapping = new SpaceMapping(input.spaceId, input.workspaceId);
        await this.spaceMappingRepository.save(mapping);

        return { spaceId: mapping.spaceId };
    }
}
