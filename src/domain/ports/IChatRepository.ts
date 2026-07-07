import type { ChatContext } from "../ChatContext";

export interface IChatRepository {
    //  Retorna o contexto da thread. Se não existir, retorna uma instancia nova/vazia
    findById(threadId: string, workspaceId: string): Promise<ChatContext>
    
    // Salva o contexto atual da thread (mensagens atualizadas)
    save(context: ChatContext): Promise<void>
}