import * as OBC from "@thatopen/components";

async function GridWorld() {
  const components = new OBC.Components();
 
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<
    OBC.SimpleScene,
    OBC.SimpleCamera,
    OBC.SimpleRenderer
  >();

  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = null;

  const container = document.getElementById("threejs") as HTMLDivElement;
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23);

  components.init();
}

function setup() {
  GridWorld();
  
}