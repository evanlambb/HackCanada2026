import {
  Engine,
  FilesInputStore,
  TransformNode,
  Scene,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
  Animation,
  Vector3,
  Observer,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

const scene = new Scene(engine);

scene.createDefaultCameraOrLight(true, true, true);

const environment = scene.createDefaultEnvironment();

// --- WebXR ---
// Babylon's WebXREnterExitUI automatically injects an "Enter VR" button when
// a compatible headset is detected — no manual DOM work needed.
(async () => {
  try {
    const floorMeshes = environment?.ground ? [environment.ground] : [];
    await scene.createDefaultXRExperienceAsync({ floorMeshes });
  } catch {
    // WebXR not available — desktop ArcRotateCamera remains active.
  }
})();

// --- Keyboard state ---
// WASD: W/S move forward/backward along local -Z/+Z, A/D rotate around Y.

const keys = { w: false, a: false, s: false, d: false };

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) (keys as Record<string, boolean>)[k] = true;
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) (keys as Record<string, boolean>)[k] = false;
});

// Tune MOVE_SPEED to match each character's animation foot stride.
// If the character slides (feet don't match ground contact), adjust this value.
const MOVE_SPEED = 0.05;  // units per frame — halved to reduce foot sliding
const ROT_SPEED  = 0.02;  // radians per frame

// --- Animation UI ---

const animPanel = document.getElementById("animPanel") as HTMLDivElement;
const animList  = document.getElementById("animList")  as HTMLDivElement;

// Tracks the name of the currently playing animation for external queries.
let activeAnimName: string | null = null;
export { activeAnimName };

function refreshAnimationPanel(): void {
  const groups = scene.animationGroups;
  animList.innerHTML = "";
  activeAnimName = null;

  animPanel.removeAttribute("hidden");

  if (groups.length === 0) {
    const msg = document.createElement("div");
    msg.className = "anim-empty";
    msg.textContent = "No animations available";
    animList.appendChild(msg);
    return;
  }

  for (const group of groups) {
    const btn = document.createElement("button");
    btn.className = "anim-btn";
    btn.textContent = group.name;
    btn.title = group.name;
    btn.addEventListener("click", () => {
      playAnimation(group.name);
      // Manual selection disables auto-switching until the model is reloaded
      autoSwitch = false;
    });
    animList.appendChild(btn);
  }
}

function playAnimation(name: string): void {
  scene.animationGroups.forEach((g) => g.stop());
  const group = scene.animationGroups.find((g) => g.name === name);
  if (!group) return;
  group.start(true /* loop */);
  activeAnimName = name;
  animList.querySelectorAll<HTMLButtonElement>(".anim-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.textContent === name);
  });
}

function hideAnimationPanel(): void {
  animPanel.setAttribute("hidden", "");
  animList.innerHTML = "";
  activeAnimName = null;
}

// --- Auto animation switching ---
// Searches animationGroups by name pattern and switches when movement state
// changes. autoSwitch is reset to true on every new model load.

let autoSwitch = true;
let wasMoving: boolean | null = null;

function autoSwitchAnimation(moving: boolean): void {
  if (!autoSwitch || moving === wasMoving) return;
  wasMoving = moving;

  if (moving) {
    const anim = scene.animationGroups.find((g) => /walk|jog|run/i.test(g.name));
    if (anim) playAnimation(anim.name);
  } else {
    const anim = scene.animationGroups.find((g) => /idle/i.test(g.name));
    if (anim) playAnimation(anim.name);
  }
}

// --- Model management ---

let playerRoot: TransformNode | null = null;
let moveObserver: Observer<Scene> | null = null;

// Keeps a reference to the last loaded file so the Meshy API can upload it.
let currentModelFile: File | null = null;

function disposeCurrentModel(): void {
  if (moveObserver) {
    scene.onBeforeRenderObservable.remove(moveObserver);
    moveObserver = null;
  }
  if (playerRoot) {
    scene.animationGroups.forEach((g) => g.stop());
    playerRoot.dispose(false, true);
    playerRoot = null;
  }
  wasMoving = null;
  autoSwitch = true;
  currentModelFile = null;
  hideAnimationPanel();
}

