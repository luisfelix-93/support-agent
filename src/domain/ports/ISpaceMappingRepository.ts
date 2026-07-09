import type { SpaceMapping } from '../SpaceMapping.js';

export interface ISpaceMappingRepository {
    findBySpaceId(spaceId: string): Promise<SpaceMapping | null>;
    save(spaceMapping: SpaceMapping): Promise<void>;
}