import type { Request, Response, NextFunction } from 'express';

/**
 * Middleware factory para garantir o isolamento de tenant.
 * Extrai o workspaceId dos parâmetros de rota ou do corpo da requisição
 * e valida se o usuário autenticado possui acesso ao workspace especificado.
 *
 * @param paramName Nome do parâmetro que contém o identificador do workspace (padrão: 'workspaceId')
 */
export function tenantGuard(paramName: string = 'workspaceId') {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized: authentication required.' });
            return;
        }

        const workspaceId = (req.params?.[paramName] ?? req.body?.[paramName]) as string | undefined;

        if (!workspaceId) {
            res.status(403).json({ error: 'Forbidden: workspaceId is required.' });
            return;
        }

        const userWorkspaces = req.user.workspaceIds ?? [];
        if (!userWorkspaces.includes(workspaceId)) {
            res.status(403).json({ error: 'Forbidden: access to this workspace is denied.' });
            return;
        }

        next();
    };
}
