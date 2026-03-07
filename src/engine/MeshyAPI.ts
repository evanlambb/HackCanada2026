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
