// src/core/ring-buffer.ts
/**
 * RingBuffer — 固定容量环形缓冲区，O(1) 插入。
 *
 * 提升自 src/dashboard/ring-buffer.ts（fix-forward duplication-across-layers defect）。
 * 合并两版优点：dashboard 的 capacity 校验（ADVISORY-2）+ health-monitor 的 sliceLast + Symbol.iterator。
 * 三方共用：dashboard + health-monitor + call-recorder。
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    // ADVISORY-2: capacity<=0 会导致 % 0 → NaN 索引污染状态。
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got: ${capacity}`);
    }
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  *[Symbol.iterator](): Iterator<T> {
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      yield this.buffer[(start + i) % this.capacity] as T;
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (const item of this) result.push(item);
    return result;
  }

  sliceLast(n: number): T[] {
    return this.toArray().slice(-n);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.buffer = new Array(this.capacity);
  }
}
