// OpenHarvest Phase 0 canvas. Loads the demo garden's entities from the API and renders each
// one as a primitive Babylon mesh. Subsequent phases add interaction (place / move / photo /
// long-press menu) on top of this.

const DEMO_GARDEN_ID = "11111111-1111-1111-1111-111111111111";

const statusEl = document.getElementById("status");
const setStatus = (msg) => { statusEl.textContent = msg; };

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.06, 0.06, 0.07, 1);

const camera = new BABYLON.ArcRotateCamera(
  "camera",
  -Math.PI / 2,
  Math.PI / 3.5,
  10,
  new BABYLON.Vector3(0, 0, 0),
  scene
);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 2;
camera.upperRadiusLimit = 60;
camera.wheelDeltaPercentage = 0.02;

const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
light.intensity = 0.9;

// Ground grid so the user has spatial reference.
const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 30, height: 30 }, scene);
const groundMat = new BABYLON.GridMaterial("groundMat", scene);
groundMat.gridRatio = 0.5;
groundMat.mainColor = new BABYLON.Color3(0.08, 0.10, 0.10);
groundMat.lineColor = new BABYLON.Color3(0.20, 0.30, 0.20);
ground.material = groundMat;

function meshForEntity(entity) {
  const t = entity.transform || {};
  const pos = t.position || { x: 0, y: 0, z: 0 };
  const scale = t.scale || { x: 1, y: 1, z: 1 };
  const geom = entity.geometry || {};
  const kind = (geom.kind || "Box");

  let mesh;
  if (kind === "Cylinder") {
    mesh = BABYLON.MeshBuilder.CreateCylinder(
      `mesh_${entity.id}`,
      { diameter: (geom.radius || 0.5) * 2, height: geom.height || 1 },
      scene
    );
  } else {
    const size = geom.size || { x: 1, y: 1, z: 1 };
    mesh = BABYLON.MeshBuilder.CreateBox(
      `mesh_${entity.id}`,
      { width: size.x, height: size.y, depth: size.z },
      scene
    );
  }

  mesh.position = new BABYLON.Vector3(pos.x, pos.y + (geom.height || size?.y || 1) / 2, pos.z);
  mesh.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);

  const mat = new BABYLON.StandardMaterial(`mat_${entity.id}`, scene);
  mat.diffuseColor =
    entity.kind === "Plant" ? new BABYLON.Color3(0.20, 0.65, 0.15) :
    entity.kind === "Bed"   ? new BABYLON.Color3(0.45, 0.30, 0.18) :
                              new BABYLON.Color3(0.6, 0.6, 0.6);
  mesh.material = mat;

  // Floating name label.
  if (entity.name) {
    const plane = BABYLON.MeshBuilder.CreatePlane(`label_${entity.id}`, { width: 2, height: 0.6 }, scene);
    plane.parent = mesh;
    plane.position = new BABYLON.Vector3(0, (geom.height || 1) / 2 + 0.6, 0);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const tex = new BABYLON.DynamicTexture(`labelTex_${entity.id}`, { width: 256, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.drawText(entity.name, null, 44, "bold 30px sans-serif", "white", "transparent", true);

    const labelMat = new BABYLON.StandardMaterial(`labelMat_${entity.id}`, scene);
    labelMat.diffuseTexture = tex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.emissiveColor = BABYLON.Color3.White();
    labelMat.disableLighting = true;
    labelMat.backFaceCulling = false;
    plane.material = labelMat;
  }
}

async function loadEntities() {
  setStatus("fetching entities...");
  const url = `/api/v1/gardens/${DEMO_GARDEN_ID}/entities`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) {
    setStatus(`API error ${res.status}`);
    return;
  }
  const entities = await res.json();
  setStatus(`loaded ${entities.length} entities`);
  entities.forEach(meshForEntity);
}

window.addEventListener("resize", () => engine.resize());
engine.runRenderLoop(() => scene.render());

loadEntities().catch((e) => {
  console.error(e);
  setStatus("failed to load — see console");
});
