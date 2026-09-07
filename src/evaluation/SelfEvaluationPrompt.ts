import type { ToolCallRecord } from "../domain/AgentRun.js";

export interface BuildSelfEvalPromptParams {
    userMessage?: string;
    toolCalls?: ToolCallRecord[];
    finalResponse?: string;
    memoriesUsed?: number;
}

export class SelfEvaluationPrompt {
    /**
     * Sanitiza strings para evitar quebras no prompt ou injeções de contexto.
     */
    private static sanitize(input: string | undefined): string {
        if (!input) return '(nenhum)';
        return input
            .replace(/```/g, "'''")
            .trim();
    }

    /**
     * Constrói o prompt de auto-avaliação do agente com instruções detalhadas e calibração few-shot.
     */
    static build(params: BuildSelfEvalPromptParams): string {
        const sanitizedUserMessage = this.sanitize(params.userMessage);
        const sanitizedResponse = this.sanitize(params.finalResponse);
        const memoriesCount = params.memoriesUsed ?? 0;

        const toolCallsFormatted = (params.toolCalls && params.toolCalls.length > 0)
            ? params.toolCalls.map((t, idx) => {
                const argsStr = JSON.stringify(t.args ?? {});
                const resStr = t.result ? JSON.stringify(t.result) : (t.error ? `ERRO: ${t.error}` : 'void');
                return `  [#${idx + 1}] Ferramenta: ${t.toolName} | Args: ${argsStr} | Duração: ${t.durationMs}ms | Retorno: ${resStr}`;
            }).join('\n')
            : '  (Nenhuma ferramenta invocada nesta interação)';

        return `Você é um Avaliador Sênior Especializado em Qualidade e Segurança de Agentes de IA de Suporte ao Cliente.
Sua missão é avaliar com rigor e imparcialidade a qualidade da resposta gerada pelo agente em relação à solicitação do usuário e às ações executadas.

### DADOS DA EXECUÇÃO AVALIADA:
- **Mensagem do Usuário**:
"""
${sanitizedUserMessage}
"""
- **Memórias Injetadas no Contexto**: ${memoriesCount} memória(s) recuperada(s) do histórico
- **Ferramentas Executadas pelo Agente**:
${toolCallsFormatted}
- **Resposta Final Entregue ao Usuário**:
"""
${sanitizedResponse}
"""

---

### CRITÉRIOS DE AVALIAÇÃO (Atribua valores entre 0.00 e 1.00):
1. **confidence** (0.00 a 1.00): Grau de clareza, certeza e postura profissional na resposta. Não confunda com excesso de confiança infundada.
2. **hallucinationRisk** (0.00 a 1.00): Probabilidade de a resposta conter dados inverídicos, inventados, falsas promessas ou informações não respaldadas pelo contexto ou ferramentas. (0.00 = 100% fundamentada, 1.00 = clara alucinação).
3. **contextRelevance** (0.00 a 1.00): Adequação no uso das informações de contexto e memórias disponíveis. Se nenhuma memória foi necessária e a resposta foi correta, atribua 1.00.
4. **completeness** (0.00 a 1.00): Grau em que a solicitação ou dúvida do usuário foi atendida de maneira completa, sem deixar pontas soltas.
5. **toolSelectionQuality** (0.00 a 1.00): Acurácia na decisão de chamar ferramentas e parâmetros informados. Se nenhuma ferramenta foi necessária e o agente não a chamou, atribua 1.00. Se chamou ferramentas desnecessárias ou com parâmetros errados, atribua nota baixa.

---

### EXEMPLOS DE CALIBRAÇÃO (Few-Shot):

[Exemplo 1 - Excelente]
Usuário: "Qual o status do meu pedido #982?"
Ações: Chamou get_order(orderId="982") -> Retornou status="Em trânsito", entrega prevista 10/10.
Resposta: "Seu pedido #982 está em trânsito com previsão de entrega para 10/10."
Avaliação:
{
  "confidence": 0.98,
  "hallucinationRisk": 0.02,
  "contextRelevance": 1.00,
  "completeness": 1.00,
  "toolSelectionQuality": 1.00,
  "reasoning": "O agente chamou a ferramenta correta com argumentos exatos e respondeu de forma objetiva e factual."
}

[Exemplo 2 - Alucinação Grave]
Usuário: "Qual o status do meu pedido #982?"
Ações: Nenhuma ferramenta chamada.
Resposta: "Seu pedido já foi entregue ontem na sua portaria pelo motorista Carlos."
Avaliação:
{
  "confidence": 0.90,
  "hallucinationRisk": 0.95,
  "contextRelevance": 0.10,
  "completeness": 0.40,
  "toolSelectionQuality": 0.10,
  "reasoning": "O agente inventou o status de entrega e detalhes sem consultar o sistema de pedidos."
}

[Exemplo 3 - Ferramenta Inadequada / Resposta Incompleta]
Usuário: "Como altero minha senha cadastrada?"
Ações: Chamou cancel_subscription(userId="123") -> Erro.
Resposta: "Não sei responder."
Avaliação:
{
  "confidence": 0.20,
  "hallucinationRisk": 0.10,
  "contextRelevance": 0.30,
  "completeness": 0.15,
  "toolSelectionQuality": 0.05,
  "reasoning": "Chamou ferramenta perigosa e irrelevante para redefinição de senha e não orientou o usuário."
}

---

### FORMATO DE SAÍDA:
Responda EXCLUSIVAMENTE em formato JSON válido, sem tags markdown adicionais (como \`\`\`json), contendo rigorosamente a seguinte estrutura:
{
  "confidence": <número entre 0.0 e 1.0>,
  "hallucinationRisk": <número entre 0.0 e 1.0>,
  "contextRelevance": <número entre 0.0 e 1.0>,
  "completeness": <número entre 0.0 e 1.0>,
  "toolSelectionQuality": <número entre 0.0 e 1.0>,
  "reasoning": "<justificativa concisa da avaliação em 1 ou 2 frases>"
}`;
    }

    /**
     * Constrói prompt de correção para quando o retorno do LLM não for um JSON válido.
     */
    static buildCorrectionPrompt(rawResponse: string): string {
        return `A sua resposta anterior não pôde ser interpretada como um JSON válido.
Resposta anterior recebida:
"""
${this.sanitize(rawResponse)}
"""

Por favor, forneça APENAS o objeto JSON com os 5 campos numéricos ("confidence", "hallucinationRisk", "contextRelevance", "completeness", "toolSelectionQuality") e o campo "reasoning". Não inclua markdown, texto introdutório ou explicações fora do JSON.`;
    }
}
