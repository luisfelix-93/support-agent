import { Collection } from "mongodb";
import { IChatRepository } from "../domain/ports/IChatRepository.js";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";

export class ChatRepository implements IChatRepository {
        private get collection(): Collection {
            return MongoConnection.getDb().collection("threads");
        }

        async findById(threadId: string, workspaceId: string): Promise<ChatContext> {
            const document = await this.collection.findOne({
                threadId,
                workspaceId
            });

            const context = new ChatContext(threadId, workspaceId);

            if (document && Array.isArray(document.messages)) {
                for (const msg of document.messages) {
                    context.addMessage(new Message(msg.id, msg.role, msg.content, new Date(msg.timestamp)));
                }
            }

            return context
        }
        async save(context: ChatContext): Promise<void> {
            const document = {
                threadId: context.threadID,
                workspaceId: context.workspaceId,
                updatedAt: new Date(),
                messages: context.messages.map((m: Message) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp
                }))
            };

            await this.collection.updateOne(
                { threadId: context.threadID, workspaceId: context.workspaceId },
                { $set: document },
                { upsert: true }
            );
        }
}