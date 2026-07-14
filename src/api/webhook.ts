import type { Request, Response } from 'express';
import { ChatWebhookController } from "../controllers/ChatWebhookController.js";
import { BullMQAdapter } from "../infrastructure/queue/BullMQAdapter.js";

const redisConnection = process.env.REDIS_URL || {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
};

const queueAdapter = new BullMQAdapter(redisConnection);
const controller = new ChatWebhookController(queueAdapter);

export default async function handler (req: Request, res: Response) {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    return controller.handle(req, res); 
}