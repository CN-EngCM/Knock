import { api } from "@/api/client";

// 缩略图生成队列：网格里的图收到 404（还没有缩略图）后来这里排队，
// 交给 Worker 生成，再经 gallerySaveThumb 存盘。同一张只生成一次，同时最多 2 张，
// 避免一屏几十张同时解码把内存顶高。

const MAX_ACTIVE = 2;

type Job = { id: number; format: string; done: (ok: boolean) => void };

let worker: Worker | null = null;
const inflight = new Map<number, Promise<boolean>>(); // 去重：排队中和处理中的 id
const waiting: Job[] = [];
const running = new Map<number, Job>(); // 已发给 Worker、等结果的任务

function getWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(new URL("./thumbWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; bytes?: ArrayBuffer; error?: string }>) => {
        const { id, bytes } = e.data;
        const job = running.get(id);
        if (!job) return;
        if (!bytes) return finish(job, false);
        void api.gallerySaveThumb(id, new Uint8Array(bytes)).then(
            (r) => finish(job, r.ok),
            () => finish(job, false),
        );
    };
    // Worker 自身崩了：在途任务全部判失败，丢掉它，下次请求再重建
    w.onerror = () => {
        w.terminate();
        worker = null;
        for (const job of [...running.values()]) finish(job, false);
    };
    worker = w;
    return w;
}

function finish(job: Job, ok: boolean) {
    running.delete(job.id);
    inflight.delete(job.id);
    job.done(ok);
    pump();
}

function pump() {
    while (running.size < MAX_ACTIVE && waiting.length > 0) {
        const job = waiting.shift()!;
        running.set(job.id, job);
        getWorker().postMessage({ id: job.id, format: job.format });
    }
}

/** 请求生成缩略图，生成并存盘成功返回 true */
export function requestThumb(id: number, format: string): Promise<boolean> {
    const existing = inflight.get(id);
    if (existing) return existing;
    const p = new Promise<boolean>((done) => {
        waiting.push({ id, format, done });
    });
    inflight.set(id, p);
    pump();
    return p;
}
