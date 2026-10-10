export interface SanitizationOptions {
    maxLines?: number;
    maxChars?: number;
    maxArrayItems?: number;
    pruneKeys?: string[];
    suppressEmptyValues?: boolean;
}

export const DEFAULT_PRUNE_KEYS: readonly string[] = [
    'managedFields',
    'ownerReferences',
    'annotations',
    'generation',
    'resourceVersion',
    'selfLink',
    'uid',
    'kubectl.kubernetes.io/last-applied-configuration'
];

export const DEFAULT_MAX_LINES = 50;
export const DEFAULT_MAX_CHARS = 6000;
export const DEFAULT_MAX_ARRAY_ITEMS = 25;

export class ToolOutputSanitizer {
    private readonly defaultOptions: SanitizationOptions;

    constructor(defaultOptions?: SanitizationOptions) {
        this.defaultOptions = {
            maxLines: defaultOptions?.maxLines ?? DEFAULT_MAX_LINES,
            maxChars: defaultOptions?.maxChars ?? DEFAULT_MAX_CHARS,
            maxArrayItems: defaultOptions?.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
            pruneKeys: defaultOptions?.pruneKeys ?? [...DEFAULT_PRUNE_KEYS],
            suppressEmptyValues: defaultOptions?.suppressEmptyValues ?? true
        };
    }

    /**
     * Sanitiza recursivamente objetos, arrays e payloads brutos, removendo ruído de metadados
     * e podando coleções excessivamente longas.
     */
    public static sanitize(data: unknown, options?: SanitizationOptions): unknown {
        const pruneKeys = new Set(options?.pruneKeys ?? DEFAULT_PRUNE_KEYS);
        const maxArrayItems = options?.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
        const suppressEmptyValues = options?.suppressEmptyValues ?? true;

        if (data === null || data === undefined) {
            return data;
        }

        if (typeof data === 'string') {
            const trimmed = data.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return ToolOutputSanitizer.sanitize(parsed, options);
                } catch {
                    // Not valid JSON, keep raw string
                }
            }
            return data;
        }

        if (typeof data !== 'object') {
            return data;
        }

        if (Array.isArray(data)) {
            const sanitizedList = data.map(item => ToolOutputSanitizer.sanitize(item, options));

            if (sanitizedList.length > maxArrayItems) {
                const headCount = Math.max(1, Math.floor(maxArrayItems / 2));
                const tailCount = Math.max(1, maxArrayItems - headCount);
                const suppressed = sanitizedList.length - headCount - tailCount;

                if (suppressed > 0) {
                    return [
                        ...sanitizedList.slice(0, headCount),
                        `[... ${suppressed} itens suprimidos para economia de contexto ...]`,
                        ...sanitizedList.slice(sanitizedList.length - tailCount)
                    ];
                }
            }
            return sanitizedList;
        }

        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
            if (pruneKeys.has(key)) {
                continue;
            }

            if (suppressEmptyValues) {
                if (val === null || val === undefined) {
                    continue;
                }
                if (Array.isArray(val) && val.length === 0) {
                    continue;
                }
                if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) {
                    continue;
                }
            }

            const sanitizedVal = ToolOutputSanitizer.sanitize(val, options);

            if (suppressEmptyValues) {
                if (sanitizedVal === null || sanitizedVal === undefined) {
                    continue;
                }
                if (Array.isArray(sanitizedVal) && sanitizedVal.length === 0) {
                    continue;
                }
                if (typeof sanitizedVal === 'object' && !Array.isArray(sanitizedVal) && Object.keys(sanitizedVal).length === 0) {
                    continue;
                }
            }

            result[key] = sanitizedVal;
        }

        return result;
    }

    /**
     * Converte o resultado de ferramenta em string otimizada para o contexto da LLM,
     * aplicando limpeza estrutural, truncamento de linhas (head + tail) e limite de caracteres.
     */
    public static sanitizeToString(data: unknown, options?: SanitizationOptions): string {
        const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
        const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

        let processedData: unknown = data;

        if (typeof data === 'string') {
            const trimmed = data.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const parsed = JSON.parse(trimmed);
                    processedData = ToolOutputSanitizer.sanitize(parsed, options);
                } catch {
                    processedData = data;
                }
            }
        } else if (typeof data === 'object' && data !== null) {
            processedData = ToolOutputSanitizer.sanitize(data, options);
        }

        let outputStr = typeof processedData === 'string'
            ? processedData
            : JSON.stringify(processedData, null, 2);

        // 1. Truncamento de linhas (preserva cabeçalho e cauda)
        const lines = outputStr.split('\n');
        if (lines.length > maxLines) {
            const headCount = Math.max(1, Math.floor(maxLines * 0.4));
            const tailCount = Math.max(1, Math.floor(maxLines * 0.6));
            const suppressed = lines.length - headCount - tailCount;

            if (suppressed > 0) {
                const head = lines.slice(0, headCount);
                const tail = lines.slice(lines.length - tailCount);
                outputStr = [
                    ...head,
                    `[... ${suppressed} linhas intermediárias suprimidas para economia de contexto ...]`,
                    ...tail
                ].join('\n');
            }
        }

        // 2. Truncamento de caracteres
        if (outputStr.length > maxChars) {
            outputStr = outputStr.slice(0, maxChars) +
                `\n[... conteúdo truncado: limite de ${maxChars} caracteres atingido ...]`;
        }

        return outputStr;
    }

    public sanitize(data: unknown, options?: SanitizationOptions): unknown {
        const mergedOptions = { ...this.defaultOptions, ...options };
        return ToolOutputSanitizer.sanitize(data, mergedOptions);
    }

    public sanitizeToString(data: unknown, options?: SanitizationOptions): string {
        const mergedOptions = { ...this.defaultOptions, ...options };
        return ToolOutputSanitizer.sanitizeToString(data, mergedOptions);
    }
}
