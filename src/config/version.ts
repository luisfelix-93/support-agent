import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DEFAULT_AGENT_VERSION = '1.0.0';

let cachedPackageJsonVersion: string | null = null;

/**
 * Retorna dinamicamente a versão do agente baseada no package.json do projeto.
 * 
 * Precedência de resolução:
 * 1. process.env.AGENT_VERSION (se explicitamente configurado no ambiente)
 * 2. Cache em memória da versão lida do package.json
 * 3. Leitura do package.json a partir do process.cwd() ou subindo a árvore de diretórios
 * 4. process.env.npm_package_version (definido automaticamente pelo runtime npm)
 * 5. Fallback seguro DEFAULT_AGENT_VERSION
 */
export function getAgentVersion(): string {
    const envVersion = process.env.AGENT_VERSION?.trim();
    if (envVersion) {
        return envVersion;
    }

    if (cachedPackageJsonVersion) {
        return cachedPackageJsonVersion;
    }

    try {
        // 1. Tenta carregar package.json a partir do diretório de trabalho atual (cwd)
        const cwdPackageJson = path.resolve(process.cwd(), 'package.json');
        if (fs.existsSync(cwdPackageJson)) {
            const raw = fs.readFileSync(cwdPackageJson, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.version && typeof parsed.version === 'string') {
                const version = parsed.version.trim();
                cachedPackageJsonVersion = version;
                return version;
            }
        }

        // 2. Tenta localizar package.json subindo a hierarquia de diretórios a partir deste arquivo
        let currentDir = path.dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 5; i++) {
            const candidate = path.resolve(currentDir, 'package.json');
            if (fs.existsSync(candidate)) {
                const raw = fs.readFileSync(candidate, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed.version && typeof parsed.version === 'string') {
                    const version = parsed.version.trim();
                    cachedPackageJsonVersion = version;
                    return version;
                }
            }
            const parent = path.dirname(currentDir);
            if (parent === currentDir) break;
            currentDir = parent;
        }
    } catch {
        // Em caso de erro de I/O ou parsing, recorre aos fallbacks
    }

    const npmVersion = process.env.npm_package_version?.trim();
    if (npmVersion) {
        cachedPackageJsonVersion = npmVersion;
        return npmVersion;
    }

    cachedPackageJsonVersion = DEFAULT_AGENT_VERSION;
    return DEFAULT_AGENT_VERSION;
}

/**
 * Invalida o cache em memória da versão do package.json.
 * Útil para testes automatizados.
 */
export function resetAgentVersionCache(): void {
    cachedPackageJsonVersion = null;
}
