import type { Request, Response } from 'express';
import { ChatWebhookController } from "../controllers/ChatWebhookController.js";
import { QStashAdapter } from "../infrastructure/queue/QStashAdapter.js";

const queueAdapter = new QStashAdapter(process.env.QSTASH_TOKEN!, process.env.WORKER_URL!);
const controller = new ChatWebhookController(queueAdapter);

export default async function handler (req: Request, res: Response) {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    return controller.handle(req, res); 
}