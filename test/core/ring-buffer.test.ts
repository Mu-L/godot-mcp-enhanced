import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/core/ring-buffer.js';

describe('RingBuffer', () => {
  it('throws RangeError for non-positive capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(-1)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(1.5)).toThrow(RangeError);
  });

  it('push and toArray preserve order', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2); rb.push(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it('overwrites oldest when full (rolling)', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2); rb.push(3); rb.push(4);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.length).toBe(3);
  });

  it('sliceLast returns last n', () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5].forEach(n => rb.push(n));
    expect(rb.sliceLast(2)).toEqual([4, 5]);
    expect(rb.sliceLast(10)).toEqual([1, 2, 3, 4, 5]);
  });

  it('Symbol.iterator works', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(10); rb.push(20);
    expect([...rb]).toEqual([10, 20]);
  });

  it('clear resets', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it('empty buffer toArray/sliceLast return []', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.toArray()).toEqual([]);
    expect(rb.sliceLast(5)).toEqual([]);
  });
});
