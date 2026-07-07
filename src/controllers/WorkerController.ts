import type { Request, Response } from "express";
import type { ProcessAgentResponseUse } from "../usecases/ProcessAgentResponseUseCase.js";
import { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";

export class WorkerController {
    constructor(private readonly processUsecase: ProcessAgentResponseUse) {}

    async handler(req: Request, res: Response): Promise<Response> {
        try {
            // O QStash nos enviará de volta aos dados que despachamos no webhook
            const { workspaceId, threadId, text } = req.body;

            // Inicia a orquestração (LLM -> MCP -> LLM -> Google Chat)
            await this.processUsecase.execute(workspaceId, threadId, text);
            return res.status(200).json({ success: true })
        } catch (error) {
            console.error('[WorkerController] Erro no processamento assíncrono: ', error);
            // Se retornar 500, o QStash tentará rodar o worker novamente (Retry Policy)
            return res.status(500).json({ error: 'Falha no processamento' });
        }
    }
}