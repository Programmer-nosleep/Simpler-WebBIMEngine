import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { CameraProjectionMode, CameraSceneApi } from "./CameraScene";

export type GridOptions = {
  color?: THREE.ColorRepresentation;
  primarySize?: number;
  secondarySize?: number;
  distance?: number;
  yOffset?: number;
};

export function setupGrid(cameraScene: CameraSceneApi, options: GridOptions = {}) {
  const grids = cameraScene.components.get(OBC.Grids);
  const grid = grids.create(cameraScene.world);

  grid.setup({
    visible: true,
    color: new THREE.Color(options.color ?? 0xbbbbbb),
    primarySize: options.primarySize ?? 1,
    secondarySize: options.secondarySize ?? 10,
    distance: options.distance ?? 500,
  });

  grid.three.position.y = options.yOffset ?? 0;

  const applyFade = (projection: CameraProjectionMode) => {
    grid.fade = projection === "Perspective";
  };

  applyFade(cameraScene.getProjection());
  const unsubscribe = cameraScene.onProjectionChanged(applyFade);

  return {
    grid,
    dispose() {
      unsubscribe();
      grids.delete(cameraScene.world);
    },
  };
}
