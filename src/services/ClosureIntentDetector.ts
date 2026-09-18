export type ClosureIntent = 'CONFIRM_CLOSURE' | 'REJECT_CLOSURE' | 'NEUTRAL';

export class ClosureIntentDetector {
    private readonly explicitCommands = new Set([
        '/encerrar',
        '/close',
        '/finalizar',
        '/encerrar-sessao',
        '/concluir',
    ]);

    private readonly explicitPhrases = [
        'pode encerrar',
        'encerrar sessao',
        'fechar sessao',
        'fechar chamado',
        'analise concluida',
        'problema resolvido',
        'incidente resolvido',
        'incidente finalizado',
        'encerrar investigacao',
        'concluir analise',
    ];

    private readonly affirmativeTokens = new Set([
        'sim',
        'yes',
        's',
        'ok',
        'pode ser',
        'isso mesmo',
        'com certeza',
        'fechado',
        'confirmo',
        'pode fechar',
        'tudo certo',
        'concluido',
        'pode gerar o resumo',
    ]);

    private readonly negativePatterns = [
        'nao',
        'no',
        'ainda nao',
        'espere',
        'espera',
        'nao encerre',
        'quero continuar',
        'continuar investigando',
        'continuar',
        'tenho outra duvida',
        'mais uma pergunta',
        'preciso analisar',
    ];

    detectIntent(message: string, isAwaitingConfirmation: boolean = false): ClosureIntent {
        if (!message || message.trim() === '') {
            return 'NEUTRAL';
        }

        const normalized = this.normalize(message);

        // 1. Verifica comandos explícitos (ex: /encerrar)
        if (this.explicitCommands.has(normalized)) {
            return 'CONFIRM_CLOSURE';
        }

        // 2. Verifica frases explícitas de encerramento em qualquer contexto
        for (const phrase of this.explicitPhrases) {
            if (normalized.includes(phrase)) {
                return 'CONFIRM_CLOSURE';
            }
        }

        // 3. Se a sessão estiver aguardando confirmação do operador
        if (isAwaitingConfirmation) {
            // Checa afirmação direta
            if (this.affirmativeTokens.has(normalized)) {
                return 'CONFIRM_CLOSURE';
            }

            // Checa negação ou intenção explícita de continuação
            for (const pattern of this.negativePatterns) {
                if (normalized.includes(pattern)) {
                    return 'REJECT_CLOSURE';
                }
            }

            // Se o usuário fez uma pergunta ou deu um novo comando longo de investigação
            if (normalized.includes('?') || normalized.startsWith('verifique') || normalized.startsWith('e como')) {
                return 'REJECT_CLOSURE';
            }
        }

        return 'NEUTRAL';
    }

    private normalize(text: string): string {
        return text
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[.,!?:;]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
