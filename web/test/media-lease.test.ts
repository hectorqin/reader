// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackLease } from '../src/media/playback-lease.ts';
import type { MediaApi, Playback } from '../src/media/api.ts';
import { ApiError } from '../src/api/errors.ts';

const leases: PlaybackLease[] = [];
function setup() {
  vi.useFakeTimers();
  const session = { id: 's1', expiresAt: Date.now() + 6 * 60 * 60_000, streamUrl: '/unchanged', revision: 7 } as Playback;
  const request = vi.fn(async () => ({ id: 's1', expiresAt: Date.now() + 6 * 60 * 60_000 }));
  const failure = vi.fn();
  const lease = new PlaybackLease({ request } as unknown as MediaApi, session, failure);
  leases.push(lease);
  return { session, request, failure, lease };
}
afterEach(() => { for (const lease of leases.splice(0)) lease.stop(); vi.useRealTimers(); });

describe('playback URL lifetime', () => {
  it('releases a transport that ignores abort and rejects its late expiry update',async()=>{
    const {lease,session,request,failure}=setup();session.expiresAt=Date.now()-1;
    let finish!:(response:{id:string;expiresAt:number})=>void;
    request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=expect(lease.ensure()).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);await pending;
    expect(failure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);expect(request).toHaveBeenCalledTimes(2);
    const renewed=session.expiresAt;finish({id:'s1',expiresAt:renewed+999999});await Promise.resolve();
    expect(session.expiresAt).toBe(renewed);
  });
  it('stop settles pending renewal even when the transport never responds',async()=>{
    const {lease,session,request,failure}=setup();session.expiresAt=Date.now()-1;
    request.mockImplementation(()=>new Promise(()=>{}));
    const pending=lease.ensure();lease.stop();await pending;
    expect(failure).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('renews before expiry while retaining stream URL and progress revision', async () => {
    const { session, request, failure } = setup();
    const expiry = session.expiresAt;
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 - 2 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('playback/s1/renew', 'POST', {}, expect.any(AbortSignal));
    expect(session.expiresAt).toBeGreaterThan(expiry);
    expect(session.streamUrl).toBe('/unchanged'); expect(session.revision).toBe(7);
    expect(failure).not.toHaveBeenCalled();
  });
  it('coalesces simultaneous resume/progress renewal and ignores late responses after stop', async () => {
    const { lease, session, request } = setup();
    session.expiresAt = Date.now() - 1;
    let finish!: (response: { id: string; expiresAt: number }) => void;
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = lease.ensure(), second = lease.ensure();
    expect(request).toHaveBeenCalledTimes(1);
    lease.stop();
    finish({ id: 's1', expiresAt: Date.now() + 6 * 60 * 60_000 });
    await Promise.all([first, second]);
    expect(session.expiresAt).toBeLessThan(Date.now());
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('backs off transient failure then retries, without a timeupdate request storm', async () => {
    const { lease, session, request, failure } = setup();
    session.expiresAt = Date.now() + 60_000;
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(lease.ensure()).rejects.toThrow('offline');
    await Promise.all(Array.from({ length: 10 }, () => lease.ensure()));
    expect(request).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith(expect.any(String), false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 60_000);
  });
  it('stops renewal after permission revocation or takeover', async () => {
    const { lease, session, request, failure } = setup();
    session.expiresAt = Date.now();
    request.mockRejectedValue(new ApiError('conflict', 'taken over', 'PLAYBACK_TAKEN_OVER', 409));
    await expect(lease.ensure()).rejects.toThrow('taken over');
    expect(failure).toHaveBeenCalledWith(expect.any(String), true);
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
