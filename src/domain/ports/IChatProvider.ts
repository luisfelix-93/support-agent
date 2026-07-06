export interface IChatProvider {
    sendMessage(threadId: string, content: string): Promise<void>
}