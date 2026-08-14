import type { ChatConfig } from '../domain/ChatConfig.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';

export class GetChatConfigUseCase {
    constructor(private readonly chatConfigRepository: IChatConfigRepository) {}

    async execute(workspaceId: string, provider: string = 'slack'): Promise<ChatConfig | null> {
        if (!workspaceId || workspaceId.trim() === '') {
            throw new Error('[GetChatConfigUseCase] workspaceId é obrigatório.');
        }

        return this.chatConfigRepository.findByWorkspaceId(workspaceId, provider);
    }
}
