import { EventEmitter } from 'node:events';

export const memoryEvents = new EventEmitter();

export interface ThreadEndedPayload {
  threadId: string;
  apiKeyId: string;
  userId:   string;
}
