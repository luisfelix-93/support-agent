import { GoogleAuth } from "google-auth-library";
import type { IChatProvider } from "../../domain/ports/IChatProvider.js";

export class GoogleChatAdapter implements IChatProvider {
    private auth: GoogleAuth;
    private readonly chatScope = 'https://www.googleapis.com/auth/chat.messages.create'
    constructor(){
        this.auth = new GoogleAuth({
            scopes: this.chatScope
        });
    }

    async sendMessage(threadId: string, content: string): Promise<void> {
         // No GoogleChat, o threadId já costuma vir no formato completo: "spaces/AAAAxxxx/threads/YYYYyyyy"
         // na rota da API para criar mensagens em uma thread específica é:
         // https://chat.googleapis.com/v1/{threadId}/messages
         const url = `https://chat.googleapis.com/v1/${threadId}/messages?messageReplyOption=REPLY_MESSAGE_OR_FAIL`;

         try {
            const accessToken = await this.getAccessToken();
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization' : `Bearer ${accessToken}`,
                    'Content-Type' : 'application/json'
                },
                body: JSON.stringify({
                    text: content,
                    thread: {
                        name: threadId
                    }
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erro na API do Google Chat: ${response.status} - ${errorText}`);
            }
            console.log('[Google Chat] Resposta enviada com sucesso para a thread: ', threadId);
         } catch (error) {
            console.error('[Google Chat] Falha ao enviar mensagem ativa:', error);
            throw error;
         }
    }

    private async getAccessToken(): Promise<string> {
        const client = await this.auth.getClient();
        const tokenResponse = await client.getAccessToken();

        if (!tokenResponse.token) {
            throw new Error('Não foi possível gerar o Token de acesso do Google Cloud')
        }

        return tokenResponse.token
    }
}