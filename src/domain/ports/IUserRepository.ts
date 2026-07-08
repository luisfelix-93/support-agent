import type { User } from '../User.js';

export interface IUserRepository {
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    save(user: User): Promise<void>;
    updateTenantId(userId: string, tenantId: string): Promise<void>;
}