/**
 * Computes the axis-aligned bounding box of all descendant meshes in world
 * space. TransformNode has no built-in bounding method, so we aggregate from
 * children. Returns null when there are no child meshes.
 */
function getChildBounds(root: TransformNode): { min: Vector3; max: Vector3 } | null {
  const meshes = root.getChildMeshes(false);
  if (meshes.length === 0) return null;

  let min = new Vector3( Infinity,  Infinity,  Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const { boundingBox } = mesh.getBoundingInfo();
    min = Vector3.Minimize(min, boundingBox.minimumWorld);
    max = Vector3.Maximize(max, boundingBox.maximumWorld);
  }
  return { min, max };
}

/**
 * Centers the model at the origin, scales it so its largest dimension is ~2
 * units, and lifts it so its base sits on Y=0.
 */
function fitModelToScene(root: TransformNode): void {
  root.getChildMeshes(false).forEach((m) => m.computeWorldMatrix(true));

  const bounds = getChildBounds(root);
  if (!bounds) return;

  const { min, max } = bounds;
  const size   = max.subtract(min);
  const center = min.add(size.scale(0.5));

  const maxDim = Math.max(size.x, size.y, size.z);
  const scaleFactor = maxDim > 0 ? 2 / maxDim : 1;
  root.scaling.scaleInPlace(scaleFactor);

  // Recompute after scaling so Y-floor offset is accurate
  root.getChildMeshes(false).forEach((m) => m.computeWorldMatrix(true));
  const scaled = getChildBounds(root);
  const floorY = scaled ? scaled.min.y : 0;

  // Center on XZ, sit on Y=0
  root.position.x -= center.x * scaleFactor;
  root.position.y -= floorY;
  root.position.z -= center.z * scaleFactor;
}

function attachMovementLoop(root: TransformNode): void {
  // Each frame: apply rotation then translation so facing direction is current.
  // autoSwitchAnimation is called with the current moving state so it can
  // swap walk↔idle clips without restarting the same animation every frame.
  moveObserver = scene.onBeforeRenderObservable.add(() => {
    const moving = keys.w || keys.s || keys.a || keys.d;

    if (keys.a) root.rotation.y -= ROT_SPEED;
    if (keys.d) root.rotation.y += ROT_SPEED;

    // root.forward is the -Z local axis expressed in world space
    if (keys.w) root.position.addInPlace(root.forward.scale( MOVE_SPEED));
    if (keys.s) root.position.addInPlace(root.forward.scale(-MOVE_SPEED));

    autoSwitchAnimation(moving);
  });
}

function wrapInPlayerRoot(meshes: AbstractMesh[], name: string): TransformNode {
  const root = new TransformNode(name, scene);
  meshes.forEach((m) => {
    if (!m.parent) m.parent = root;
  });
  return root;
}

// --- Loaders ---

async function loadModelFromUrl(url: string): Promise<void> {
  disposeCurrentModel();

  const lastSlash = url.lastIndexOf("/");
  const rootUrl   = url.substring(0, lastSlash + 1);
  const filename  = url.substring(lastSlash + 1);

  const result = await SceneLoader.ImportMeshAsync("", rootUrl, filename, scene);
  playerRoot = wrapInPlayerRoot(result.meshes, "playerRoot");
  fitModelToScene(playerRoot);
  attachMovementLoop(playerRoot);

  refreshAnimationPanel();
  // Start idle on load if present
  wasMoving = null;
  autoSwitchAnimation(false);
}

async function loadModelFromFile(file: File): Promise<void> {
  disposeCurrentModel();

  FilesInputStore.FilesToLoad[file.name.toLowerCase()] = file;
  currentModelFile = file;

  try {
    const result = await SceneLoader.ImportMeshAsync("", "file:", file.name, scene);
    playerRoot = wrapInPlayerRoot(result.meshes, "playerRoot");
    fitModelToScene(playerRoot);
    attachMovementLoop(playerRoot);

    refreshAnimationPanel();
    wasMoving = null;
    autoSwitchAnimation(false);
  } finally {
    delete FilesInputStore.FilesToLoad[file.name.toLowerCase()];
  }
}

