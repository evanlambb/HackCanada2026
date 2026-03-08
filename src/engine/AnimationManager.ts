import * as THREE from 'three';

export class AnimationManager {
  private mixers = new Map<string, THREE.AnimationMixer>();
  private clips = new Map<string, THREE.AnimationClip[]>();
  private activeActions = new Map<string, THREE.AnimationAction>();

  register(id: string, object: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.remove(id);
    const mixer = new THREE.AnimationMixer(object);
    this.mixers.set(id, mixer);
    this.clips.set(id, clips);
  }

  play(id: string, name: string) {
    const mixer = this.mixers.get(id);
    const clips = this.clips.get(id);
    if (!mixer || !clips) return;

    // Stop any currently playing action for this object
    const current = this.activeActions.get(id);
    if (current) {
      current.fadeOut(0.2);
    }

    const clip = clips.find((c) => c.name === name);
    if (!clip) return;

    const action = mixer.clipAction(clip);
    action.loop = THREE.LoopRepeat;
    action.reset().fadeIn(0.2).play();
    this.activeActions.set(id, action);
  }

  stop(id: string) {
    const mixer = this.mixers.get(id);
    const action = this.activeActions.get(id);
    if (action) {
      action.fadeOut(0.2);
      this.activeActions.delete(id);
    }
    // Schedule a full stop after fade
    if (mixer) {
      setTimeout(() => mixer.stopAllAction(), 250);
    }
  }

  update(delta: number) {
    for (const mixer of this.mixers.values()) {
      mixer.update(delta);
    }
  }

  remove(id: string) {
    const mixer = this.mixers.get(id);
    if (mixer) {
      mixer.stopAllAction();
      this.mixers.delete(id);
    }
    this.clips.delete(id);
    this.activeActions.delete(id);
  }

  getAllClips(id: string): THREE.AnimationClip[] {
    return this.clips.get(id) ?? [];
  }

  dispose() {
    for (const id of [...this.mixers.keys()]) {
      this.remove(id);
    }
  }
}
