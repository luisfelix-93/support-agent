import type { Message } from "./Message.js";

export class ChatContext {
    constructor(
        public readonly threadID: string,
        public readonly workspaceId: string,
        public readonly messages: Message[] = []
    ){}

    addMessage(message: Message): void {
        this.messages.push(message)
    }

    // Aqui entrarão regras de negócio, como limitar o tamanho do histório
    // para economizar tokens, etc.
}