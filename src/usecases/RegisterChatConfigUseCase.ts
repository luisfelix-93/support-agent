import { ChatConfig } from '../domain/ChatConfig.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';

export interface RegisterChatConfigDTO {
    workspaceId: string;
    provider?: string;
    teamId: string;
    botToken: string;
    appToken?: string;
    signingSecret: string;
}

export class RegisterChatConfigUseCase {
    constructor(private readonly chatConfigRepository: IChatConfigRepository) {}

    async execute(dto: RegisterChatConfigDTO): Promise<ChatConfig> {
        const config = new ChatConfig({
            workspaceId: dto.workspaceId,
            provider: dto.provider,
            teamId: dto.teamId,
            botToken: dto.botToken,
            appToken: dto.appToken,
            signingSecret: dto.signingSecret,
        });

        await this.chatConfigRepository.save(config);
        return config;
    }
}
