import { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { SpaceMapping } from "../domain/SpaceMapping.js";
import { ISpaceMappingRepository } from "../domain/ports/ISpaceMappingRepository.js";

export class SpaceMappingRepository implements ISpaceMappingRepository {
    private get collection(): Collection {
        return MongoConnection.getDb().collection('space_mappings')
    }

    async findBySpaceId(spaceId: string): Promise<SpaceMapping | null> {
        const document = await this.collection.findOne({ spaceId })
        if (!document) return null

        return new SpaceMapping(
            document.spaceId,
            document.workspaceId,
            document.createdAt ? new Date(document.createdAt) : new Date()
        )   
    }

    async save(mapping: SpaceMapping): Promise<void> {
        await this.collection.updateOne(
            { spaceId: mapping.spaceId },
            { 
                $set: {
                    spaceId: mapping.spaceId,
                    workspaceId: mapping.workspaceId,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: mapping.createdAt || new Date()
                }
            },
            { upsert: true }
        );
    }
}