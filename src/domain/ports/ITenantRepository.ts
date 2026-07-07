import type { Tenant } from "../Tenant";

export interface ITenantRepository {
    findByWorkspaceId(workspaceId: string): Promise<Tenant | null>;
    save(tenant: Tenant): Promise<void>;
}