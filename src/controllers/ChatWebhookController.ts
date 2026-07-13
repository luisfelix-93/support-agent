import type { Request, Response } from "express";
import type { IQueueService } from "../domain/ports/IQueueService.js";



export class ChatWebhookController {
    constructor(private readonly queueService: IQueueService) {}

    async handle(req: Request, res: Response): Promise<Response> {
        const url = process.env.FRONTEND_URL || 'http://localhost:5173';
        try {
            const payload = req.body;

            // O Google Chat envia um evento do tipo 'ADD_TO_SPACE' na instalação
            // e 'MESSAGE' quando um usuário envia um textol

            if (payload.type === 'ADD_TO_SPACE') {
                const spaceId = payload.space.name; 
                const setupUrl = `${url}/integrations/google-chat/setup?spaceId=${encodeURIComponent(spaceId)}`
                return res.status(200).json({ text: `Olá! Sou o Support Agent. Para me ativar neste espaço, por favor, vincule-o à sua conta clicando aqui: ${setupUrl}` });
            }

            if (payload.type === 'MESSAGE') {
                const spaceId = payload.space.name; // ID do espaço ou sala
                const threadId = payload.message.thread?.name || payload.message.name;
                const userText = payload.message.text;

                // Despacha para o processamento assíncrono (QStash)
                await this.queueService.dispatchMessageProcessing(spaceId, threadId, userText, 'google');

                //Retorna imediatamente para o Google Chat
                return res.status(200).send();
            }
            return res.status(200).send();
        } catch (error) {
            console.error('[ChatWebhookController] Erro ao processar webhook:', error);     
            return res.status(500).json({ error: error })    
        }
    }
}