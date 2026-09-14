import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolGovernanceService } from './ToolGovernanceService.js';
import { CompositeMCPClient } from '../infrastructure/mcp/CompositeMCPClient.js';
import { ToolCall } from '../domain/ToolCall.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { ToolGovernancePolicy } from '../domain/ToolGovernance.js';

describe('ToolGovernanceService', () => {
    let service: ToolGovernanceService;

    beforeEach(() => {
        service = new ToolGovernanceService();
    });

    describe('Classificação Padrão de Ferramentas (classify)', () => {
        it('deve classificar verbos de consulta/leitura como READ_ONLY', () => {
            expect(service.classify('get_pods')).toBe('READ_ONLY');
            expect(service.classify('k8s__list_deployments')).toBe('READ_ONLY');
            expect(service.classify('describe_pod')).toBe('READ_ONLY');
            expect(service.classify('loki__query_logs')).toBe('READ_ONLY');
            expect(service.classify('fetch_metrics')).toBe('READ_ONLY');
            expect(service.classify('check_pool')).toBe('READ_ONLY');
            expect(service.classify('explain_query')).toBe('READ_ONLY');
        });

        it('deve classificar alterações benignas como LOW_RISK', () => {
            expect(service.classify('update_threshold')).toBe('LOW_RISK');
            expect(service.classify('set_log_level')).toBe('LOW_RISK');
            expect(service.classify('enable_cache')).toBe('LOW_RISK');
            expect(service.classify('trigger_backup')).toBe('LOW_RISK');
        });

        it('deve classificar ações com impacto operacional como HIGH_RISK', () => {
            expect(service.classify('restart_pod')).toBe('HIGH_RISK');
            expect(service.classify('k8s__scale_deployment')).toBe('HIGH_RISK');
            expect(service.classify('reboot_node')).toBe('HIGH_RISK');
            expect(service.classify('exec_command')).toBe('HIGH_RISK');
            expect(service.classify('drain_node')).toBe('HIGH_RISK');
            expect(service.classify('deploy_version')).toBe('HIGH_RISK');
            expect(service.classify('rollback_release')).toBe('HIGH_RISK');
        });

        it('deve classificar comandos destrutivos como FORBIDDEN', () => {
            expect(service.classify('delete_pod')).toBe('FORBIDDEN');
            expect(service.classify('k8s__delete_namespace')).toBe('FORBIDDEN');
            expect(service.classify('drop_database')).toBe('FORBIDDEN');
            expect(service.classify('truncate_table')).toBe('FORBIDDEN');
            expect(service.classify('kill_process')).toBe('FORBIDDEN');
            expect(service.classify('purge_cache_all')).toBe('FORBIDDEN');
            expect(service.classify('destroy_cluster')).toBe('FORBIDDEN');
            expect(service.classify('rmdir_data')).toBe('FORBIDDEN');
        });

        it('deve usar LOW_RISK como fallback defensivo para ferramentas com verbos desconhecidos', () => {
            expect(service.classify('custom_operation_xyz')).toBe('LOW_RISK');
        });
    });

    describe('Avaliação de Decisão com Políticas (evaluate)', () => {
        it('deve permitir ferramentas READ_ONLY por padrão', () => {
            const decision = service.evaluate(new ToolCall('get_pods', {}));
            expect(decision.allowed).toBe(true);
            expect(decision.riskLevel).toBe('READ_ONLY');
        });

        it('deve permitir ferramentas LOW_RISK por padrão', () => {
            const decision = service.evaluate(new ToolCall('update_config', {}));
            expect(decision.allowed).toBe(true);
            expect(decision.riskLevel).toBe('LOW_RISK');
        });

        it('deve bloquear ferramentas FORBIDDEN incondicionalmente', () => {
            const decision = service.evaluate(new ToolCall('k8s__delete_pod', { name: 'api-1' }));
            expect(decision.allowed).toBe(false);
            expect(decision.riskLevel).toBe('FORBIDDEN');
            expect(decision.reason).toContain('FORBIDDEN');
        });

        it('deve suspender ferramentas HIGH_RISK exigindo aprovação por padrão', () => {
            const decision = service.evaluate(new ToolCall('restart_pod', { pod: 'auth-api' }));
            expect(decision.allowed).toBe(false);
            expect(decision.riskLevel).toBe('HIGH_RISK');
            expect(decision.requiresApproval).toBe(true);
            expect(decision.reason).toContain('aprovação humana');
        });

        it('deve permitir ferramentas HIGH_RISK se allowHighRiskWithoutApproval for true', () => {
            const policy: ToolGovernancePolicy = { allowHighRiskWithoutApproval: true };
            const decision = service.evaluate(new ToolCall('restart_pod', {}), policy);
            expect(decision.allowed).toBe(true);
            expect(decision.riskLevel).toBe('HIGH_RISK');
        });

        it('deve bloquear ferramentas que casem com blockedToolPatterns', () => {
            const policy: ToolGovernancePolicy = {
                blockedToolPatterns: ['custom_sensitive_tool', 'internal_*']
            };

            const dec1 = service.evaluate(new ToolCall('custom_sensitive_tool', {}), policy);
            expect(dec1.allowed).toBe(false);
            expect(dec1.riskLevel).toBe('FORBIDDEN');

            const dec2 = service.evaluate(new ToolCall('internal_debug_dump', {}), policy);
            expect(dec2.allowed).toBe(false);
            expect(dec2.riskLevel).toBe('FORBIDDEN');
        });

        it('deve respeitar regras customizadas com precedência sobre padrões do sistema', () => {
            const policy: ToolGovernancePolicy = {
                customRules: [
                    // Permite que uma ferramenta normalmente HIGH_RISK seja tratada como READ_ONLY
                    { pattern: 'restart_canary_test', riskLevel: 'READ_ONLY' },
                    // Transforma uma ferramenta comum em FORBIDDEN
                    { pattern: 'get_raw_passwords', riskLevel: 'FORBIDDEN' }
                ]
            };

            const dec1 = service.evaluate(new ToolCall('restart_canary_test', {}), policy);
            expect(dec1.allowed).toBe(true);
            expect(dec1.riskLevel).toBe('READ_ONLY');

            const dec2 = service.evaluate(new ToolCall('get_raw_passwords', {}), policy);
            expect(dec2.allowed).toBe(false);
            expect(dec2.riskLevel).toBe('FORBIDDEN');
        });

        it('deve rejeitar ferramentas se seu nível de risco não constar em allowedRiskLevels', () => {
            const policy: ToolGovernancePolicy = {
                allowedRiskLevels: ['READ_ONLY'] // Apenas leitura estrita permitida
            };

            const readDec = service.evaluate(new ToolCall('get_pods', {}), policy);
            expect(readDec.allowed).toBe(true);

            const lowRiskDec = service.evaluate(new ToolCall('update_config', {}), policy);
            expect(lowRiskDec.allowed).toBe(false);
            expect(lowRiskDec.reason).toContain('não é permitido pelas políticas do tenant');
        });
    });

    describe('Integração com CompositeMCPClient', () => {
        let mockClient: IMCPClient;

        beforeEach(() => {
            mockClient = {
                connect: vi.fn().mockResolvedValue({
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: { listChanged: true } },
                    serverInfo: { name: 'test', version: '1.0.0' }
                }),
                isConnected: vi.fn().mockReturnValue(true),
                listTools: vi.fn().mockResolvedValue({
                    tools: [
                        { name: 'get_pods', description: 'Leitura' },
                        { name: 'restart_pod', description: 'Reinicio' },
                        { name: 'delete_pod', description: 'Deleção' }
                    ]
                }),
                executeTool: vi.fn().mockResolvedValue({ success: true }),
                close: vi.fn().mockResolvedValue(undefined)
            };
        });

        it('deve interceptar e bloquear ferramenta FORBIDDEN sem chamar o servidor upstream', async () => {
            const composite = new CompositeMCPClient(
                [{ id: 'k8s', name: 'K8s', client: mockClient }],
                service
            );

            await composite.listTools();

            const result = await composite.executeTool(new ToolCall('k8s__delete_pod', { name: 'prod-api' }));

            expect(result.blocked).toBe(true);
            expect(result.riskLevel).toBe('FORBIDDEN');
            expect(result.error).toContain('FORBIDDEN');
            expect(mockClient.executeTool).not.toHaveBeenCalled();
        });

        it('deve suspender ferramenta HIGH_RISK por padrão com requiresApproval: true', async () => {
            const composite = new CompositeMCPClient(
                [{ id: 'k8s', name: 'K8s', client: mockClient }],
                service
            );

            await composite.listTools();

            const result = await composite.executeTool(new ToolCall('k8s__restart_pod', { name: 'prod-api' }));

            expect(result.blocked).toBe(true);
            expect(result.riskLevel).toBe('HIGH_RISK');
            expect(result.requiresApproval).toBe(true);
            expect(mockClient.executeTool).not.toHaveBeenCalled();
        });

        it('deve executar ferramenta READ_ONLY normalmente chamando o upstream', async () => {
            const composite = new CompositeMCPClient(
                [{ id: 'k8s', name: 'K8s', client: mockClient }],
                service
            );

            await composite.listTools();

            const result = await composite.executeTool(new ToolCall('k8s__get_pods', {}));

            expect(result).toEqual({ success: true });
            expect(mockClient.executeTool).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'get_pods' })
            );
        });

        it('deve permitir atualizar a política de governança via setGovernancePolicy', async () => {
            const composite = new CompositeMCPClient(
                [{ id: 'k8s', name: 'K8s', client: mockClient }],
                service
            );

            await composite.listTools();

            // Bloqueia com política padrão
            const res1 = await composite.executeTool(new ToolCall('k8s__restart_pod', {}));
            expect(res1.blocked).toBe(true);

            // Aplica override permitindo HIGH_RISK
            composite.setGovernancePolicy({ allowHighRiskWithoutApproval: true });

            const res2 = await composite.executeTool(new ToolCall('k8s__restart_pod', {}));
            expect(res2).toEqual({ success: true });
            expect(mockClient.executeTool).toHaveBeenCalledTimes(1);
        });
    });
});
