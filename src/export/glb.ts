import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { Object3D } from 'three';

/**
 * Real `.glb` export.
 *
 * This replaces the prototype's "Export HTML", which wrote a standalone page
 * that loaded three.js r128 from a CDN and drew a hardcoded four-sided cone and
 * a single orange box — the same output regardless of what you had designed.
 * What comes out of here is the actual scene graph you are looking at, in a
 * format Blender, the three.js editor and every other DCC tool can open.
 */
export async function exportGlb(object: Object3D, filename: string): Promise<void> {
  const exporter = new GLTFExporter();

  const result = await exporter.parseAsync(object, {
    binary: true,
    onlyVisible: true,
    // Points/lines have no glTF equivalent worth emitting here.
    includeCustomExtensions: false,
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error('Expected binary glTF output');
  }

  const blob = new Blob([result], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking synchronously after click() can cancel the download in some
    // browsers; defer to the next macrotask.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
