import crypto from "crypto";
import type { Request, Response } from "express";
import type { IQueueService } from "../domain/ports/IQueueService.js";
import type { IdempotencyGuard } from "../infrastructure/resilience/IdempotencyGuard.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'ChatWebhookController' });

export class ChatWebhookController {
    constructor(
        private readonly queueService: IQueueService,
        private readonly idempotencyGuard?: IdempotencyGuard
    ) {}

    async handle(req: Request, res: Response): Promise<Response> {
        const url = process.env.FRONTEND_URL || 'http://localhost:5173';
        try {
            const payload = req.body;

            // O Google Chat envia um evento do tipo 'ADD_TO_SPACE' na instalação
            // e 'MESSAGE' quando um usuário envia um texto
            if (payload.type === 'ADD_TO_SPACE') {
                const spaceId = payload.space.name; 
                const setupUrl = `${url}/integrations/google-chat/setup?spaceId=${encodeURIComponent(spaceId)}`;
                return res.status(200).json({ text: `Olá! Sou o Support Agent. Para me ativar neste espaço, por favor, vincule-o à sua conta clicando aqui: ${setupUrl}` });
            }

            if (payload.type === 'MESSAGE') {
                const spaceId = payload.space.name; // ID do espaço ou sala
                const threadId = payload.message.thread?.name || payload.message.name;
                const messageId = payload.message.name || threadId;
                const userText = payload.message.text || '';

                // Verificação de idempotência para evitar processamento duplicado
                if (this.idempotencyGuard) {
                    const idempotencyKey = crypto
                        .createHash('sha256')
                        .update(`${spaceId}:${messageId}:${userText}`)
                        .digest('hex');

                    const isDuplicate = await this.idempotencyGuard.isDuplicate(idempotencyKey);
                    if (isDuplicate) {
                        log.info({ spaceId, threadId, idempotencyKey }, 'Mensagem duplicada detectada e ignorada silenciosamente.');
                        return res.status(200).send();
                    }
                }

                // Despacha para o processamento assíncrono
                await this.queueService.dispatchMessageProcessing(spaceId, threadId, userText, 'google');

                // Retorna imediatamente para o Google Chat
                return res.status(200).send();
            }
            return res.status(200).send();
        } catch (error) {
            log.error({ err: error }, 'Erro ao processar webhook do Google Chat');     
            return res.status(500).json({ error: error });    
        }
    }
}