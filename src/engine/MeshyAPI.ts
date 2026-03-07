const BASE = '/api/meshy';

export interface MeshyTask {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  model_urls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
  };
  thumbnail_url?: string;
  task_error?: { message: string };
}

export type ModelType = 'standard' | 'lowpoly';

export async function createImageTo3D(
  imageDataUri: string,
  opts: {
    modelType?: ModelType;
    shouldTexture?: boolean;
    targetPolycount?: number;
  } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    image_url: imageDataUri,
    ai_model: 'meshy-6',
    model_type: opts.modelType ?? 'standard',
    should_texture: opts.shouldTexture ?? false,
    topology: 'triangle',
    target_polycount: opts.targetPolycount ?? 30000,
  };

  const res = await fetch(`${BASE}/image-to-3d`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.result as string;
}

export async function getTask(taskId: string): Promise<MeshyTask> {
  const res = await fetch(`${BASE}/image-to-3d/${taskId}`);
  if (!res.ok) {
    throw new Error(`Meshy API error ${res.status}`);
  }
  return res.json();
}

export function pollTask(
  taskId: string,
  onProgress: (task: MeshyTask) => void,
  intervalMs = 3000,
): { cancel: () => void } {
  let alive = true;

  async function poll() {
    while (alive) {
      try {
        const task = await getTask(taskId);
        onProgress(task);
        if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELED') {
          return;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  poll();
  return { cancel: () => { alive = false; } };
}

export async function downloadGlb(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.arrayBuffer();
}

/* ===== Rigging ===== */

export interface RiggingResult {
  rigged_character_glb_url?: string;
  rigged_character_fbx_url?: string;
  basic_animations?: {
    walking_glb_url?: string;
    running_glb_url?: string;
  };
}

export interface RiggingTask {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  result?: RiggingResult;
  task_error?: { message: string };
}

export async function createRiggingTask(
  input: { modelDataUri: string } | { inputTaskId: string },
  heightMeters = 1.7,
): Promise<string> {
  const body: Record<string, unknown> = { height_meters: heightMeters };
  if ('inputTaskId' in input) {
    body.input_task_id = input.inputTaskId;
  } else {
    body.model_url = input.modelDataUri;
  }
  const res = await fetch(`${BASE}/rigging`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy rigging error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.result as string;
}

export async function getRiggingTask(taskId: string): Promise<RiggingTask> {
  const res = await fetch(`${BASE}/rigging/${taskId}`);
  if (!res.ok) throw new Error(`Meshy API error ${res.status}`);
  return res.json();
}

/* ===== Animation ===== */

export interface AnimationResult {
  animation_glb_url?: string;
  animation_fbx_url?: string;
}

export interface AnimationTaskResult {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  result?: AnimationResult;
  task_error?: { message: string };
}

export async function createAnimationTask(
  rigTaskId: string,
  actionId: number,
): Promise<string> {
  const res = await fetch(`${BASE}/animations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rig_task_id: rigTaskId,
      action_id: actionId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy animation error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.result as string;
}

export async function getAnimationTask(
  taskId: string,
): Promise<AnimationTaskResult> {
  const res = await fetch(`${BASE}/animations/${taskId}`);
  if (!res.ok) throw new Error(`Meshy API error ${res.status}`);
  return res.json();
}

/* ===== Generic poller ===== */

export function pollAnyTask<T extends { status: string; progress: number }>(
  getter: () => Promise<T>,
  onProgress: (task: T) => void,
  intervalMs = 3000,
): { cancel: () => void; promise: Promise<T> } {
  let alive = true;

  const promise = new Promise<T>((resolve, reject) => {
    (async () => {
      while (alive) {
        try {
          const task = await getter();
          onProgress(task);
          if (task.status === 'SUCCEEDED') { resolve(task); return; }
          if (task.status === 'FAILED' || task.status === 'CANCELED') {
            reject(new Error(`Task ${task.status}`));
            return;
          }
        } catch (err) {
          if (!alive) return;
          console.error('Poll error:', err);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    })();
  });

  return { cancel: () => { alive = false; }, promise };
}
