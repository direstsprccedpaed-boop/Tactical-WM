export interface ScheduledTask<T> {
  id: string;
  priority?: number;
  run: (signal: AbortSignal) => Promise<T>;
  onSuccess?: (result: T) => void | Promise<void>;
  onError?: (error: unknown, attempt: number) => void | Promise<void>;
}

interface QueueItem<T> {
  task: ScheduledTask<T>;
  attempt: number;
  readyAt: number;
  sequence: number;
}

export class Scheduler {
  private readonly queue: QueueItem<unknown>[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly activeTaskIds = new Set<string>();
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private paused = false;

  constructor(
    private readonly concurrency = 4,
    private readonly maxRetries = 4,
    private readonly initialBackoffMs = 1_000,
    private readonly maxBackoffMs = 60_000,
  ) {}

  enqueue<T>(task: ScheduledTask<T>): void {
    const alreadyQueued = this.queue.some((item) => item.task.id === task.id);
    const alreadyActive = this.activeTaskIds.has(task.id);

    if (alreadyQueued || alreadyActive) {
      return;
    }

    this.queue.push({
      task: task as unknown as ScheduledTask<unknown>,
      attempt: 0,
      readyAt: Date.now(),
      sequence: this.sequence++,
    });

    this.pump();
  }

  abortAll(): void {
    this.paused = true;

    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = undefined;
    }

    for (const controller of this.active.values()) {
      controller.abort();
    }

    this.active.clear();
    this.activeTaskIds.clear();
    this.queue.length = 0;
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  private pump(): void {
    if (this.paused) {
      return;
    }

    while (this.active.size < this.concurrency) {
      const item = this.takeReadyTask();

      if (!item) {
        this.scheduleWake();
        return;
      }

      void this.execute(item);
    }
  }

  private takeReadyTask(): QueueItem<unknown> | undefined {
    const now = Date.now();

    this.queue.sort((a, b) => {
      if (a.readyAt !== b.readyAt) {
        return a.readyAt - b.readyAt;
      }

      const priorityDifference = (b.task.priority ?? 0) - (a.task.priority ?? 0);

      return priorityDifference || a.sequence - b.sequence;
    });

    const index = this.queue.findIndex((item) => item.readyAt <= now);

    return index === -1 ? undefined : this.queue.splice(index, 1)[0];
  }

  private async execute(item: QueueItem<unknown>): Promise<void> {
    const controller = new AbortController();
    const taskRunId = `${item.task.id}:${item.sequence}:${item.attempt}`;

    this.active.set(taskRunId, controller);
    this.activeTaskIds.add(item.task.id);

    try {
      const result = await item.task.run(controller.signal);

      if (!controller.signal.aborted) {
        await item.task.onSuccess?.(result);
      }
    } catch (error) {
      const aborted = controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');

      if (!aborted && !this.paused) {
        const attempt = item.attempt + 1;

        await item.task.onError?.(error, attempt);

        if (attempt <= this.maxRetries) {
          this.queue.push({
            ...item,
            attempt,
            readyAt: Date.now() + this.getBackoff(attempt),
          });
        }
      }
    } finally {
      this.active.delete(taskRunId);
      this.activeTaskIds.delete(item.task.id);
      this.pump();
    }
  }

  private getBackoff(attempt: number): number {
    const exponential = Math.min(
      this.maxBackoffMs,
      this.initialBackoffMs * 2 ** (attempt - 1),
    );

    return exponential + Math.floor(Math.random() * 500);
  }

  private scheduleWake(): void {
    if (this.wakeTimer || this.queue.length === 0) {
      return;
    }

    const nextTime = Math.min(...this.queue.map((item) => item.readyAt));
    const delay = Math.max(0, nextTime - Date.now());

    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      this.pump();
    }, delay);
  }
}

export const scheduler = new Scheduler();
