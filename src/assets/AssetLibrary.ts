import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

export type AssetId =
  | "player_fighter"
  | "enemy_fighter"
  | "enemy_interceptor"
  | "enemy_bomber"
  | "missile_player"
  | "missile_enemy"
  | "powerup_heavy"
  | "powerup_missiles"
  | "powerup_ghost"
  | "island"
  | "rock_stack"
  | "buoy"
  | "searchlight_emplacement"
  | "burning_wreck"
  | "destroyer"
  | "ocean_battlefield"
  | "horizon_cliffs";

const IDS: AssetId[] = [
  "player_fighter",
  "enemy_fighter",
  "enemy_interceptor",
  "enemy_bomber",
  "missile_player",
  "missile_enemy",
  "powerup_heavy",
  "powerup_missiles",
  "powerup_ghost",
  "island",
  "rock_stack",
  "buoy",
  "searchlight_emplacement",
  "burning_wreck",
  "destroyer",
  "ocean_battlefield",
  "horizon_cliffs",
];

/**
 * Preloaded Blender/GLB sources. Clones share vertex buffers and materials, so
 * pooled enemies and repeated map props pay the 10.5k-triangle geometry cost
 * once in download/GPU memory rather than once per instance.
 */
export class AssetLibrary {
  private sources = new Map<AssetId, Mesh>();

  private constructor() {}

  static async load(scene: Scene): Promise<AssetLibrary> {
    const library = new AssetLibrary();
    await Promise.all(IDS.map(async (id) => {
      const result = await SceneLoader.ImportMeshAsync(
        "",
        "./assets/models/",
        `${id}.glb`,
        scene,
      );
      const root = result.meshes[0];
      if (!(root instanceof Mesh)) throw new Error(`GLB ${id} has no mesh root`);
      root.name = `assetSource_${id}`;
      root.setEnabled(false);
      root.isPickable = false;
      for (const mesh of root.getChildMeshes(false)) mesh.isPickable = false;
      library.sources.set(id, root);
    }));
    return library;
  }

  source(id: AssetId): Mesh {
    const source = this.sources.get(id);
    if (!source) throw new Error(`Asset not loaded: ${id}`);
    return source;
  }

  clone(id: AssetId, name: string, parent: Node | null = null): Mesh {
    const clone = this.source(id).clone(name, parent, false, false)!;
    clone.name = name;
    clone.setEnabled(true);
    clone.isPickable = false;
    for (const mesh of clone.getChildMeshes(false)) mesh.isPickable = false;
    return clone;
  }
}
