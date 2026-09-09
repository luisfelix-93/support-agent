import type { IInvestigationPlaybook } from "./IInvestigationPlaybook.js";
import type { ChatContext } from "../ChatContext.js";

export class PlaybookRegistry {
    private readonly playbooks = new Map<string, IInvestigationPlaybook>();

    register(playbook: IInvestigationPlaybook): void {
        if (!playbook || !playbook.id) {
            throw new Error('Playbook inválido ou sem identificador id.');
        }
        this.playbooks.set(playbook.id, playbook);
    }

    get(id: string): IInvestigationPlaybook | undefined {
        return this.playbooks.get(id);
    }

    has(id: string): boolean {
        return this.playbooks.has(id);
    }

    getAll(): IInvestigationPlaybook[] {
        return Array.from(this.playbooks.values());
    }

    findMatchingPlaybooks(userMessage: string, context?: ChatContext): IInvestigationPlaybook[] {
        const matches: IInvestigationPlaybook[] = [];
        for (const playbook of this.playbooks.values()) {
            try {
                if (playbook.matches(userMessage, context)) {
                    matches.push(playbook);
                }
            } catch {
                // Silencia erros de matching individuais para não interromper a avaliação dos demais
            }
        }
        return matches;
    }

    clear(): void {
        this.playbooks.clear();
    }
}
