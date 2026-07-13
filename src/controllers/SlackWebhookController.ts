import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { IQueueService } from '../domain/ports/IQueueService.js';

/**
 * Controla o webhook de eventos do Slack.
 *
 * Responsabilidades:
 *  1. Responder ao desafio de verificação de URL (url_verification).
 *  2. Validar a assinatura HMAC-SHA256 enviada pelo Slack em cada request.
 *  3. Despachar mensagens de usuário reais para a fila (QStash).
 *  4. Ignorar mensagens de bots para evitar loops.
 *
 * Referência: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export class SlackWebhookController {
    constructor(
        private readonly queueService: IQueueService,
        private readonly signingSecret: string
    ) {}

    async handle(req: Request, res: Response): Promise<Response> {
        const rawBody: string | undefined = (req as Request & { rawBody?: string }).rawBody;


        
        try {
            const payload = req.body;

            // ── 1. URL Verification Challenge ─────────────────────────────────
            // O Slack envia este evento quando o app é cadastrado pela primeira vez.
            if (payload.type === 'url_verification') {
                return res.status(200).json({ challenge: payload.challenge });
            }

            // ── 2. Verificação de assinatura ──────────────────────────────────
            // O rawBody deve ter sido capturado pelo middleware antes do express.json().
            const isValid = this.verifySignature(req, rawBody ?? '');
            if (!isValid) {
                console.warn('[SlackWebhookController] Assinatura inválida recebida.');
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
                    // O spaceId para o Slack é o channel; o threadId é "channel:thread_ts"
                    const spaceId = channel;
                    const threadId = `${channel}:${thread_ts}`;
                    const userText: string = event.text;

                    await this.queueService.dispatchMessageProcessing(spaceId, threadId, userText, 'slack');
                }
            }

            // Responde imediatamente (o Slack exige resposta em < 3 segundos)
            return res.status(200).send();
        } catch (error) {
            console.error('[SlackWebhookController] Erro ao processar evento:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Valida a assinatura do Slack usando HMAC-SHA256.
     * Docs: https://api.slack.com/authentication/verifying-requests-from-slack
     */
    private verifySignature(req: Request, rawBody: string): boolean {
        const slackSignature = req.headers['x-slack-signature'] as string | undefined;
        const slackTimestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

        if (!slackSignature || !slackTimestamp) {
            return false;
        }

        // Protege contra ataques de replay (rejeita requests com mais de 5 minutos)
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
        if (parseInt(slackTimestamp, 10) < fiveMinutesAgo) {
            console.warn('[SlackWebhookController] Request expirado (possível replay attack).');
            return false;
        }

        const sigBaseString = `v0:${slackTimestamp}:${rawBody}`;
        const computedSig =
            'v0=' +
            crypto
                .createHmac('sha256', this.signingSecret)
                .update(sigBaseString)
                .digest('hex');
        
        console.log('[DEBUG] Slack Signature:', slackSignature);
        console.log('[DEBUG] Computed Signature:', computedSig);
        console.log('[DEBUG] RawBody Length:', rawBody.length);
        console.log('[DEBUG] Secret Injetado Válido?', !!this.signingSecret);

        // Comparação segura para evitar timing attacks
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
