import type { ChatConfig } from '../ChatConfig.js';

export interface IChatConfigRepository {
    findByWorkspaceId(workspaceId: string, provider?: string): Promise<ChatConfig | null>;
    findByTeamId(teamId: string): Promise<ChatConfig | null>;
    save(config: ChatConfig): Promise<void>;
    delete(workspaceId: string, provider?: string): Promise<void>;
}
