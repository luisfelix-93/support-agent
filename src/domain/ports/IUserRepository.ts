import type { User } from '../User.js';

export interface IUserRepository {
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    save(user: User): Promise<void>;
    addWorkspaceId(userId: string, workspaceId: string): Promise<void>;
}
