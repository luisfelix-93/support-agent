import type { Request, Response } from 'express';
import type { RegisterChatConfigUseCase } from '../usecases/RegisterChatConfigUseCase.js';
import type { GetChatConfigUseCase } from '../usecases/GetChatConfigUseCase.js';

export class ChatConfigController {
    constructor(
        private readonly registerUseCase: RegisterChatConfigUseCase,
        private readonly getUseCase: GetChatConfigUseCase
    ) {}

    async register(req: Request, res: Response): Promise<void> {
        try {
            const { workspaceId, provider, teamId, botToken, appToken, signingSecret } = req.body;

            if (!workspaceId || !teamId || !botToken || !signingSecret) {
                res.status(400).json({
                    error: 'Campos obrigatórios ausentes: workspaceId, teamId, botToken, signingSecret.',
                });
                return;
            }

            const config = await this.registerUseCase.execute({
                workspaceId,
                provider,
                teamId,
                botToken,
                appToken,
                signingSecret,
            });

            res.status(201).json({
                message: 'Configuração do Slack cadastrada com sucesso.',
                config: {
                    workspaceId: config.workspaceId,
                    provider: config.provider,
                    teamId: config.teamId,
                    isActive: config.isActive,
                    botTokenConfigured: true,
                    appTokenConfigured: !!config.appToken,
                    signingSecretConfigured: true,
                    updatedAt: config.updatedAt,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erro ao cadastrar ChatConfig.';
            res.status(500).json({ error: message });
        }
    }

    async getByWorkspaceId(req: Request, res: Response): Promise<void> {
        try {
            const rawWorkspaceId = req.params.workspaceId ?? req.query.workspaceId;
            const workspaceId = Array.isArray(rawWorkspaceId) ? rawWorkspaceId[0] : (rawWorkspaceId as string);

            if (!workspaceId || typeof workspaceId !== 'string') {
                res.status(400).json({ error: 'Parâmetro workspaceId é obrigatório.' });
                return;
            }

            const rawProvider = req.query.provider;
            const provider = typeof rawProvider === 'string' ? rawProvider : 'slack';
            const config = await this.getUseCase.execute(workspaceId, provider);

            if (!config) {
                res.status(404).json({ error: 'Configuração não encontrada para o workspaceId informado.' });
                return;
            }

            res.status(200).json({
                workspaceId: config.workspaceId,
                provider: config.provider,
                teamId: config.teamId,
                isActive: config.isActive,
                botTokenConfigured: true,
                appTokenConfigured: !!config.appToken,
                signingSecretConfigured: true,
                updatedAt: config.updatedAt,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erro ao buscar ChatConfig.';
            res.status(500).json({ error: message });
        }
    }
}
