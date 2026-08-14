import type { IChatProvider } from '../../domain/ports/IChatProvider.js';
import type { IChatConfigRepository } from '../../domain/ports/IChatConfigRepository.js';
import { SlackChatAdapter } from './SlackChatAdapter.js';
import { GoogleChatAdapter } from './GoogleChatAdapter.js';
import { logger } from '../../config/logger.js';

const log = logger.child({ module: 'ChatProviderFactory' });

export class ChatProviderFactory {
    constructor(
        private readonly chatConfigRepository: IChatConfigRepository,
        private readonly fallbackSlackToken?: string
    ) {}

    async getProvider(workspaceId: string, source: string): Promise<IChatProvider> {
        if (source === 'google') {
            return new GoogleChatAdapter();
        }

        if (source === 'slack') {
            const chatConfig = await this.chatConfigRepository.findByWorkspaceId(workspaceId, 'slack');

            if (chatConfig && chatConfig.botToken) {
                log.info({ workspaceId }, 'Instanciando SlackChatAdapter com botToken do banco de dados.');
                return new SlackChatAdapter(chatConfig.botToken);
            }

            if (this.fallbackSlackToken) {
                log.info({ workspaceId }, 'Usando fallback SLACK_BOT_TOKEN das variáveis de ambiente.');
                return new SlackChatAdapter(this.fallbackSlackToken);
            }

            throw new Error(
                `[ChatProviderFactory] Nenhuma configuração de bot do Slack encontrada para o workspaceId: ${workspaceId}`
            );
        }

        throw new Error(`[ChatProviderFactory] Provedor de chat não suportado: ${source}`);
    }
}
