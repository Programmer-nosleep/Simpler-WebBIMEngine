import CameraControls from "camera-controls";
import type * as OBC from "@thatopen/components";
import type { CameraSceneApi } from "../components/CameraScene";

type ControlsInstance = InstanceType<typeof CameraControls>;
type MouseButtonsMap = ControlsInstance["mouseButtons"] & {
  shiftLeft?: number;
  shiftMiddle?: number;
  shiftRight?: number;
};

const cloneMouseButtons = (buttons: MouseButtonsMap): MouseButtonsMap => ({
  left: buttons.left,
  middle: buttons.middle,
  right: buttons.right,
  wheel: buttons.wheel,
  shiftLeft: buttons.shiftLeft,
  shiftMiddle: buttons.shiftMiddle,
  shiftRight: buttons.shiftRight,
});

export function setupNavigationInputBindings(cameraScene: CameraSceneApi) {
  const controls = cameraScene.camera.controls as ControlsInstance;
  const mouseButtons = controls.mouseButtons as MouseButtonsMap;
  const defaultButtons = cloneMouseButtons(mouseButtons);

  const resetButtons = () => {
    Object.assign(mouseButtons, cloneMouseButtons(defaultButtons));
  };

  const applyBindingsForMode = (mode: OBC.NavModeID) => {
    resetButtons();

    if (mode === "Orbit") {
      mouseButtons.left = CameraControls.ACTION.NONE;
      mouseButtons.middle = CameraControls.ACTION.ROTATE;
      mouseButtons.shiftMiddle = defaultButtons.shiftMiddle ?? CameraControls.ACTION.TRUCK;
    } else if (mode === "Plan") {
      mouseButtons.left = CameraControls.ACTION.NONE;
      mouseButtons.middle = CameraControls.ACTION.TRUCK;
      mouseButtons.shiftMiddle = defaultButtons.shiftMiddle;
    }
  };

  applyBindingsForMode(cameraScene.getNavigationMode());
  const unsubscribe = cameraScene.onNavigationModeChanged(applyBindingsForMode);

  return () => {
    unsubscribe();
    resetButtons();
  };
}
