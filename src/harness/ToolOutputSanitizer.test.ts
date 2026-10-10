import { describe, it, expect } from 'vitest';
import { ToolOutputSanitizer, DEFAULT_PRUNE_KEYS } from './ToolOutputSanitizer.js';

describe('ToolOutputSanitizer', () => {
    describe('Poda de metadados e ruído em JSON (K8s / Loki / APIs)', () => {
        it('deve podar chaves ruidosas padrão como managedFields, ownerReferences e resourceVersion', () => {
            const rawK8sPod = {
                metadata: {
                    name: 'checkout-service-7f89d-abc12',
                    namespace: 'production',
                    uid: 'd3b07384-d113-4f44-98a4-123456789abc',
                    resourceVersion: '12345678',
                    generation: 2,
                    managedFields: [
                        { manager: 'kube-controller-manager', operation: 'Update' }
                    ],
                    ownerReferences: [
                        { kind: 'ReplicaSet', name: 'checkout-service-7f89d' }
                    ],
                    annotations: {
                        'kubectl.kubernetes.io/last-applied-configuration': '{"large":"config"}'
                    }
                },
                status: {
                    phase: 'CrashLoopBackOff',
                    restartCount: 5,
                    reason: 'OOMKilled',
                    exitCode: 137
                }
            };

            const sanitized = ToolOutputSanitizer.sanitize(rawK8sPod) as any;

            expect(sanitized.metadata.name).toBe('checkout-service-7f89d-abc12');
            expect(sanitized.metadata.namespace).toBe('production');
            expect(sanitized.status.phase).toBe('CrashLoopBackOff');
            expect(sanitized.status.restartCount).toBe(5);
            expect(sanitized.status.reason).toBe('OOMKilled');

            // Chaves ruidosas devem ser removidas
            expect(sanitized.metadata.managedFields).toBeUndefined();
            expect(sanitized.metadata.ownerReferences).toBeUndefined();
            expect(sanitized.metadata.resourceVersion).toBeUndefined();
            expect(sanitized.metadata.uid).toBeUndefined();
            expect(sanitized.metadata.generation).toBeUndefined();
            expect(sanitized.metadata.annotations).toBeUndefined();
        });

        it('deve remover valores nulos, vazios ou indefinidos quando suppressEmptyValues for true', () => {
            const payload = {
                service: 'order-api',
                activeError: 'DB connection timeout',
                emptyList: [],
                emptyObj: {},
                nullVal: null,
                undefinedVal: undefined,
                validCount: 0,
                validFlag: false
            };

            const sanitized = ToolOutputSanitizer.sanitize(payload, { suppressEmptyValues: true }) as any;

            expect(sanitized.service).toBe('order-api');
            expect(sanitized.activeError).toBe('DB connection timeout');
            expect(sanitized.validCount).toBe(0);
            expect(sanitized.validFlag).toBe(false);

            expect('emptyList' in sanitized).toBe(false);
            expect('emptyObj' in sanitized).toBe(false);
            expect('nullVal' in sanitized).toBe(false);
            expect('undefinedVal' in sanitized).toBe(false);
        });

        it('deve preservar objetos e campos primitivos essenciais sem modificá-los', () => {
            const simpleObj = {
                status: 'ok',
                statusCode: 200,
                message: 'Healthcheck passed'
            };

            const sanitized = ToolOutputSanitizer.sanitize(simpleObj);
            expect(sanitized).toEqual(simpleObj);
        });

        it('deve lidar com valores primitivos diretamente (números, booleans, strings curtas)', () => {
            expect(ToolOutputSanitizer.sanitize(123)).toBe(123);
            expect(ToolOutputSanitizer.sanitize(true)).toBe(true);
            expect(ToolOutputSanitizer.sanitize('sucesso')).toBe('sucesso');
            expect(ToolOutputSanitizer.sanitize(null)).toBe(null);
            expect(ToolOutputSanitizer.sanitize(undefined)).toBe(undefined);
        });
    });

    describe('Truncamento e compactação de listas e arrays', () => {
        it('deve limitar arrays com muitos itens mantendo início e fim com marcador explicativo', () => {
            const longList = Array.from({ length: 60 }, (_, i) => ({
                id: i + 1,
                event: `Event #${i + 1}`
            }));

            const sanitized = ToolOutputSanitizer.sanitize(longList, { maxArrayItems: 10 }) as any[];

            expect(sanitized.length).toBeLessThan(60);
            expect(sanitized[0]).toEqual({ id: 1, event: 'Event #1' });
            // Deve conter indicador no meio
            const hasTruncationMarker = sanitized.some(
                item => typeof item === 'string' && item.includes('itens suprimidos para economia de contexto')
            );
            expect(hasTruncationMarker).toBe(true);
            // Deve conter itens do final
            expect(sanitized[sanitized.length - 1]).toEqual({ id: 60, event: 'Event #60' });
        });
    });

    describe('Truncamento de texto e logs (sanitizeToString)', () => {
        it('deve truncar linhas intermediárias de logs longos preservando cabeçalho e cauda (head & tail)', () => {
            const lines: string[] = [];
            lines.push('2026-10-10 10:00:00 INFO Initializing service');
            for (let i = 1; i <= 80; i++) {
                lines.push(`2026-10-10 10:00:${i < 10 ? '0' + i : i} DEBUG heartbeat trace id=${i}`);
            }
            lines.push('2026-10-10 10:01:30 ERROR Critical connection failure: ECONNREFUSED');
            lines.push('2026-10-10 10:01:31 FATAL Process terminated with exit code 1');

            const rawLog = lines.join('\n');
            const result = ToolOutputSanitizer.sanitizeToString(rawLog, { maxLines: 20 });

            expect(result).toContain('2026-10-10 10:00:00 INFO Initializing service');
            expect(result).toContain('2026-10-10 10:01:30 ERROR Critical connection failure: ECONNREFUSED');
            expect(result).toContain('2026-10-10 10:01:31 FATAL Process terminated with exit code 1');
            expect(result).toContain('linhas intermediárias suprimidas para economia de contexto');
            
            const resultLines = result.split('\n');
            expect(resultLines.length).toBeLessThanOrEqual(25);
        });

        it('deve truncar strings que excedem maxChars e anexar aviso de corte', () => {
            const longString = 'A'.repeat(5000);
            const result = ToolOutputSanitizer.sanitizeToString(longString, { maxChars: 500 });

            expect(result.length).toBeLessThanOrEqual(600);
            expect(result).toContain('limite de 500 caracteres atingido');
        });

        it('deve converter JSON strings válidas e sanitizá-las estruturalmente antes de converter para string', () => {
            const jsonString = JSON.stringify({
                metadata: {
                    name: 'auth-pod',
                    managedFields: [{ foo: 'bar' }]
                },
                status: 'Error'
            });

            const result = ToolOutputSanitizer.sanitizeToString(jsonString);
            const parsed = JSON.parse(result);

            expect(parsed.metadata.name).toBe('auth-pod');
            expect(parsed.metadata.managedFields).toBeUndefined();
            expect(parsed.status).toBe('Error');
        });
    });

    describe('Instanciação e opções customizadas', () => {
        it('deve permitir criar instância com opções customizadas', () => {
            const customSanitizer = new ToolOutputSanitizer({
                maxLines: 15,
                maxChars: 1000,
                pruneKeys: ['customSecret', ...DEFAULT_PRUNE_KEYS]
            });

            const input = {
                customSecret: '123456',
                data: 'public data'
            };

            const output = customSanitizer.sanitize(input) as any;
            expect(output.customSecret).toBeUndefined();
            expect(output.data).toBe('public data');
        });
    });
});
