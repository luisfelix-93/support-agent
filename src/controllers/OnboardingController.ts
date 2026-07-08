import { Request, Response } from 'express';
import { RegisterUserUseCase } from '../usecases/RegisterUserUseCase.js';
import { RegisterTenantUseCase } from '../usecases/RegisterTenantUseCase.js';
import { RegisterSpaceUseCase } from '../usecases/RegisterSpaceUseCase.js';
import { AssociateTenantToUserUseCase } from '../usecases/AssociateTenantToUserUseCase.js';

export class OnboardingController {
    constructor(
        private readonly registerUserUseCase: RegisterUserUseCase,
        private readonly registerTenantUseCase: RegisterTenantUseCase,
        private readonly registerSpaceUseCase: RegisterSpaceUseCase,
        private readonly associateTenantUseCase: AssociateTenantToUserUseCase
    ) {}

    // ─── POST /api/onboarding/users ──────────────────────
    async registerUser(req: Request, res: Response): Promise<void> {
        try {
            const { name, email, password } = req.body;

            if (!name || !email || !password) {
                res.status(400).json({ error: 'Fields "name", "email" and "password" are required.' });
                return;
            }

            const result = await this.registerUserUseCase.execute({ name, email, password });
            res.status(201).json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to register user.';
            const status = message.includes('already registered') ? 409 : 500;
            res.status(status).json({ error: message });
        }
    }

    // ─── POST /api/onboarding/tenants ────────────────────
    async registerTenant(req: Request, res: Response): Promise<void> {
        try {
            const { workspaceId, llmConfig, mcpConfig } = req.body;

            if (!workspaceId || !llmConfig || !mcpConfig) {
                res.status(400).json({ error: 'Fields "workspaceId", "llmConfig" and "mcpConfig" are required.' });
                return;
            }

            const result = await this.registerTenantUseCase.execute({ workspaceId, llmConfig, mcpConfig });
            res.status(201).json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to register tenant.';
            const status = message.includes('already exists') ? 409 : 500;
            res.status(status).json({ error: message });
        }
    }

    // ─── POST /api/onboarding/spaces ─────────────────────
    async registerSpace(req: Request, res: Response): Promise<void> {
        try {
            const { spaceId, workspaceId } = req.body;

            if (!spaceId || !workspaceId) {
                res.status(400).json({ error: 'Fields "spaceId" and "workspaceId" are required.' });
                return;
            }

            const result = await this.registerSpaceUseCase.execute({ spaceId, workspaceId });
            res.status(201).json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to register space.';
            const status = message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: message });
        }
    }

    // ─── POST /api/onboarding/associate-tenant ───────────
    async associateTenant(req: Request, res: Response): Promise<void> {
        try {
            const { workspaceId } = req.body;
            const userId = req.user?.sub;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized.' });
                return;
            }

            if (!workspaceId) {
                res.status(400).json({ error: 'Field "workspaceId" is required.' });
                return;
            }

            await this.associateTenantUseCase.execute({ userId, workspaceId });
            res.status(200).json({ message: 'Tenant associated successfully.' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to associate tenant.';
            const status = message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: message });
        }
    }
}
