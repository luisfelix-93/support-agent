import crypto from "crypto";
import type { IMemoryExtractor, MemoryExtractionInput } from "../../domain/ports/IMemoryExtractor.js";
import type { Memory, MemoryType } from "../../domain/Memory.js";
import { ChatContext } from "../../domain/ChatContext.js";
import { Message } from "../../domain/Message.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: 'LLMMemoryExtractor' });

const EXTRACTION_SYSTEM_PROMPT = `Você é um extrator especialista de memórias para um agente de suporte técnico.
Sua missão é analisar o diálogo recente e extrair apenas informações de valor duradouro de longo prazo (fatos importantes, preferências do usuário, incidentes relatados, resoluções de problemas e conhecimentos técnicos específicos).

Regras:
1. Ignore mensagens triviais como saudações ("olá", "tudo bem"), despedidas ou perguntas contextuais efêmeras.
2. Cada memória deve ser uma afirmação clara, independente e concisa.
3. Classifique cada memória com um dos tipos: 'fact', 'preference', 'incident', 'resolution', 'knowledge', 'summary'.
4. Atribua um score de importância de 0.1 a 1.0 (ex: 0.9 para uma configuração de servidor ou preferência crítica, 0.5 para um detalhe secundário).
5. Responda ESTRITAMENTE em formato JSON com uma lista de objetos, sem formatação extra além do array JSON:
[
  {
    "type": "fact" | "preference" | "incident" | "resolution" | "knowledge" | "summary",
    "content": "descrição concisa da memória",
    "importance": 0.8
  }
]
Se nenhuma informação for relevante para longo prazo, retorne um array vazio: []`;

export class LLMMemoryExtractor implements IMemoryExtractor {
    async extract(input: MemoryExtractionInput): Promise<Memory[]> {
        if (!input.messages || input.messages.length === 0) {
            return [];
        }

        try {
            const formattedHistory = input.messages
                .map(m => `${m.role.toUpperCase()}: ${m.content}`)
                .join('\n');

            const extractionContext = new ChatContext(
                input.threadId,
                input.workspaceId,
                [
                    new Message(crypto.randomUUID(), 'system', EXTRACTION_SYSTEM_PROMPT),
                    new Message(
                        crypto.randomUUID(),
                        'user',
                        `Analise o diálogo abaixo e extraia as memórias de longo prazo:\n\n${formattedHistory}`
                    )
                ]
            );

            const response = await input.llmProvider.generateResponse(extractionContext, []);
            if (response.type !== 'text' || !response.content) {
                return [];
            }

            const rawText = response.content.trim();
            const jsonText = this.cleanJsonResponse(rawText);
            const parsed = JSON.parse(jsonText);

            if (!Array.isArray(parsed)) {
                log.warn({ rawText }, 'Resposta do LLM para extração de memória não é um array.');
                return [];
            }

            const validTypes = new Set<MemoryType>([
                'fact',
                'preference',
                'incident',
                'resolution',
                'knowledge',
                'summary'
            ]);

            const memories: Memory[] = [];
            const now = new Date();

            for (const item of parsed) {
                if (!item || typeof item.content !== 'string' || !item.content.trim()) {
                    continue;
                }

                const type: MemoryType = validTypes.has(item.type) ? item.type : 'fact';
                const importance = typeof item.importance === 'number'
                    ? Math.max(0.1, Math.min(1.0, item.importance))
                    : 0.5;

                memories.push({
                    id: crypto.randomUUID(),
                    tenantId: input.tenantId,
                    workspaceId: input.workspaceId,
                    threadId: input.threadId,
                    type,
                    content: item.content.trim(),
                    importance,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            log.info({ count: memories.length, threadId: input.threadId }, 'Memórias extraídas com sucesso.');
            return memories;
        } catch (error) {
            log.error({ err: error, threadId: input.threadId }, 'Erro ao extrair memórias via LLM.');
            return [];
        }
    }

    private cleanJsonResponse(text: string): string {
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        return cleaned.trim();
    }
}
