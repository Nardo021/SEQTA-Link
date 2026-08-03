export class Mutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(timeoutMs = 5000): Promise<boolean> {
    if (!this.locked) {
      this.locked = true;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onUnlock);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        resolve(false);
      }, timeoutMs);

      const onUnlock = (): void => {
        clearTimeout(timer);
        this.locked = true;
        resolve(true);
      };

      this.waiters.push(onUnlock);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }

  async runExclusive<T>(fn: () => Promise<T>, timeoutMs = 5000): Promise<T | null> {
    const acquired = await this.acquire(timeoutMs);
    if (!acquired) {
      return null;
    }
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const feedMutexes = new Map<string, Mutex>();

export function getFeedMutex(feedId: string): Mutex {
  let mutex = feedMutexes.get(feedId);
  if (!mutex) {
    mutex = new Mutex();
    feedMutexes.set(feedId, mutex);
  }
  return mutex;
}
