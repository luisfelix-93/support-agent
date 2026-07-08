import { randomUUID } from 'crypto';
import { Collection } from 'mongodb';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { IUserRepository } from '../domain/ports/IUserRepository.js';
import { User } from '../domain/User.js';
import { Password } from '../domain/Password.js';

export class UserRepository implements IUserRepository {
    private get collection(): Collection {
        return MongoConnection.getDb().collection('users');
    }

    async findById(id: string): Promise<User | null> {
        const doc = await this.collection.findOne({ id });
        if (!doc) return null;
        return this.toUser(doc);
    }

    async findByEmail(email: string): Promise<User | null> {
        const doc = await this.collection.findOne({ email });
        if (!doc) return null;
        return this.toUser(doc);
    }

    async save(user: User): Promise<void> {
        await this.collection.updateOne(
            { id: user.id },
            {
                $set: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    password: user.password.getValue(),
                    tenantId: user.tenantId ?? null,
                    role: user.role,
                    updatedAt: user.updatedAt,
                },
                $setOnInsert: {
                    createdAt: user.createdAt,
                },
            },
            { upsert: true }
        );
    }

    async updateTenantId(userId: string, tenantId: string): Promise<void> {
        await this.collection.updateOne(
            { id: userId },
            { $set: { tenantId, updatedAt: new Date() } }
        );
    }

    private toUser(doc: Record<string, any>): User {
        return new User(
            doc.id ?? randomUUID(),
            doc.name,
            doc.email,
            Password.restore(doc.password),
            doc.tenantId ?? undefined,
            doc.role,
            new Date(doc.createdAt),
            new Date(doc.updatedAt)
        );
    }
}
