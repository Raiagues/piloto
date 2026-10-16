import { describe, expect, it, vi } from 'vitest';
import { createHeartbeatSender } from '../src/lib/presenceHeartbeat';

describe('presence heartbeat scheduling', () => {
  it('shares one pending request even if a visibility event follows a timer tick', async () => {
    let finish!: () => void, time = 0;
    const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const heartbeat = createHeartbeatSender(send, () => time);
    const first = heartbeat();
    await Promise.resolve();
    time = 40_000;
    expect(heartbeat()).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    finish(); await first;
    const next = heartbeat(); await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    finish(); await next;
  });

  it('does not repeat a successful request for focus changes inside 25 seconds', async () => {
    let time = 0;
    const send = vi.fn(async () => {}), heartbeat = createHeartbeatSender(send, () => time);
    await heartbeat();
    for (time of [1, 100, 10_000, 24_999]) await heartbeat();
    expect(send).toHaveBeenCalledTimes(1);
    time = 25_000; await heartbeat();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('releases a failed attempt for the next event, without an automatic retry', async () => {
    const send = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce();
    const heartbeat = createHeartbeatSender(send, () => 0);
    await expect(heartbeat()).rejects.toThrow('offline');
    expect(send).toHaveBeenCalledTimes(1);
    await heartbeat();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('also releases synchronous transport failures', async () => {
    const send = vi.fn<() => Promise<void>>().mockImplementationOnce(() => { throw new Error('transport'); }).mockResolvedValueOnce();
    const heartbeat = createHeartbeatSender(send, () => 0);
    await expect(heartbeat()).rejects.toThrow('transport');
    await heartbeat();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
