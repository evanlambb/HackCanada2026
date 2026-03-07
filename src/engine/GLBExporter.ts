import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export async function exportToGlbDataUri(
  object: THREE.Object3D,
): Promise<string> {
  const exporter = new GLTFExporter();

  const buffer: ArrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(result as ArrayBuffer),
      reject,
      { binary: true },
    );
  });

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return `data:application/octet-stream;base64,${b64}`;
}
