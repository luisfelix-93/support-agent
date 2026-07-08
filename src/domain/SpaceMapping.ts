export class SpaceMapping {
    constructor(
        public readonly spaceId: string,
        public readonly workspaceId: string,
        public readonly createdAt: Date = new Date()
    ) {}
}