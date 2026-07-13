import type { Request, Response } from "express";
import type { ProcessAgentResponseUse } from "../usecases/ProcessAgentResponseUseCase.js";
import type { IChatProvider } from "../domain/ports/IChatProvider.js";

export class WorkerController {
    constructor(
        private readonly processUsecase: ProcessAgentResponseUse,
        private readonly chatProviders: Record<string, IChatProvider>
    ) {}

    async handler(req: Request, res: Response): Promise<Response> {
        try {
            // O QStash nos enviará de volta aos dados que despachamos no webhook
            const { workspaceId, threadId, text, source } = req.body;

            // Resolve o chat provider correto com base na origem da mensagem
            const chatProvider = this.chatProviders[source];
            if (!chatProvider) {
                console.error(`[WorkerController] Chat provider desconhecido: ${source}`);
                return res.status(400).json({ error: `Chat provider desconhecido: ${source}` });
            }

            // Inicia a orquestração (LLM -> MCP -> LLM -> Chat)
            await this.processUsecase.execute(workspaceId, threadId, text, chatProvider);
            return res.status(200).json({ success: true })
        } catch (error) {
            console.error('[WorkerController] Erro no processamento assíncrono: ', error);
            // Se retornar 500, o QStash tentará rodar o worker novamente (Retry Policy)
            return res.status(500).json({ error: 'Falha no processamento' });
        }
    }
}