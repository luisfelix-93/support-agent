import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { IQueueService } from '../domain/ports/IQueueService.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'SlackWebhookController' });

/**
 * Controla o webhook de eventos do Slack.
 *
 * Responsabilidades:
 *  1. Responder ao desafio de verificação de URL (url_verification).
 *  2. Validar a assinatura HMAC-SHA256 enviada pelo Slack em cada request (buscando signingSecret do banco se disponível).
 *  3. Despachar mensagens de usuário reais para a fila.
 *  4. Ignorar mensagens de bots para evitar loops.
 *
 * Referência: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export class SlackWebhookController {
    constructor(
        private readonly queueService: IQueueService,
        private readonly defaultSigningSecret?: string,
        private readonly chatConfigRepository?: IChatConfigRepository
    ) {}

    async handle(req: Request, res: Response): Promise<Response> {
        const rawBody: string | undefined = (req as Request & { rawBody?: string }).rawBody;

        try {
            const payload = req.body;

            // ── 1. URL Verification Challenge ─────────────────────────────────
            if (payload.type === 'url_verification') {
                return res.status(200).json({ challenge: payload.challenge });
            }

            // ── 2. Verificação de assinatura ──────────────────────────────────
            const teamId = payload.team_id ?? payload.event?.team;
            const signingSecret = await this.resolveSigningSecret(teamId);

            if (!signingSecret) {
                log.warn({ teamId }, 'Nenhum signingSecret encontrado para validar o webhook do Slack.');
                return res.status(401).json({ error: 'Signing secret not configured' });
            }

            const isValid = this.verifySignature(req, rawBody ?? '', signingSecret);
            if (!isValid) {
                log.warn('Assinatura inválida recebida.');
                return res.status(401).json({ error: 'Invalid signature' });
            }

            // ── 3. Eventos de callback ─────────────────────────────────────────
            if (payload.type === 'event_callback') {
                const event = payload.event;

                // Ignora mensagens de bots (incluindo o próprio app) para evitar loops
                if (event.bot_id || event.subtype === 'bot_message') {
                    return res.status(200).send();
                }

                // Processa apenas eventos do tipo "message" com texto
                if (event.type === 'message' && event.text) {
                    const channel: string = event.channel;
                    const thread_ts: string = event.thread_ts ?? event.ts;
                    const spaceId = channel;
                    const threadId = `${channel}:${thread_ts}`;
                    const userText: string = event.text;

                    await this.queueService.dispatchMessageProcessing(spaceId, threadId, userText, 'slack');
                }
            }

            return res.status(200).send();
        } catch (error) {
            log.error({ err: error }, 'Erro ao processar evento do Slack');
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    private async resolveSigningSecret(teamId?: string): Promise<string | undefined> {
        if (teamId && this.chatConfigRepository) {
            const config = await this.chatConfigRepository.findByTeamId(teamId);
            if (config?.signingSecret) {
                return config.signingSecret;
            }
        }
        return this.defaultSigningSecret;
    }

    /**
     * Valida a assinatura do Slack usando HMAC-SHA256.
     */
    private verifySignature(req: Request, rawBody: string, signingSecret: string): boolean {
        const slackSignature = req.headers['x-slack-signature'] as string | undefined;
        const slackTimestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

        if (!slackSignature || !slackTimestamp) {
            return false;
        }

        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
        if (parseInt(slackTimestamp, 10) < fiveMinutesAgo) {
            log.warn('Request expirado (possível replay attack).');
            return false;
        }

        const sigBaseString = `v0:${slackTimestamp}:${rawBody}`;
        const computedSig =
            'v0=' +
            crypto
                .createHmac('sha256', signingSecret)
                .update(sigBaseString)
                .digest('hex');

        try {
            return crypto.timingSafeEqual(
                Buffer.from(computedSig, 'utf-8'),
                Buffer.from(slackSignature, 'utf-8')
            );
        } catch {
            return false;
        }
    }
}

