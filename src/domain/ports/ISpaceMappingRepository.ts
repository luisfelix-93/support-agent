import type { SpaceMapping } from '../SpaceMapping';

export interface ISpaceMappingRepository {
    findBySpaceId(spaceId: string): Promise<SpaceMapping | null>;
    save(spaceMapping: SpaceMapping): Promise<void>;
}