/**
 * In-memory render job queue (BullMQ / Redis drop-in later).
 * Workers invoke FFmpeg / sharp stubs via MediaProcessor.
 */

export type RenderJobPayload = {
  masterAssetId: string;
  presetCode: string;
  tidOwner: string;
  tenantId: string;
};

export type QueueHandler = (job: RenderJobPayload) => Promise<void>;

export class RenderQueue {
  private readonly pending: RenderJobPayload[] = [];
  private handler: QueueHandler | null = null;
  private pumping = false;

  onProcess(handler: QueueHandler): void {
    this.handler = handler;
  }

  async enqueue(job: RenderJobPayload): Promise<void> {
    this.pending.push(job);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.handler) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift()!;
        await this.handler(job);
      }
    } finally {
      this.pumping = false;
    }
  }
}

export const renderQueue = new RenderQueue();
