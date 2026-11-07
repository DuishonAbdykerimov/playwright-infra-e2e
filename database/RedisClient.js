// database/RedisClient.js
import { createClient } from 'redis';

export class RedisClient {
    constructor({ url = process.env.REDIS_URL ?? 'redis://localhost:6379', socket } = {}) {
        this.client = createClient({
            url,
            ...(socket ? { socket } : {}),
        });

        this.client.on('error', err => console.error('Redis Client Error', err));
    }

    async setKey(key, value) {
        return this.#runWithConnection(() => this.client.set(key, value));
    }

    async getKey(key) {
        return this.#runWithConnection(() => this.client.get(key));
    }

    async #runWithConnection(operation) {
        try {
            await this.client.connect();
            return await operation();
        } finally {
            if (this.client.isOpen) {
                await this.client.disconnect();
            }
        }
    }
}
