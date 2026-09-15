import type { Db } from 'mongodb';

export interface Migration {
    name: string;
    up(db: Db): Promise<void>;
    down?(db: Db): Promise<void>;
}
