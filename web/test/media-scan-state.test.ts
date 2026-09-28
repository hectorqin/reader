// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { MediaScreen } from '../src/media/screen.tsx';

const context = (request: ReturnType<typeof vi.fn>) => ({
  poll: null, jobRequest: 0, jobLibraryId: 'a', jobState: 'ready', jobError: '',
  jobs: [{ id: 'old-job', state: 'complete' }], disposed: false, itemId: '',
  abort: new AbortController(), api: { request }, draw: vi.fn(), load: vi.fn(async () => {}),
});
const read = (state: ReturnType<typeof context>, id: string) => Reflect.apply(Reflect.get(MediaScreen.prototype, 'loadJobs'), state, [id]);

it('background polling keeps the existing page ready without global busy or a loading redraw', async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (value: unknown) => void;
    const request=vi.fn().mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const state=context(request);
    Reflect.set(state,'loadJobs',(id:string,background:boolean)=>Reflect.apply(Reflect.get(MediaScreen.prototype,'loadJobs'),state,[id,background]));
    const pending=Reflect.apply(Reflect.get(MediaScreen.prototype,'loadJobs'),state,['a',true]);
    expect(state.jobState).toBe('ready');expect(state.draw).not.toHaveBeenCalled();
    resolve({items:[{id:'active',state:'running'}]});await pending;
    expect(state.draw).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(request).toHaveBeenCalledTimes(2);expect(state.jobState).toBe('ready');
    resolve({items:[{id:'active',state:'running'}]});await Promise.resolve();
  } finally {vi.clearAllTimers();vi.useRealTimers();}
});

it('clears another library’s jobs before reading and never presents a failed read as empty success', async () => {
  const state = context(vi.fn().mockRejectedValue(new Error('offline')));
  await expect(read(state, 'b')).rejects.toThrow('offline');
  expect(state.jobLibraryId).toBe('b'); expect(state.jobs).toEqual([]);
  expect(state.jobState).toBe('error'); expect(state.jobError).toBe('offline');
  expect(state.load).not.toHaveBeenCalled();
});

it('keeps same-library stale results on failure and recovers with a read only', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [] });
  const state = context(request);
  await expect(read(state, 'a')).rejects.toThrow();
  expect(state.jobs).toHaveLength(1); expect(state.jobState).toBe('error');
  await read(state, 'a');
  expect(state.jobs).toEqual([]); expect(state.jobState).toBe('ready');
  expect(request.mock.calls.every(call => call[1] === 'GET')).toBe(true);
});

it('ignores an older failed read after a newer library has loaded', async () => {
  let reject!: (error: Error) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce({ items: [{ id: 'new-job', state: 'complete' }] });
  const state = context(request), older = read(state, 'a');
  await read(state, 'b'); reject(new Error('late failure')); await older;
  expect(state.jobLibraryId).toBe('b'); expect(state.jobs[0]!.id).toBe('new-job');
  expect(state.jobState).toBe('ready'); expect(state.jobError).toBe('');
});

it('reads all libraries and continues polling while any job is queued', async () => {
  vi.useFakeTimers();
  try {
    const request=vi.fn().mockResolvedValue({items:[{id:'queued',libraryId:'b',state:'queued'}]}),state=context(request);
    await read(state,'');
    expect(request).toHaveBeenCalledWith('scan-jobs','GET',undefined,expect.any(AbortSignal));
    expect(state.jobState).toBe('ready');expect(state.poll).not.toBeNull();expect(state.load).not.toHaveBeenCalled();
  } finally { vi.clearAllTimers();vi.useRealTimers(); }
});

it('submits batch scan only once when the following read fails and refreshes with GET',async()=>{
  const request=vi.fn().mockResolvedValueOnce({items:[{id:'one'}],skipped:['active']}).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({items:[]});
  const state={...context(request),scanNotice:'',run:async(fn:()=>Promise<void>)=>fn(),loadJobs:async(id:string)=>read(state,id)};
  await expect(Reflect.apply(Reflect.get(MediaScreen.prototype,'scanAll'),state,[])).rejects.toThrow('offline');
  expect(state.scanNotice).toContain('已提交 1');expect(state.scanNotice).toContain('跳过 1');expect(state.jobState).toBe('error');
  await read(state,'');expect(request.mock.calls.map(call=>call[1])).toEqual(['POST','GET','GET']);
});

it('checks task state after an uncertain POST and never reports submission success',async()=>{
  const request=vi.fn().mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce({items:[]});
  const state={...context(request),scanNotice:'old success',scanActionError:'',run:async(fn:()=>Promise<void>)=>fn(),loadJobs:async(id:string)=>read(state,id)};
  await Reflect.apply(Reflect.get(MediaScreen.prototype,'scanAll'),state,[]);expect(state.scanActionError).toContain('批量扫描请求未确认');
  expect(state.scanNotice).toBe('');expect(state.jobState).toBe('ready');expect(request.mock.calls.map(call=>call[1])).toEqual(['POST','GET']);
});
