export interface ChatConfigProps {
    workspaceId: string;
    provider?: string;
    teamId: string;
    botToken: string;
    appToken?: string;
    signingSecret: string;
    isActive?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export class ChatConfig {
    public readonly workspaceId: string;
    public readonly provider: string;
    public readonly teamId: string;
    public readonly botToken: string;
    public readonly appToken?: string;
    public readonly signingSecret: string;
    public readonly isActive: boolean;
    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    constructor(props: ChatConfigProps) {
        if (!props.workspaceId || props.workspaceId.trim() === '') {
            throw new Error('[ChatConfig] workspaceId é obrigatório.');
        }
        if (!props.teamId || props.teamId.trim() === '') {
            throw new Error('[ChatConfig] teamId é obrigatório.');
        }
        if (!props.botToken || props.botToken.trim() === '') {
            throw new Error('[ChatConfig] botToken é obrigatório.');
        }
        if (!props.signingSecret || props.signingSecret.trim() === '') {
            throw new Error('[ChatConfig] signingSecret é obrigatório.');
        }

        this.workspaceId = props.workspaceId;
        this.provider = props.provider ?? 'slack';
        this.teamId = props.teamId;
        this.botToken = props.botToken;
        this.appToken = props.appToken;
        this.signingSecret = props.signingSecret;
        this.isActive = props.isActive ?? true;
        this.createdAt = props.createdAt ?? new Date();
        this.updatedAt = props.updatedAt ?? new Date();
    }
}
