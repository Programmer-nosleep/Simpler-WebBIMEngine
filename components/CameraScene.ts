import * as THREE from "three";
import * as OBC from "@thatopen/components";

export type CameraProjectionMode = "Perspective" | "Orthographic";

export type CameraSceneConfig = {
  background?: THREE.ColorRepresentation | null;
  lookAt?: {
    position: THREE.Vector3Tuple;
    target: THREE.Vector3Tuple;
  };
  rendererParameters?: Partial<THREE.WebGLRendererParameters>;
};

export type CameraSceneApi = {
  components: OBC.Components;
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: OBC.OrthoPerspectiveCamera;
  canvas: HTMLCanvasElement;
  setProjection: (projection: CameraProjectionMode) => Promise<void>;
  toggleProjection: () => Promise<void>;
  getProjection: () => CameraProjectionMode;
  onProjectionChanged: (handler: (projection: CameraProjectionMode) => void) => () => void;
  setNavigationMode: (mode: OBC.NavModeID) => void;
  getNavigationMode: () => OBC.NavModeID;
  onNavigationModeChanged: (handler: (mode: OBC.NavModeID) => void) => () => void;
  dispose: () => void;
};

export async function createCameraScene(
  container: HTMLElement,
  config: CameraSceneConfig = {}
): Promise<CameraSceneApi> {
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();

  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container, {
    antialias: true,
    ...config.rendererParameters,
  });
  world.renderer.mode = OBC.RendererMode.AUTO;
  world.camera = new OBC.OrthoPerspectiveCamera(components);

  components.init();
  world.scene.setup();

  if (config.background === null) {
    world.scene.three.background = null;
  } else {
    world.scene.three.background = new THREE.Color(config.background ?? 0x000000);
  }

  world.renderer.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  world.renderer.resize();
  world.camera.updateAspect();

  const lookAtPosition = config.lookAt?.position ?? [0, 0, 5];
  const lookAtTarget = config.lookAt?.target ?? [0, 0, 0];
  await world.camera.controls.setLookAt(
    ...lookAtPosition,
    ...lookAtTarget,
    true
  );

  const getProjection = () => world.camera.projection.current as CameraProjectionMode;
  const getNavigationMode = () => world.camera.mode.id as OBC.NavModeID;

  const navigationHandlers = new Set<(mode: OBC.NavModeID) => void>();
  const notifyNavigationChange = () => {
    const current = getNavigationMode();
    navigationHandlers.forEach((handler) => handler(current));
  };

  const originalNavigationSetter = world.camera.set.bind(world.camera);
  world.camera.set = ((mode: OBC.NavModeID) => {
    originalNavigationSetter(mode);
    notifyNavigationChange();
  }) as typeof world.camera.set;

  return {
    components,
    world,
    scene: world.scene.three,
    renderer: world.renderer.three,
    camera: world.camera,
    canvas: world.renderer.three.domElement as HTMLCanvasElement,
    setProjection: async (projection) => {
      await world.camera.projection.set(projection);
    },
    toggleProjection: async () => {
      await world.camera.projection.toggle();
    },
    getProjection,
    onProjectionChanged: (handler) => {
      const callback = () => handler(getProjection());
      world.camera.projection.onChanged.add(callback);
      return () => world.camera.projection.onChanged.remove(callback);
    },
    setNavigationMode: (mode) => {
      if (getNavigationMode() === mode) return;
      world.camera.set(mode);
    },
    getNavigationMode,
    onNavigationModeChanged: (handler) => {
      navigationHandlers.add(handler);
      handler(getNavigationMode());
      return () => navigationHandlers.delete(handler);
    },
    dispose: () => {
      components.dispose();
    },
  };
}