// --- File input wiring ---

const fileInput = document.getElementById("fileInput") as HTMLInputElement;
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadModelFromFile(file);
  fileInput.value = "";
});

// --- URL query param on load ---

const modelUrl = new URLSearchParams(window.location.search).get("model");
if (modelUrl) {
  loadModelFromUrl(modelUrl);
}

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});

// ============================================================
// MESHY API CONFIGURATION
// ============================================================
// TODO: Replace these with your actual Meshy API credentials.
//       Do NOT commit your API key to version control.
const MESHY_API_KEY  = "YOUR_MESHY_API_KEY_HERE";
// TODO: Confirm the correct Meshy API base URL from their docs.
const MESHY_API_BASE = "https://api.meshy.ai";

// ============================================================
// Meshy API — type definitions
// ============================================================

interface MeshyTaskResponse {
  id: string;
  // Meshy task lifecycle: PENDING → IN_PROGRESS → SUCCEEDED | FAILED | EXPIRED
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  result?: {
    // TODO: Confirm the actual field name for the animated GLB download URL
    //       from Meshy's API documentation.
    animated_glb_url?: string;
  };
}

// ============================================================
// Meshy API — helper functions
// ============================================================

/**
 * Uploads the current model file and submits an animation generation task.
 *
 * TODO: Confirm the exact endpoint path, form field names, and any additional
 *       required parameters from the Meshy Animation API documentation.
 *
 * @param animationPrompt  Natural-language description of the motion, e.g. "walking".
 * @param modelFile        The GLB/GLTF file currently loaded in the viewer.
 * @returns                The Meshy task ID to poll for completion.
 */
