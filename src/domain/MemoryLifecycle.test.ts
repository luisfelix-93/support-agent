import { describe, it, expect } from 'vitest';
import { MemoryLifecycle, type MemoryStatus, type MemoryType } from './Memory.js';

describe('MemoryLifecycle', () => {
    describe('canTransition', () => {
        it('deve permitir transições idênticas (mesmo estado)', () => {
            const statuses: MemoryStatus[] = ['candidate', 'validated', 'active', 'updated', 'expired'];
            for (const status of statuses) {
                expect(MemoryLifecycle.canTransition(status, status)).toBe(true);
            }
        });

        it('deve permitir transições válidas a partir de candidate', () => {
            expect(MemoryLifecycle.canTransition('candidate', 'validated')).toBe(true);
            expect(MemoryLifecycle.canTransition('candidate', 'active')).toBe(true);
            expect(MemoryLifecycle.canTransition('candidate', 'expired')).toBe(true);
            expect(MemoryLifecycle.canTransition('candidate', 'updated')).toBe(false);
        });

        it('deve permitir transições válidas a partir de validated', () => {
            expect(MemoryLifecycle.canTransition('validated', 'active')).toBe(true);
            expect(MemoryLifecycle.canTransition('validated', 'updated')).toBe(true);
            expect(MemoryLifecycle.canTransition('validated', 'expired')).toBe(true);
            expect(MemoryLifecycle.canTransition('validated', 'candidate')).toBe(false);
        });

        it('deve permitir transições válidas a partir de active', () => {
            expect(MemoryLifecycle.canTransition('active', 'updated')).toBe(true);
            expect(MemoryLifecycle.canTransition('active', 'expired')).toBe(true);
            expect(MemoryLifecycle.canTransition('active', 'candidate')).toBe(false);
        });

        it('deve permitir transições válidas a partir de updated', () => {
            expect(MemoryLifecycle.canTransition('updated', 'active')).toBe(true);
            expect(MemoryLifecycle.canTransition('updated', 'expired')).toBe(true);
            expect(MemoryLifecycle.canTransition('updated', 'candidate')).toBe(false);
        });

        it('deve permitir reativação ou recandidatura a partir de expired', () => {
            expect(MemoryLifecycle.canTransition('expired', 'active')).toBe(true);
            expect(MemoryLifecycle.canTransition('expired', 'candidate')).toBe(true);
            expect(MemoryLifecycle.canTransition('expired', 'updated')).toBe(false);
        });
    });

    describe('calculateExpiresAt', () => {
        it('deve calcular corretamente a data futura de expiração a partir do TTL', () => {
            const baseDate = new Date('2026-09-13T10:00:00.000Z');
            const ttlSeconds = 3600; // 1 hora
            const expiresAt = MemoryLifecycle.calculateExpiresAt(ttlSeconds, baseDate);

            expect(expiresAt).toBeDefined();
            expect(expiresAt?.toISOString()).toBe('2026-09-13T11:00:00.000Z');
        });

        it('deve retornar undefined se ttlSeconds for nulo, indefinido ou menor/igual a zero', () => {
            expect(MemoryLifecycle.calculateExpiresAt(undefined)).toBeUndefined();
            expect(MemoryLifecycle.calculateExpiresAt(0)).toBeUndefined();
            expect(MemoryLifecycle.calculateExpiresAt(-50)).toBeUndefined();
        });
    });

    describe('getDefaultTtlSeconds', () => {
        it('deve retornar TTL adequado por categoria de memória operacional', () => {
            expect(MemoryLifecycle.getDefaultTtlSeconds('incident')).toBe(30 * 24 * 60 * 60);
            expect(MemoryLifecycle.getDefaultTtlSeconds('resolution')).toBe(90 * 24 * 60 * 60);
            expect(MemoryLifecycle.getDefaultTtlSeconds('summary')).toBe(15 * 24 * 60 * 60);
        });

        it('deve retornar undefined para categorias permanentes', () => {
            const permanentTypes: MemoryType[] = ['fact', 'knowledge', 'preference'];
            for (const type of permanentTypes) {
                expect(MemoryLifecycle.getDefaultTtlSeconds(type)).toBeUndefined();
            }
        });
    });

    describe('determineInitialStatus', () => {
        it('deve marcar como active se o score de confiança for maior ou igual ao threshold', () => {
            expect(MemoryLifecycle.determineInitialStatus(0.85, 0.8)).toBe('active');
            expect(MemoryLifecycle.determineInitialStatus(0.8, 0.8)).toBe('active');
        });

        it('deve marcar como candidate se o score de confiança for menor que o threshold', () => {
            expect(MemoryLifecycle.determineInitialStatus(0.79, 0.8)).toBe('candidate');
            expect(MemoryLifecycle.determineInitialStatus(0.4, 0.8)).toBe('candidate');
        });

        it('deve ter como padrão active se score não for fornecido', () => {
            expect(MemoryLifecycle.determineInitialStatus(undefined)).toBe('active');
        });
    });
});
