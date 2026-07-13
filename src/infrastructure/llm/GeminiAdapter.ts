import { GoogleGenAI, type Content, type Tool } from "@google/genai";
import type { ILLMProvider, LLMResponse } from "../../domain/ports/ILLMProvider.js";
import type { ChatContext } from "../../domain/ChatContext.js";
import { ToolCall } from "../../domain/ToolCall.js";

export class GeminiAdapter implements ILLMProvider {
    private client: GoogleGenAI;

    constructor(private apiKey: string, private model: string) {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }

    async generateResponse(context: ChatContext, tools?: any[]): Promise<LLMResponse> {
        // 1. Separar system instruction das demais mensagens
        const systemParts = context.messages
            .filter(m => m.role === "system")
            .map(m => m.content)
            .join("\n");

        // 2. Traduzir mensagens do domínio para o formato Gemini (Contents)
        const contents: Content[] = context.messages
            .filter(m => m.role !== "system")
            .map(msg => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
            }));

        // 3. Definir ferramentas disponíveis dinamicamente
        const geminiTools: Tool[] = tools && tools.length > 0 ? [
            {
                functionDeclarations: tools.map((t: any) => ({
                    name: t.name,
                    description: t.description || "",
                    parameters: t.inputSchema || { type: "object" }
                }))
            }
        ] : [];

        // 4. Chamar a API do Gemini
        const response = await this.client.models.generateContent({
            model: this.model,
            contents,
            config: {
                systemInstruction: systemParts || undefined,
                tools: geminiTools.length > 0 ? geminiTools : undefined,
            },
        });

        // 5. Verificar se o modelo pediu para chamar uma ferramenta
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        const functionCallPart = parts.find(p => p.functionCall != null);
        if (functionCallPart?.functionCall) {
            const fc = functionCallPart.functionCall;
            return {
                type: "tool_call",
                tool: new ToolCall(fc.name ?? "", (fc.args as Record<string, any>) ?? {}),
            };
        }

        // 6. Retornar resposta textual
        const textPart = parts.find(p => typeof p.text === "string");
        return {
            type: "text",
            content: textPart?.text ?? "",
        };
    }
}