async function createAnimationTask(
  animationPrompt: string,
  modelFile: File,
): Promise<string> {
  // TODO: Adjust field names to match the Meshy API spec.
  const formData = new FormData();
  formData.append("model_file", modelFile);          // TODO: confirm field name
  formData.append("animation_prompt", animationPrompt); // TODO: confirm field name

  // TODO: Confirm the exact endpoint path, e.g. "/v1/animations" or "/v2/animate".
  const response = await fetch(`${MESHY_API_BASE}/v1/animations`, {
    method: "POST",
    headers: {
      // Do NOT set Content-Type manually when using FormData —
      // the browser sets it automatically with the correct multipart boundary.
      Authorization: `Bearer ${MESHY_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meshy create task failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  // TODO: Confirm the task ID field name in the response, e.g. "id" or "task_id".
  return data.id as string;
}

/**
 * Polls the Meshy task status endpoint every 3 seconds until the task
 * reaches SUCCEEDED, FAILED, or EXPIRED, or until 5 minutes elapse.
 *
 * TODO: Confirm the poll endpoint path from the Meshy API documentation.
 *
 * @param taskId  The task ID returned by createAnimationTask.
 * @throws        Error("TIMEOUT") if 5 minutes pass without completion.
 */
async function pollTaskStatus(taskId: string): Promise<MeshyTaskResponse> {
  const POLL_INTERVAL_MS = 3_000;
  const TIMEOUT_MS       = 5 * 60 * 1_000; // 5 minutes
  const deadline         = Date.now() + TIMEOUT_MS;

  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("TIMEOUT");
    }

    // TODO: Confirm the status endpoint path, e.g. "/v1/animations/{id}".
    const response = await fetch(`${MESHY_API_BASE}/v1/animations/${taskId}`, {
      headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meshy poll failed (${response.status}): ${text}`);
    }

    const task: MeshyTaskResponse = await response.json();

    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "EXPIRED") {
      throw new Error(`Meshy task ${task.status.toLowerCase()}`);
    }

    // Wait before next poll
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Downloads the resulting animated GLB from the Meshy result URL and returns
 * a temporary Blob URL that can be fed to SceneLoader.
 *
 * The caller is responsible for calling URL.revokeObjectURL() when done.
 *
 * @param glbUrl  The direct download URL from task.result.animated_glb_url.
 */
async function downloadGLB(glbUrl: string): Promise<string> {
  const response = await fetch(glbUrl);
  if (!response.ok) {
    throw new Error(`GLB download failed (${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// ============================================================
// Animation merging
// ============================================================

/**
 * Imports an animated GLB (provided as a Blob URL) into the scene, extracts
 * its animation groups, retargets them to the existing character's skeleton by
 * matching bone names, then disposes all temporary imported meshes.
 *
 * Why retarget instead of just keeping the imported groups?
 * The imported GLB contains its own copy of the skeleton.  If we disposed the
 * imported meshes the imported animation groups would lose their targets.  By
 * cloning each Animation and pointing it at the original character's matching
 * bone we can keep the original visible mesh and discard the duplicated one.
 *
 * Fallback: when no skeleton is found (e.g. a morph-target or node-based
 * animation) the first new animation group is simply renamed and kept as-is.
 *
 * @param blobUrl        Temporary Blob URL created by downloadGLB().
 * @param animationName  Display name to assign to the merged AnimationGroup.
 */
async function mergeAnimationsFromGLB(
  blobUrl: string,
  animationName: string,
): Promise<void> {
  if (!playerRoot) return;

  // Locate the existing skeleton (if any) in the current character
  const existingMeshes   = playerRoot.getChildMeshes(false);
  const existingSkeleton = existingMeshes.find((m) => m.skeleton)?.skeleton ?? null;

  // Build a bone-name → bone lookup for fast matching during retargeting
  const boneByName = new Map<string, any>();
  if (existingSkeleton) {
    for (const bone of existingSkeleton.bones) {
      boneByName.set(bone.name, bone);
    }
  }

  // Note how many animation groups currently exist so we can identify the new
  // ones added by the import below.
  const groupCountBefore = scene.animationGroups.length;

  // Import the animated GLB — this adds meshes AND animation groups to the scene.
  const result = await SceneLoader.ImportMeshAsync("", "", blobUrl, scene);

  // Collect only the newly added animation groups.
  const newGroups = scene.animationGroups.slice(groupCountBefore);

  if (newGroups.length === 0) {
    // The GLB contained no animation data — nothing to merge.
    result.meshes.forEach((m) => m.dispose(false, true));
    URL.revokeObjectURL(blobUrl);
    return;
  }

  if (existingSkeleton) {
    // ── Retargeting path ────────────────────────────────────────────────────
    // For each imported animation group, create a new AnimationGroup that
    // targets the original character's bones instead of the imported copies.
    for (let gi = 0; gi < newGroups.length; gi++) {
      const importedGroup = newGroups[gi];

      // If the GLB produced multiple groups, suffix with an index.
      const groupName =
        newGroups.length === 1 ? animationName : `${animationName}_${gi}`;

      const retargeted = new AnimationGroup(groupName, scene);

      for (const ta of importedGroup.targetedAnimations) {
        const importedBone = ta.target;
        if (importedBone && typeof importedBone.name === "string") {
          const existingBone = boneByName.get(importedBone.name);
          if (existingBone) {
            // Clone the Animation curve data and point it at the original bone.
            retargeted.addTargetedAnimation(
              ta.animation.clone() as Animation,
              existingBone,
            );
          }
        }
      }

      // Remove the imported animation group — it targets bones we're about to
      // dispose along with the imported meshes.
      importedGroup.stop();
      importedGroup.dispose();
    }
  } else {
    // ── Fallback: node-based or morph-target animation ──────────────────────
    // We cannot easily retarget without a skeleton.  Rename the first group
    // and leave its targets pointing at the imported meshes (which we keep).
    // Dispose extra groups if the GLB produced more than one.
    newGroups[0].name = animationName;
    for (let gi = 1; gi < newGroups.length; gi++) {
      newGroups[gi].stop();
      newGroups[gi].dispose();
    }

    // In the fallback path do NOT dispose imported meshes — the animation
    // groups still reference them.  Hide them instead so the scene only shows
    // the original character visually.
    result.meshes.forEach((m) => {
      m.isVisible = false;
    });

    URL.revokeObjectURL(blobUrl);
    return;
  }

  // Dispose temporary imported meshes (retargeted animations now reference the
  // original character's skeleton, so these are safe to remove).
  result.meshes.forEach((m) => m.dispose(false, true));
  URL.revokeObjectURL(blobUrl);
}

// ============================================================
// Generate Animation panel — UI wiring
// ============================================================

const genPromptInput = document.getElementById("genPromptInput") as HTMLInputElement;
const genBtn         = document.getElementById("genBtn")         as HTMLButtonElement;
const genStatus      = document.getElementById("genStatus")      as HTMLDivElement;

function setStatus(message: string, type: "info" | "error" | "success" = "info"): void {
  genStatus.textContent = message;
  genStatus.className   = type === "info" ? "" : type;
}

/**
 * Main orchestrator for animation generation.
 *
 * Workflow:
 *   1. Parse the prompt input — comma-separated values become a batch.
 *   2. For each prompt (sequentially):
 *      a. POST to Meshy to create an animation task.
 *      b. Poll every 3 s until SUCCEEDED (or time out after 5 min).
 *      c. Download the resulting GLB.
 *      d. Merge its animations into the current character.
 *   3. Refresh the animation panel to show all newly generated clips.
 */
async function generateAnimations(): Promise<void> {
  const rawInput = genPromptInput.value.trim();
  if (!rawInput) return;

  if (!playerRoot) {
    setStatus("Please load a 3D model first.", "error");
    return;
  }
  if (!currentModelFile) {
    setStatus("Please load a 3D model first.", "error");
    return;
  }

  // Parse prompts — split on commas for batch mode.
  const prompts = rawInput.includes(",")
    ? rawInput.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
    : [rawInput];

  const isBatch = prompts.length > 1;

  genBtn.disabled = true;
  const succeeded: string[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];

    // ── Progress message ─────────────────────────────────────────────────────
    if (isBatch) {
      setStatus(`Generating animations… (${i + 1}/${prompts.length}: '${prompt}')`);
    } else {
      setStatus("Generating animation… (this may take 30–60 seconds)");
    }

    try {
      // Step 1 — Create the animation task on Meshy
      const taskId = await createAnimationTask(prompt, currentModelFile);

      // Step 2 — Poll until the task completes
      const task = await pollTaskStatus(taskId);

      // TODO: Adjust the result field name to match Meshy's actual API response.
      const resultUrl = task.result?.animated_glb_url;
      if (!resultUrl) {
        throw new Error("Task succeeded but no GLB URL was returned.");
      }

      // Step 3 — Download the animated GLB
      const blobUrl = await downloadGLB(resultUrl);

      // Step 4 — Merge animations into the current character
      await mergeAnimationsFromGLB(blobUrl, prompt);

      succeeded.push(prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message === "TIMEOUT") {
        setStatus(
          `Generation timed out for '${prompt}'. Please try a different animation.`,
          "error",
        );
      } else {
        setStatus(
          `Animation generation failed for '${prompt}'. Please try again.`,
          "error",
        );
        console.error("[Meshy]", err);
      }

      // In batch mode continue with the remaining prompts even if one fails.
      if (!isBatch) break;
    }
  }

  genBtn.disabled = false;

  if (succeeded.length === 0) return;

  // Refresh the animation list to show all new clips.
  refreshAnimationPanel();

  const n = succeeded.length;
  setStatus(
    `${n} animation${n > 1 ? "s" : ""} generated! Check the animation panel.`,
    "success",
  );
}

genBtn.addEventListener("click", () => { generateAnimations(); });

// Allow pressing Enter inside the prompt input to trigger generation.
genPromptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") generateAnimations();
});
