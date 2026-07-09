import type { Tenant } from "../Tenant.js";

export interface ITenantRepository {
    findByWorkspaceId(workspaceId: string): Promise<Tenant | null>;
    save(tenant: Tenant): Promise<void>;
}