// OpenHarvest Phase 1 canvas. The decorating is the data model.
//
// State machine:
//   idle → click "Bed" → bedFirstCorner → bedSecondCorner → idle (POST entity, exit place mode)
//   idle → click "Plant" → plantPick → autocomplete modal → idle (POST entity, exit place mode)
//   idle → long-press entity → radialOpen → action → idle
//
// Anonymous-first: garden id stored in localStorage. If absent, POST a new garden on first load.

(() => {
  // ---------- base URL ----------
  // Resolve every API/SignalR URL against the document's <base href>. This makes the app
  // portable between root deployments (https://openharvest.nexus/) and sub-path deployments
  // (https://nexus.example/openharvest/) without per-environment config. BASE always ends
  // with a trailing slash, so callers append paths WITHOUT a leading slash:
  //   fetch(BASE + "api/v1/gardens")
  const BASE = (() => {
    const u = new URL("./", document.baseURI);
    return u.pathname; // ends with /
  })();

  // ---------- API ----------
  const Api = {
    async createGarden() {
      const res = await fetch(BASE + "api/v1/gardens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Garden" })
      });
      if (!res.ok) throw new Error("createGarden failed: " + res.status);
      return res.json();
    },
    async getGarden(gid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}`);
      if (!res.ok) return null;
      return res.json();
    },
    async updateGarden(gid, body) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("updateGarden failed: " + res.status);
      return res.json();
    },
    async getEntities(gid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities`);
      if (!res.ok) throw new Error("getEntities failed: " + res.status);
      return res.json();
    },
    async addEntity(gid, body) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("addEntity failed: " + res.status);
      return res.json();
    },
    async updateEntity(gid, eid, body) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities/${eid}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("updateEntity failed: " + res.status);
      return res.json();
    },
    async deleteEntity(gid, eid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities/${eid}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("deleteEntity failed: " + res.status);
    },
    async searchCrops(q) {
      const res = await fetch(`${BASE}api/v1/crops?q=${encodeURIComponent(q || "")}&limit=12`);
      if (!res.ok) return [];
      return res.json();
    },
    async listPhotos(gid, eid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities/${eid}/photos`);
      if (!res.ok) return [];
      return res.json();
    },
    async uploadPhoto(gid, eid, file) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities/${eid}/photos`, {
        method: "POST", body: fd
      });
      if (!res.ok) throw new Error("uploadPhoto failed: " + res.status);
      return res.json();
    },
    async deletePhoto(gid, eid, pid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/entities/${eid}/photos/${pid}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("deletePhoto failed: " + res.status);
    },
    async advisorStatus() {
      try {
        const res = await fetch(BASE + "api/v1/advisor/status");
        return res.ok ? res.json() : { configured: false };
      } catch { return { configured: false }; }
    },
    async ask(gid, question) {
      const res = await fetch(BASE + "api/v1/advisor/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gardenId: gid, question })
      });
      if (!res.ok) throw new Error("ask failed: " + res.status);
      return res.json();
    },
    async diagnose(gid, eid, file, description) {
      const fd = new FormData();
      fd.append("file", file);
      if (description) fd.append("description", description);
      const res = await fetch(`${BASE}api/v1/advisor/diagnose/${gid}/${eid}`, {
        method: "POST", body: fd
      });
      if (!res.ok) throw new Error("diagnose failed: " + res.status);
      return res.json();
    },
    async calendar(gid) {
      const res = await fetch(`${BASE}api/v1/advisor/calendar/${gid}`);
      if (!res.ok) throw new Error("calendar failed: " + res.status);
      return res.json();
    },
    async scanNudges(gid) {
      const res = await fetch(`${BASE}api/v1/advisor/nudges/${gid}`);
      if (!res.ok) return [];
      return res.json();
    },
    // Phase 5.5 — AI-assisted placement planner. POSTs the slugs the user wants placed, gets
    // back a PlacementPlan { provider, model, suggestions[], summary }. Suggestions carry an
    // (x, z) world-space coord plus an optional parentEntityId — the PWA then renders them
    // as ghost markers in the scene and commits them as Plant entities on user tap.
    async planPlacement(gid, crops) {
      const res = await fetch(`${BASE}api/v1/advisor/plan/${gid}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crops })
      });
      if (!res.ok) throw new Error("plan failed: " + res.status);
      return res.json();
    },
    // Phase 5.4 — user-saved prefab templates ("My Prefabs"). The body for saveCustomPrefab
    // pre-stringifies geometry + tags so the server can store them as opaque JSON blobs without
    // re-parsing — keeps the schema flexible and means a future geometry kind doesn't need a
    // server change.
    async listCustomPrefabs(gid) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/prefabs`);
      if (!res.ok) return [];
      return res.json();
    },
    async saveCustomPrefab(gid, body) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/prefabs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save prefab failed: " + res.status);
      return res.json();
    },
    async deleteCustomPrefab(gid, id) {
      const res = await fetch(`${BASE}api/v1/gardens/${gid}/prefabs/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("delete prefab failed: " + res.status);
    },
  };

  // ---------- bootstrap garden id ----------
  const STORAGE_KEY = "openharvest.gardenId.v1";
  async function ensureGarden() {
    let id = localStorage.getItem(STORAGE_KEY);
    if (id) return id;
    const garden = await Api.createGarden();
    localStorage.setItem(STORAGE_KEY, garden.id);
    return garden.id;
  }

  // ---------- DOM ----------
  const statusEl = document.getElementById("status");
  const buttons = document.getElementById("buttons").querySelectorAll("button");
  const radial = document.getElementById("radial");

  let statusTimer = 0;
  const setStatus = (msg, hideAfter = 2500) => {
    statusEl.textContent = msg;
    statusEl.classList.remove("hide");
    clearTimeout(statusTimer);
    if (hideAfter > 0) {
      statusTimer = setTimeout(() => statusEl.classList.add("hide"), hideAfter);
    }
  };

  // ---------- Babylon scene ----------
  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.06, 0.06, 0.07, 1);

  const camera = new BABYLON.ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3.5,
    14,
    new BABYLON.Vector3(0, 0, 0),
    scene
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 80;
  camera.wheelDeltaPercentage = 0.02;
  // Phase 5.2.2 (B2) — touch-tuned camera sensitivity. ArcRotateCamera defaults are calibrated
  // for desktop mice; on a phone they make the camera "whip" with a small finger drag, which
  // testers consistently flagged. Higher angularSensibility = LESS sensitive (it's a divisor),
  // and pinchPrecision/wheelPrecision both increase smoothness for zoom. panningSensibility
  // also raised so two-finger pan doesn't slingshot the world.
  camera.angularSensibilityX = 4000;
  camera.angularSensibilityY = 4000;
  camera.panningSensibility = 1500;
  camera.pinchPrecision = 50;
  camera.wheelPrecision = 50;

  // Phase 5.1: split lighting into a directional "sun" (animated by SunCalc against
  // wall clock + garden lat/lng) and a low-intensity hemispheric "sky" fill so things
  // never go pitch black at night. The sun's direction and intensity are updated by
  // updateSun(); sensible defaults below cover the first frame before the first call.
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;
  sun.diffuse = new BABYLON.Color3(1.0, 0.96, 0.86);
  sun.specular = new BABYLON.Color3(1.0, 0.96, 0.86);

  const sky = new BABYLON.HemisphericLight("sky", new BABYLON.Vector3(0, 1, 0), scene);
  sky.intensity = 0.30;
  sky.diffuse = new BABYLON.Color3(0.65, 0.78, 1.0);
  sky.groundColor = new BABYLON.Color3(0.20, 0.22, 0.18);

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 60, height: 60 }, scene);
  const groundMat = new BABYLON.GridMaterial("groundMat", scene);
  groundMat.gridRatio = 0.5;
  groundMat.mainColor = new BABYLON.Color3(0.08, 0.10, 0.10);
  groundMat.lineColor = new BABYLON.Color3(0.20, 0.30, 0.20);
  ground.material = groundMat;
  ground.metadata = { isGround: true };

  // Phase 5.2.2 (B6) — snap grid overlay. A second, transparent ground plane sits a hair above
  // the main ground, with a GridMaterial whose gridRatio matches the active snap interval.
  // Visible only when snap > 0 so the user gets a "where will it land" hint while dragging or
  // placing without cluttering the scene the rest of the time. Not pickable so it doesn't
  // interfere with placement raycasts (which target the underlying ground mesh).
  const snapGrid = BABYLON.MeshBuilder.CreateGround("snapGrid", { width: 60, height: 60 }, scene);
  snapGrid.position.y = 0.01;
  snapGrid.isPickable = false;
  const snapGridMat = new BABYLON.GridMaterial("snapGridMat", scene);
  snapGridMat.majorUnitFrequency = 5;
  snapGridMat.minorUnitVisibility = 0.35;
  snapGridMat.gridRatio = 1.0;          // updated by refreshSnapGrid()
  snapGridMat.mainColor = new BABYLON.Color3(0, 0, 0);
  snapGridMat.lineColor = new BABYLON.Color3(0.45, 0.85, 0.55);
  snapGridMat.opacity = 0.0;
  snapGridMat.backFaceCulling = false;
  snapGrid.material = snapGridMat;
  snapGrid.metadata = { isSnapGrid: true };

  function refreshSnapGrid() {
    if (!snapGridMat) return;
    if (snapFt > 0) {
      snapGridMat.gridRatio = snapFt;
      snapGridMat.opacity = 0.85;
      snapGrid.setEnabled(true);
    } else {
      snapGridMat.opacity = 0.0;
      snapGrid.setEnabled(false);
    }
  }

  // ---------- entity → mesh registry ----------
  /** @type {Map<string, {entity:any, mesh:BABYLON.Mesh, label:BABYLON.Mesh|null}>} */
  const meshRegistry = new Map();

  function disposeEntity(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    // Phase 5.3 — detach REGISTERED children before disposing the parent. Babylon's
    // Mesh.dispose() with default doNotRecurse=false would otherwise drag every parented
    // child mesh into the grave, but those children are tracked separately in meshRegistry
    // and getting recreated by an upsert/resize flow shouldn't take their pots and plants
    // with them. Each registered child's mesh is reparented to scene root with its current
    // absolutePosition preserved.
    if (rec.mesh && !rec.mesh.isDisposed()) {
      for (const [, child] of meshRegistry) {
        if (child.mesh?.parent !== rec.mesh) continue;
        child.mesh.computeWorldMatrix(true);
        const ap = child.mesh.absolutePosition.clone();
        child.mesh.parent = null;
        child.mesh.position = ap;
      }
      // Phase 5.2.2 (A3) — actively dispose any UNREGISTERED Babylon child meshes. Prefab
      // builders that hit the mergeAndName fallback path (or any future builder that parents
      // sub-meshes without a meshRegistry entry) leave orphans behind when only the parent is
      // disposed with default args, which is the "leftover piece after delete" symptom.
      // We snapshot the child list because dispose() mutates it.
      const orphans = rec.mesh.getChildMeshes(false).slice();
      for (const orphan of orphans) {
        if (orphan.isDisposed()) continue;
        // Skip registered children — those were already reparented above.
        const oid = orphan.metadata?.entityId;
        if (oid && meshRegistry.has(oid)) continue;
        orphan.dispose(false, true);
      }
    }
    rec.label?.dispose(false, true);
    // Phase 5.2.2 (A1, A3) — dispose materials + textures owned by the entity mesh. Without
    // disposeMaterialAndTextures=true, materials linger and (more importantly) any GPU-side
    // resources the mesh held are kept alive, which compounds with the duplicate-mesh symptom
    // when an upsert race leaves an "old" mesh behind.
    rec.mesh.dispose(false, true);
    meshRegistry.delete(eid);
    // Phase 5.2.2 (A1) — paranoid sweep: walk the live scene for any mesh tagged with this
    // entityId that survived the dispose chain (e.g. because a prior race left an orphan
    // mesh whose registry entry was overwritten). One last broom pass keeps the scene clean
    // even when upstream code paths slip up.
    for (let i = scene.meshes.length - 1; i >= 0; i--) {
      const m = scene.meshes[i];
      if (m && !m.isDisposed() && m.metadata?.entityId === eid) {
        m.dispose(false, true);
      }
    }
  }

  function meshForEntity(entity) {
    if (!entity || !entity.id) return null;
    // Phase 5.2.2 (A1) — make meshForEntity idempotent against the create-flow race. The local
    // create path (createBed/createPlant/createPrefab/createCustomPrefabInstance) calls
    // meshForEntity right after addEntity returns. The SignalR `entityUpserted` handler also
    // calls applyEntityUpsert → meshForEntity. If the SignalR broadcast lands BEFORE the local
    // meshForEntity invocation, we'd otherwise end up with two meshes for one id (registry
    // entry overwritten, original orphaned in the scene). Guard here so whoever races second
    // still gets a clean rebuild.
    if (meshRegistry.has(entity.id)) disposeEntity(entity.id);

    const t = entity.transform || {};
    const pos = t.position || { x: 0, y: 0, z: 0 };
    const scale = t.scale || { x: 1, y: 1, z: 1 };
    // Phase 6.1 — rotation is stored as a Babylon-convention quaternion (x, y, z, w). Older
    // entities (or freshly-placed ones via legacy code paths) may have w === 0 or no rotation
    // field at all; treat that as identity so the mesh doesn't render flipped or invisible.
    const rotRaw = t.rotation || {};
    const rot = (rotRaw.w === undefined || rotRaw.w === null)
      ? { x: 0, y: 0, z: 0, w: 1 }
      : { x: +rotRaw.x || 0, y: +rotRaw.y || 0, z: +rotRaw.z || 0, w: +rotRaw.w };
    if (rot.x === 0 && rot.y === 0 && rot.z === 0 && rot.w === 0) rot.w = 1;
    const geom = entity.geometry || {};
    const kind = geom.kind || "Box";

    // Phase 5.3 — parent lookup. Server-side positions are world-space (no migration);
    // when a parent mesh exists in the registry, we re-parent the child in Babylon and
    // express its position relative to the parent. Babylon's TransformNode chain then
    // makes children visually follow parent transforms during drag without per-child
    // PATCHes mid-drag. If the parent isn't in the registry yet (race during initial
    // load order), we fall back to world-space; the next applyEntityUpsert for this
    // entity (or a manual rebuild) will re-attach.
    const parentRec = entity.parentId ? meshRegistry.get(entity.parentId) : null;

    let mesh;
    let yOffset = 0;
    let assignDefaultMaterial = true;
    if (kind === "Prefab") {
      // Phase 5.2: hand off mesh construction to the prefab library. The builder anchors the
      // mesh at its own ground origin (y = 0 at the bottom of the footprint), so we don't
      // need a yOffset like Box/Cylinder do. If the prefabRef is unknown — ref drift, typo,
      // or an old save from a removed prefab — fall back to a labelled grey box so the entity
      // is still selectable + editable rather than vanishing from the scene.
      const lib = window.OpenHarvestPrefabs || {};
      const def_ = lib[geom.prefabRef];
      if (def_ && typeof def_.build === "function") {
        const size = geom.size || def_.defaultSize;
        try {
          mesh = def_.build(BABYLON, scene, `mesh_${entity.id}`, size);
        } catch (err) {
          console.error("prefab build failed", geom.prefabRef, err);
          mesh = null;
        }
      }
      if (!mesh) {
        const fallbackSize = (def_ && def_.defaultSize) || { x: 2, y: 1, z: 2 };
        mesh = BABYLON.MeshBuilder.CreateBox(`mesh_${entity.id}`, {
          width: fallbackSize.x, height: fallbackSize.y, depth: fallbackSize.z,
        }, scene);
        yOffset = fallbackSize.y / 2;
      } else {
        // Builder already placed primitives at the correct y; the prefab's local origin is at
        // ground level. Materials are owned by the prefab — don't stomp them.
        assignDefaultMaterial = false;
      }
    } else if (kind === "Cylinder") {
      const h = geom.height || 1;
      mesh = BABYLON.MeshBuilder.CreateCylinder(`mesh_${entity.id}`,
        { diameter: (geom.radius || 0.5) * 2, height: h }, scene);
      yOffset = h / 2;
    } else {
      const size = geom.size || { x: 1, y: 1, z: 1 };
      mesh = BABYLON.MeshBuilder.CreateBox(`mesh_${entity.id}`,
        { width: size.x, height: size.y, depth: size.z }, scene);
      yOffset = size.y / 2;
    }
    // World-space target position (where the mesh should appear in the scene).
    const worldX = pos.x;
    const worldY = pos.y + yOffset;
    const worldZ = pos.z;
    if (parentRec && parentRec.mesh && !parentRec.mesh.isDisposed()) {
      // Phase 5.3 — express the child's position in PARENT-LOCAL coordinates so Babylon's
      // scene graph carries it through any future parent moves. parent.absolutePosition is
      // the world-space anchor of the parent mesh; subtracting yields the local offset.
      mesh.parent = parentRec.mesh;
      const ap = parentRec.mesh.absolutePosition;
      mesh.position = new BABYLON.Vector3(worldX - ap.x, worldY - ap.y, worldZ - ap.z);
    } else {
      mesh.position = new BABYLON.Vector3(worldX, worldY, worldZ);
    }
    mesh.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);
    // Phase 6.1 — apply the entity's stored rotation as a quaternion. We do this AFTER the
    // prefab builder returns so the entity transform always wins over any rotation the
    // builder may have left on the mesh (the house primitives don't, but future prefabs
    // might). Babylon ignores `mesh.rotation` once `rotationQuaternion` is set, which is the
    // behavior we want — Euler drift is a known Babylon footgun.
    mesh.rotationQuaternion = new BABYLON.Quaternion(rot.x, rot.y, rot.z, rot.w);
    // Phase 6.1 — preserve any builder-set flags (isWall, isShelf, isFloor) onto the canonical
    // pickable mesh so wall/shelf snapping in app.js can find them by walking meshRegistry.
    // The cut-away toggle already walks scene meshes for isWall, so it tolerated builder flags
    // sitting on internal child meshes — but the new snap helpers want a one-pass-on-registry
    // shortcut, so we promote the flag to the parent.
    const builderMeta = mesh.metadata || {};
    mesh.metadata = {
      entityId: entity.id,
      kind: entity.kind,
      yOffset,
      isWall: !!builderMeta.isWall,
      isShelf: !!builderMeta.isShelf,
      isFloor: !!builderMeta.isFloor,
    };
    mesh.isPickable = true;

    if (assignDefaultMaterial) {
      const mat = new BABYLON.StandardMaterial(`mat_${entity.id}`, scene);
      mat.diffuseColor =
        entity.kind === "Plant" ? new BABYLON.Color3(0.20, 0.65, 0.15) :
        entity.kind === "Bed"   ? new BABYLON.Color3(0.45, 0.30, 0.18) :
                                  new BABYLON.Color3(0.6, 0.6, 0.6);
      mesh.material = mat;
    }

    // Phase 5.2.2 (B5) — per-instance color tint. The user-chosen color (stored in
    // entity.extensions.color as a #RRGGBB string) overrides the dominant material's
    // diffuseColor for THIS mesh only. For Box-geometry beds the entity owns its own
    // StandardMaterial (created above), so we mutate it directly. For prefab merged
    // meshes the material is a MultiMaterial sharing slots with the rest of the scene's
    // prefabs; we clone and replace the dominant slot so other instances stay untouched.
    const colorHex = entity.extensions?.color;
    if (colorHex && typeof colorHex === "string") {
      try { applyEntityColor(mesh, colorHex, entity.id); }
      catch (e) { console.warn("color tint failed", entity.id, e); }
    }

    let label = null;
    if (entity.name) {
      label = makeLabel(entity.id, entity.name, mesh, geom);
    }
    meshRegistry.set(entity.id, { entity, mesh, label });

    // Phase 6.0 — if this is a wall mesh and cut-away is currently active, fade it on the
    // way in so locally-placed walls (or initial-load walls) don't pop opaque for a frame
    // before the next refresh sweep. Cheap: the cut-away walker is O(materials) and walls
    // share one StandardMaterial, so this runs at most once per material per scene.
    // (cutawayActive + helpers are declared later in this IIFE; they're always initialised by
    // the time meshForEntity is called from the async bootstrap or SignalR callbacks.)
    if (cutawayActive && mesh?.metadata?.isWall) {
      applyCutawayToMaterial(mesh.material, CUTAWAY_ALPHA);
    }

    // Phase 5.3 — re-attach orphaned children. If this newly created mesh is the parent for
    // any already-loaded children (load order can deliver children before their parent), pull
    // each child back into the scene graph and convert its position into parent-local space
    // so it ends up in the same world spot.
    for (const [, childRec] of meshRegistry) {
      if (childRec.entity?.parentId !== entity.id) continue;
      if (!childRec.mesh || childRec.mesh.isDisposed()) continue;
      if (childRec.mesh.parent === mesh) continue;
      const childWorld = childRec.mesh.absolutePosition.clone();
      childRec.mesh.parent = mesh;
      const ap = mesh.absolutePosition;
      childRec.mesh.position = new BABYLON.Vector3(
        childWorld.x - ap.x,
        childWorld.y - ap.y,
        childWorld.z - ap.z,
      );
    }
    return mesh;
  }

  // Phase 5.2.2 (B5) — color helpers. parseHexColor returns null for malformed input so the
  // caller can fall back to the prefab's built-in palette without crashing the mesh build.
  function parseHexColor(hex) {
    if (!hex || typeof hex !== "string") return null;
    let s = hex.trim();
    if (s.startsWith("#")) s = s.slice(1);
    if (s.length === 3) s = s.split("").map(c => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    const r = parseInt(s.slice(0, 2), 16) / 255;
    const g = parseInt(s.slice(2, 4), 16) / 255;
    const b = parseInt(s.slice(4, 6), 16) / 255;
    return new BABYLON.Color3(r, g, b);
  }

  // Override the dominant material's diffuseColor for this mesh. We clone before mutating so
  // the shared prefab material cache stays clean — other beds keep their wood/terracotta
  // defaults. For MultiMaterial meshes (prefab merge with multiple materials) we tint only the
  // FIRST sub-material; soil / glass / metal accents stay their natural color so the user's
  // tint reads as "wood color" or "pot color" rather than monotone repaint.
  function applyEntityColor(mesh, hex, eid) {
    const c = parseHexColor(hex);
    if (!c || !mesh) return;
    const mat = mesh.material;
    if (!mat) return;
    if (mat instanceof BABYLON.MultiMaterial) {
      const subs = (mat.subMaterials || []).slice();
      if (subs.length === 0) return;
      const cloned = mat.clone(`mat_${eid}_tinted`, true);
      // The clone keeps the same sub-material array — tint the first non-null entry.
      for (let i = 0; i < cloned.subMaterials.length; i++) {
        const sm = cloned.subMaterials[i];
        if (!sm) continue;
        const smc = sm.clone(`${sm.name}_${eid}`);
        if (smc.diffuseColor) smc.diffuseColor = c;
        cloned.subMaterials[i] = smc;
        break; // only tint the dominant slot
      }
      mesh.material = cloned;
    } else {
      const cloned = mat.clone(`mat_${eid}_tinted`);
      if (cloned.diffuseColor) cloned.diffuseColor = c;
      mesh.material = cloned;
    }
  }

  function makeLabel(eid, name, parentMesh, geom) {
    // Prefabs anchor their mesh at ground (y=0 at the floor of the footprint), so the label
    // needs to sit at full geometry height + clearance. Box/Cylinder mesh origins are at the
    // mesh centre, so the label only needs half-height + clearance. The prefab branch keys
    // off geometry.kind so we don't accidentally double-shift other future kinds.
    const isPrefab = geom?.kind === "Prefab";
    const labelHeight = isPrefab
      ? (geom.size?.y || 1) + 0.6
      : ((geom.height || 0) + (geom.size?.y || 0)) / 2 + 0.6;
    const plane = BABYLON.MeshBuilder.CreatePlane(`label_${eid}`, { width: 2.5, height: 0.7 }, scene);
    plane.parent = parentMesh;
    plane.position = new BABYLON.Vector3(0, labelHeight, 0);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const tex = new BABYLON.DynamicTexture(`labelTex_${eid}`, { width: 256, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.drawText(name, null, 44, "bold 28px sans-serif", "white", "transparent", true);

    const labelMat = new BABYLON.StandardMaterial(`labelMat_${eid}`, scene);
    labelMat.diffuseTexture = tex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.emissiveColor = BABYLON.Color3.White();
    labelMat.disableLighting = true;
    labelMat.backFaceCulling = false;
    plane.material = labelMat;
    plane.isPickable = false;
    return plane;
  }

  // ---------- mode state ----------
  const Mode = {
    Idle: "idle",
    BedFirstCorner: "bed-1",
    BedSecondCorner: "bed-2",
    PlantPick: "plant-pick",
    PrefabPick: "prefab-pick",
    Move: "move",
  };
  let mode = Mode.Idle;
  let bedFirst = null;
  let bedPreview = null;
  // Phase 5.2: while in PrefabPick mode, the prefab the user selected from the picker. The
  // next ground tap reads this and POSTs an entity with geometry.kind = "Prefab". Cleared on
  // exit from PrefabPick (via setMode(Idle)).
  let pendingPrefabRef = null;
  // Phase 5.4: while in PrefabPick mode, a saved "My Prefab" template if one was picked
  // (mutually exclusive with pendingPrefabRef — whichever is non-null wins on placement).
  let pendingCustomPrefab = null;

  // ---------- Phase 5.0 selection state ----------
  // selectedEntityId is the id of the entity currently shown in the toolbar.
  // lastSelectedMesh is tracked separately so we can clear the outline cleanly even when the
  // mesh has been disposed and recreated by the upsert pipeline.
  let selectedEntityId = null;
  let lastSelectedMesh = null;

  // ---------- Phase 5.2.1 units + snap state ----------
  // Storage on the server is always feet (the engine unit). The frontend converts on display
  // and converts back on save, so all PATCH bodies are in ft regardless of the chosen unit.
  // Snap is also stored as feet (the on-grid quantum). 0 means "off".
  const UnitFactor = { ft: 1, in: 12, cm: 30.48 };
  const UnitCycle = ["ft", "in", "cm"];
  const SnapCycle = [
    { label: "off",   ft: 0 },
    { label: "1 in",  ft: 1 / 12 },
    { label: "6 in",  ft: 0.5 },
    { label: "1 ft",  ft: 1 },
    { label: "30 cm", ft: 30 / 30.48 },
  ];
  let currentUnit = localStorage.getItem("openharvest.unit") || "ft";
  if (!UnitFactor[currentUnit]) currentUnit = "ft";
  let snapFt = parseFloat(localStorage.getItem("openharvest.snap")) || 0;
  if (!isFinite(snapFt) || snapFt < 0) snapFt = 0;

  function fromFt(v, unit = currentUnit) { return v * UnitFactor[unit]; }
  function toFt(v, unit = currentUnit)   { return v / UnitFactor[unit]; }
  function applySnap(v, snap = snapFt)   { return snap > 0 ? Math.round(v / snap) * snap : v; }
  function applySnapVec(p) {
    return { x: applySnap(p.x), y: p.y, z: applySnap(p.z) };
  }
  function formatNum(v) {
    // 2 decimals for ft (sub-foot resolution matters for raised beds), 1 for in/cm where
    // values are already chunkier and 1.4 cm vs 1.42 cm is noise.
    const dp = currentUnit === "ft" ? 2 : 1;
    return (+v).toFixed(dp).replace(/\.?0+$/, "") || "0";
  }
  function formatPos(p) {
    if (!p) return `(0, 0, 0) ${currentUnit}`;
    const x = formatNum(fromFt(+p.x || 0));
    const y = formatNum(fromFt(+p.y || 0));
    const z = formatNum(fromFt(+p.z || 0));
    return `(${x}, ${y}, ${z}) ${currentUnit}`;
  }
  function snapLabel() {
    const found = SnapCycle.find(s => Math.abs(s.ft - snapFt) < 1e-6);
    return found ? found.label : "off";
  }

  function setMode(next) {
    mode = next;
    buttons.forEach(b => b.classList.toggle("active",
      (next.startsWith("bed-") && b.dataset.mode === "bed") ||
      (next === Mode.PlantPick && b.dataset.mode === "plant") ||
      (next === Mode.PrefabPick && b.dataset.mode === "prefab")));
    canvas.style.cursor = (next === Mode.Idle) ? "" : "crosshair";
    if (next === Mode.Idle) {
      bedFirst = null;
      if (bedPreview) { bedPreview.dispose(); bedPreview = null; }
      pendingPrefabRef = null;
      pendingCustomPrefab = null;
    }
  }

  // ---------- buttons ----------
  buttons.forEach(b => {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      const m = b.dataset.mode;
      if (m === "bed") {
        if (mode.startsWith("bed-")) { setMode(Mode.Idle); setStatus("place-mode off"); return; }
        setMode(Mode.BedFirstCorner);
        setStatus("tap two corners on the ground to place a bed");
      } else if (m === "plant") {
        if (mode === Mode.PlantPick) { setMode(Mode.Idle); setStatus("place-mode off"); return; }
        setMode(Mode.PlantPick);
        setStatus("tap a spot to place a plant");
      } else if (m === "prefab") {
        // Toggling the prefab button while already in PrefabPick exits placement.
        if (mode === Mode.PrefabPick) { setMode(Mode.Idle); setStatus("place-mode off"); return; }
        // Open the picker first; on selection we enter PrefabPick mode and arm the next ground tap.
        openPrefabPickerModal();
      }
    });
  });

  // ---------- ground picking ----------
  function pickGround() {
    const pick = scene.pick(scene.pointerX, scene.pointerY,
      (m) => m === ground);
    if (!pick.hit) return null;
    return pick.pickedPoint;
  }

  function pickEntity() {
    // Phase 5.2.2 (A2) — use multiPick + nearest-hit selection so two beds whose bounding
    // boxes overlap in screen space don't end up with picking order determined by mesh
    // creation order. multiPickWithRay returns every triangle-test hit along the ray; we
    // pick the one with the smallest distance and a metadata.entityId. This also guards
    // against future prefab builders that include hidden faces (e.g., a shadow plane) — as
    // long as those faces sit at the same depth or behind the visible geometry, the visible
    // surface wins. Falls back to scene.pick if multiPick is unavailable for some reason.
    const predicate = (m) => m && m.metadata && m.metadata.entityId && m.isPickable;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const hits = scene.multiPickWithRay(ray, predicate);
    if (!hits || hits.length === 0) return null;
    let best = null;
    for (const h of hits) {
      if (!h.hit || !h.pickedMesh) continue;
      if (best === null || h.distance < best.distance) best = h;
    }
    return best ? best.pickedMesh : null;
  }

  // ---------- pointer handlers ----------
  let pressTimer = 0;
  let pressMesh = null;
  let pressMoved = false;
  let pressOrigin = { x: 0, y: 0 };

  scene.onPointerObservable.add((info) => {
    // While in Move mode, the dedicated drag-and-drop observer (registered inside
    // startMove) owns pointer events. Skip the long-press / placement plumbing here so we
    // don't re-arm the radial menu mid-drag or fire an entity-pick on commit.
    if (mode === Mode.Move) return;
    const ev = info.event;
    if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      pressMoved = false;
      pressOrigin = { x: scene.pointerX, y: scene.pointerY };
      const m = pickEntity();
      if (m && mode === Mode.Idle) {
        pressMesh = m;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          if (pressMesh && !pressMoved) {
            openRadial(pressMesh.metadata.entityId, ev.clientX, ev.clientY);
          }
        }, 500);
      }
    } else if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const dx = scene.pointerX - pressOrigin.x;
      const dy = scene.pointerY - pressOrigin.y;
      if (dx * dx + dy * dy > 100) pressMoved = true;
    } else if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
      clearTimeout(pressTimer);
      const wasPress = !!pressMesh && !pressMoved;
      pressMesh = null;
      if (mode === Mode.BedFirstCorner) {
        const p = pickGround();
        if (p) { bedFirst = p; setMode(Mode.BedSecondCorner); setStatus("tap the opposite corner"); }
      } else if (mode === Mode.BedSecondCorner) {
        const p = pickGround();
        if (p && bedFirst) {
          createBed(bedFirst, p).catch(err => { console.error(err); setStatus("failed to create bed"); });
          setMode(Mode.Idle);
        }
      } else if (mode === Mode.PlantPick) {
        const p = pickGround();
        if (p) {
          openPlantModal(p);
          setMode(Mode.Idle);
        }
      } else if (mode === Mode.PrefabPick) {
        // Phase 5.2: a built-in prefab was selected; this tap places it.
        // Phase 5.4: a saved template can also be armed (pendingCustomPrefab) — we route to
        // the custom-instance creator instead. Whichever pending slot is non-null wins;
        // built-in path is the fallback to keep existing behavior identical.
        const p = pickGround();
        if (p && pendingCustomPrefab) {
          createCustomPrefabInstance(p, pendingCustomPrefab).catch(err => { console.error(err); setStatus("failed to place template"); });
          setMode(Mode.Idle);
        } else if (p && pendingPrefabRef) {
          createPrefab(p, pendingPrefabRef).catch(err => { console.error(err); setStatus("failed to place prefab"); });
          setMode(Mode.Idle);
        } else if (p) {
          setMode(Mode.Idle);
        }
      } else if (mode === Mode.Idle) {
        // Phase 5.0: short-tap selection. The long-press timer was already cleared above; if
        // wasPress is true, the user tapped on an entity briefly without dragging — select
        // it. If they tapped on ground or empty space, clear the current selection.
        if (wasPress) {
          // pressMesh is already nulled, but we know the tap was on an entity from wasPress.
          // Re-pick at the current pointer to get the mesh under release. (Pick is cheap.)
          const m = pickEntity();
          if (m && m.metadata?.entityId) {
            selectEntity(m.metadata.entityId);
          } else {
            clearSelection();
          }
        } else {
          // No press-on-entity. If the release is on ground (and wasn't a camera drag), clear.
          // pressOrigin guards against accidental clears mid-pan: only clear on near-stationary tap.
          const dx = scene.pointerX - pressOrigin.x;
          const dy = scene.pointerY - pressOrigin.y;
          if (dx * dx + dy * dy <= 100) {
            const m = pickEntity();
            if (!m) clearSelection();
          }
        }
      }
    }
  });

  // ---------- create bed ----------
  let gardenId = null;

  async function createBed(p1, p2) {
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    const minZ = Math.min(p1.z, p2.z), maxZ = Math.max(p1.z, p2.z);
    const w = Math.max(0.5, maxX - minX);
    const d = Math.max(0.5, maxZ - minZ);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    // Phase 5.2.1: snap-to-grid quantizes the centre + size on placement so freshly placed
    // beds line up with previously placed entities under the same snap setting.
    const snapped = applySnapVec({ x: cx, y: 0, z: cz });
    const body = {
      kind: "Bed",
      name: "Bed",
      transform: {
        position: snapped,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: "Box", size: { x: applySnap(w) || w, y: 0.4, z: applySnap(d) || d } }
    };
    setStatus("placing bed...");
    const created = await Api.addEntity(gardenId, body);
    meshForEntity(created);
    setStatus(`placed bed (${w.toFixed(1)}×${d.toFixed(1)})`);
  }

  async function createPlant(p, crop) {
    // Phase 6.1 — when the user taps within the screen-space footprint of a shelf top, the
    // plant should land ON THE SHELF, not on the floor below. We do a screen-ray test against
    // each registered shelf BEFORE falling back to bed lookup (since the shelf's top is above
    // ground, pickGround() returned the floor point — we have to ray-test the shelf plane
    // separately to know whether the user actually aimed at the shelf).
    const shelf = pickShelfFromScreen?.();
    let parentId, position;
    if (shelf) {
      parentId = shelf.shelfId;
      // Snap XZ to grid, but keep Y at the shelf's top so the plant stands on the plank
      // rather than half-buried in it. Use the screen-ray hit point (already constrained to
      // the shelf's footprint) instead of `p` — `p` is the floor projection and would put the
      // plant in the wrong XZ once parented.
      const sx = applySnap(shelf.hitPoint.x);
      const sz = applySnap(shelf.hitPoint.z);
      position = { x: sx, y: shelf.top, z: sz };
    } else {
      // Find the bed underneath, if any, to set ParentId — Phase 1 hierarchy enforcement is
      // loose: we attach to whichever bed contains the click point, else null.
      parentId = findContainingBed(p);
      position = applySnapVec({ x: p.x, y: 0, z: p.z });
    }
    const body = {
      kind: "Plant",
      name: crop ? crop.commonName : "Plant",
      cropRef: crop ? crop.slug : null,
      parentId: parentId,
      transform: {
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: "Cylinder", radius: 0.25, height: 1.0 }
    };
    setStatus("placing plant...");
    const created = await Api.addEntity(gardenId, body);
    meshForEntity(created);
    setStatus(shelf ? `placed ${created.name} on shelf` : `placed ${created.name}`);
  }

  // Phase 5.2: place a prefab entity at point p. Stores Geometry as kind=Prefab + prefabRef +
  // a default-size override copied from the prefab definition so the server has a faithful
  // record of the on-load footprint (the edit panel can shrink/grow it later).
  async function createPrefab(p, prefabRef) {
    const lib = window.OpenHarvestPrefabs || {};
    const prefab = lib[prefabRef];
    if (!prefab) { setStatus("unknown prefab: " + prefabRef); return; }
    // Prefabs default to the "Bed" semantic kind — users place them into the world the same
    // way as raised beds. A future Phase could introduce a "Prefab" entity kind, but reusing
    // Bed lets the existing parent-of-plant logic work without a backend migration.
    const snapped = applySnapVec({ x: p.x, y: 0, z: p.z });
    // Phase 5.3 — pots sit on top of shelves/beds; raised beds don't nest. The category is the
    // cleanest discriminator since prefab slugs come and go. Pots get a Y-aware lookup so a pot
    // placed near a tall shelf snaps to it; everything else is treated as a free-standing
    // container (no auto-parent) — placing a raised bed inside another bed almost always means
    // the user wants two adjacent beds, not a nested one.
    const isPot = prefab.category === "Pots";
    let parentId = isPot ? findContainerAt(p, { checkY: true }) : null;

    // Phase 6.1 — wall-snap for shelves. When placing a shelf, look for a nearby wall (within
    // ~2 ft of the tap point in XZ). If found, override position + rotation so the shelf's
    // back face is flush with the wall surface, the shelf's long axis runs parallel to the
    // wall, and the shelf hangs at 4 ft above floor (typical residential shelf height). The
    // shelf parents to the wall so dragging the wall pulls its shelves along (Babylon scene
    // graph carries the local offset through the parent's transform).
    let position = snapped;
    let rotation = { x: 0, y: 0, z: 0, w: 1 };
    let snappedToWall = false;
    if (prefabRef === "shelf-wall") {
      const wall = findNearestWall(p, 2.0);
      if (wall) {
        // Push the shelf out along the wall's outward normal by half its depth + half the
        // wall's thickness, so the back face of the shelf kisses the front face of the wall
        // without z-fighting. Default Y = 4 ft (configurable post-placement via Position modal).
        const shelfDepth = prefab.defaultSize.z;
        const offset = shelfDepth / 2; // wall.closestPoint already sits ON the wall surface
        position = {
          x: wall.closestPoint.x + wall.normal.x * offset,
          y: 4.0,
          z: wall.closestPoint.z + wall.normal.z * offset,
        };
        // Align the shelf's long axis (local X) with the wall's long axis. Wall yaw IS the
        // direction the wall's local X points; the shelf's local X should match. We DON'T
        // need to add π/2 — the shelf's back face is at +/- size.z/2 along local Z, same as
        // the wall, so identity-yaw of the shelf == identity-yaw of the wall == both extending
        // along world X when wallYaw == 0.
        const q = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), wall.wallYaw);
        rotation = { x: q.x, y: q.y, z: q.z, w: q.w };
        parentId = wall.wallId;
        snappedToWall = true;
      }
    }

    const body = {
      kind: "Bed",
      name: prefab.name,
      parentId,
      transform: {
        position,
        rotation,
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: {
        kind: "Prefab",
        prefabRef,
        size: { ...prefab.defaultSize },
      },
    };
    setStatus("placing " + prefab.name + "...");
    const created = await Api.addEntity(gardenId, body);
    meshForEntity(created);
    setStatus(snappedToWall ? `placed ${prefab.name} on wall` : `placed ${prefab.name}`);
  }

  // Phase 5.4: stamp a saved template into the world. Mirrors createPrefab but pulls geometry,
  // tags, kind, and cropRef from the template instead of the built-in library. Tap point is
  // snapped the same way, and pots still auto-parent onto containers (we read the geometry's
  // prefabRef to find the built-in's category — falling back to "no parent" when absent).
  async function createCustomPrefabInstance(p, template) {
    let geometry, tags;
    try {
      geometry = JSON.parse(template.geometryJson || "{}");
      tags = JSON.parse(template.tagsJson || "[]");
    } catch (e) {
      console.error("malformed template", template, e);
      setStatus("template is corrupt — delete it");
      return;
    }
    if (!Array.isArray(tags)) tags = [];

    const lib = window.OpenHarvestPrefabs || {};
    const builtin = (geometry && geometry.prefabRef) ? lib[geometry.prefabRef] : null;
    const isPot = builtin && builtin.category === "Pots";

    const snapped = applySnapVec({ x: p.x, y: 0, z: p.z });
    const parentId = isPot ? findContainerAt(p, { checkY: true }) : null;

    // Auto-suffix the name if a non-template entity already uses the same one. Keeps the
    // chronicle ("Bed 2", "Bed 3") readable when the user mass-stamps a template.
    const baseName = template.name || "Prefab";
    const existingNames = new Set(
      [...meshRegistry.values()].map(r => r.entity?.name).filter(Boolean));
    let name = baseName;
    if (existingNames.has(name)) {
      for (let i = 2; i < 100; i++) {
        const candidate = `${baseName} ${i}`;
        if (!existingNames.has(candidate)) { name = candidate; break; }
      }
    }

    const body = {
      kind: template.entityKind || "Bed",
      name,
      cropRef: template.cropRef || null,
      parentId,
      transform: {
        position: snapped,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry,
      tags,
    };
    setStatus("placing " + name + "...");
    const created = await Api.addEntity(gardenId, body);
    if (!meshRegistry.has(created.id)) meshForEntity(created);
    setStatus(`placed ${name}`);
  }

  // Phase 5.4: small modal for saving the currently selected entity as a reusable template.
  // Captures kind / geometry / tags / cropRef from the entity (the user's actual configuration,
  // not a generic default) and lets them pick a display name + emoji icon for the picker tile.
  function openSaveTemplateModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    const entity = rec.entity;
    closeModal();

    // Sensible default name. For prefabs we use the prefab's display name + a size hint;
    // for plain beds we synthesize a "WxD Raised Bed" hint from the geometry. Plants fall
    // through to the entity name. The user can always edit before saving.
    const g = entity.geometry || {};
    const sz = g.size || {};
    const sizeHint = (sz.x && sz.z) ? `${formatNum(fromFt(+sz.x))}×${formatNum(fromFt(+sz.z))} ${currentUnit} ` : "";
    let defaultName = entity.name || "";
    if (entity.kind === "Bed" && !defaultName) {
      defaultName = `${sizeHint}Bed`.trim();
    } else if (entity.kind === "Bed" && sizeHint && !defaultName.includes("×")) {
      defaultName = `${sizeHint}${defaultName}`;
    }

    // 5 emoji choices that cover the common prefab archetypes — beds, planters, pots, plants,
    // structures. The first one starts active; the user can swap by tapping any other tile.
    const icons = ["🟫", "⬛", "🟧", "🪴", "🟪"];
    const defaultIcon = (g.kind === "Prefab")
      ? (window.OpenHarvestPrefabs?.[g.prefabRef]?.icon || icons[0])
      : (entity.kind === "Plant" ? "🪴" : icons[0]);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Save as template</h2>
      <input type="text" data-field="name" placeholder="3×6 Raised Bed" />
      <div class="ai-meta" style="margin-top:6px;">Pick an icon for the tile in My Prefabs.</div>
      <div class="emoji-pick" data-region="icons">
        ${icons.map(e => `<div class="opt${e === defaultIcon ? " active" : ""}" data-icon="${escapeHtml(e)}">${escapeHtml(e)}</div>`).join("")}
      </div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const nameInput = modal.querySelector('[data-field="name"]');
    nameInput.value = defaultName;

    let chosenIcon = defaultIcon;
    modal.querySelectorAll('.emoji-pick .opt').forEach(opt => {
      opt.addEventListener("click", () => {
        modal.querySelectorAll('.emoji-pick .opt').forEach(o => o.classList.remove("active"));
        opt.classList.add("active");
        chosenIcon = opt.dataset.icon || defaultIcon;
      });
    });

    const save = async () => {
      const name = nameInput.value.trim();
      if (!name) { setStatus("template name required"); return; }
      // Body uses pre-stringified JSON for geometry + tags so the server can store them as
      // opaque text. Matches the wire shape advertised by Api.saveCustomPrefab.
      const body = {
        name,
        icon: chosenIcon,
        entityKind: entity.kind || "Bed",
        cropRef: entity.cropRef || null,
        geometryJson: JSON.stringify(entity.geometry || {}),
        tagsJson: JSON.stringify(Array.isArray(entity.tags) ? entity.tags : []),
      };
      try {
        await Api.saveCustomPrefab(gardenId, body);
        closeModal();
        setStatus("template saved");
      } catch (e) { console.error(e); setStatus("save failed"); }
    };

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", save);
    setTimeout(() => nameInput.focus(), 50);
  }

  async function openPrefabPickerModal() {
    closeModal();
    const lib = window.OpenHarvestPrefabs;
    if (!lib || typeof lib.__listByCategory !== "function") {
      setStatus("prefab library not loaded");
      return;
    }
    const groups = lib.__listByCategory();

    // Phase 5.4: load user-saved templates in parallel with rendering. The picker stays
    // responsive even if the API is slow — if the fetch fails we just show the built-ins.
    const customPromise = Api.listCustomPrefabs(gardenId).catch(() => []);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";

    const sections = groups.map(([cat, items]) => `
      <div class="prefab-cat">${escapeHtml(cat)}</div>
      <div class="prefab-grid">
        ${items.map(p => `
          <div class="prefab-tile" data-slug="${escapeHtml(p.slug)}">
            <div class="icon">${escapeHtml(p.icon || "📦")}</div>
            <div class="label">${escapeHtml(p.name)}</div>
          </div>
        `).join("")}
      </div>
    `).join("");

    modal.innerHTML = `
      <h2>Place a prefab</h2>
      ${sections}
      <div data-region="custom"></div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    // Built-in tile click → arm placement of that built-in slug.
    modal.querySelectorAll(".prefab-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const slug = tile.dataset.slug;
        if (!slug) return;
        pendingPrefabRef = slug;
        pendingCustomPrefab = null;
        closeModal();
        setMode(Mode.PrefabPick);
        const def_ = lib[slug];
        setStatus(`tap the ground to place ${def_?.name || slug}`);
      });
    });

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());

    // Phase 5.4: render the My Prefabs section once the fetch resolves. The whole section is
    // suppressed when the user has zero custom templates — we don't want a "My Prefabs" header
    // sitting empty above the cancel button.
    const customRegion = modal.querySelector('[data-region="custom"]');
    customPromise.then(list => {
      // Modal might have closed before the fetch resolved. Don't try to render into a detached
      // node — just bail.
      if (!customRegion.isConnected) return;
      if (!Array.isArray(list) || list.length === 0) return;
      renderMyPrefabsSection(customRegion, list);
    });
  }

  // Build the "My Prefabs" group and wire up tap-to-place + ×-to-delete handlers. Pulled out
  // of openPrefabPickerModal so we can re-render the same region in place after a delete
  // without rebuilding the whole modal (and losing the user's scroll position).
  function renderMyPrefabsSection(container, list) {
    const tilesHtml = list.map(p => `
      <div class="prefab-tile" data-id="${escapeHtml(p.id)}">
        <div class="x" data-act="del" title="Delete template">×</div>
        <div class="icon">${escapeHtml(p.icon || "📦")}</div>
        <div class="label">${escapeHtml(p.name)}</div>
      </div>
    `).join("");
    container.innerHTML = `
      <div class="prefab-cat">My Prefabs</div>
      <div class="prefab-grid">${tilesHtml}</div>
    `;

    container.querySelectorAll(".prefab-tile").forEach(tile => {
      const id = tile.dataset.id;
      const tpl = list.find(p => p.id === id);
      if (!tpl) return;

      // × delete button — confirm + DELETE + remove this tile from the visible list. We mutate
      // `list` and re-render so the section auto-hides if the user empties it.
      const xBtn = tile.querySelector('[data-act="del"]');
      if (xBtn) {
        xBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Delete template "${tpl.name}"?`)) return;
          try {
            await Api.deleteCustomPrefab(gardenId, id);
            const idx = list.indexOf(tpl);
            if (idx >= 0) list.splice(idx, 1);
            if (list.length === 0) container.innerHTML = "";
            else renderMyPrefabsSection(container, list);
            setStatus("template deleted");
          } catch (e) { console.error(e); setStatus("delete failed"); }
        });
      }

      // Body click → arm placement of this template.
      tile.addEventListener("click", () => {
        pendingCustomPrefab = tpl;
        pendingPrefabRef = null;
        closeModal();
        setMode(Mode.PrefabPick);
        setStatus(`tap the ground to place ${tpl.name}`);
      });
    });
  }

  // Phase 5.3 — generalized container lookup. Returns the entity id of the smallest container
  // whose XZ footprint contains point p, optionally filtered by candidate predicate. "Smallest"
  // wins on overlap so a pot ON a shelf parents to the pot, not the shelf. Y proximity is only
  // checked when checkY is true (pot on shelf) — raised beds skip it because plants are placed
  // at ground level inside a tall bed.
  function findContainerAt(p, opts = {}) {
    const { checkY = false, exclude = null } = opts;
    let best = null;
    let bestArea = Infinity;
    for (const [, rec] of meshRegistry) {
      if (rec.entity.id === exclude) continue;
      // Only Beds (semantic) are placeable containers today. Prefabs are stored with kind=Bed,
      // so we don't need a kind=Prefab branch — geometry.kind === "Prefab" tells us if it's a
      // prefab, but the container test only cares about footprint, not the visual subtype.
      if (rec.entity.kind !== "Bed") continue;
      const g = rec.entity.geometry;
      const t = rec.entity.transform;
      const size = g?.size;
      if (!size) continue;
      // Use the entity's stored world position. Plants snap to the bed's footprint at the
      // moment of placement, so we don't need the live mesh position here.
      const cx = t.position.x, cy = t.position.y, cz = t.position.z;
      const w = size.x, h = size.y || 1, d = size.z;
      if (p.x < cx - w / 2 || p.x > cx + w / 2) continue;
      if (p.z < cz - d / 2 || p.z > cz + d / 2) continue;
      if (checkY) {
        // For "on top of" semantics (a pot on a shelf), require the click point to be near
        // the top surface of the candidate container. Tolerance is generous: ±0.5 ft.
        const top = cy + h;
        if (Math.abs(p.y - top) > 0.5) continue;
      }
      const area = w * d;
      if (area < bestArea) { best = rec.entity.id; bestArea = area; }
    }
    return best;
  }

  // Back-compat shim for the plant placement flow. Plants always sit at ground level inside a
  // bed footprint, so we don't need a Y check.
  function findContainingBed(p) { return findContainerAt(p, { checkY: false }); }

  // Phase 6.1 — wall-snap helper. Walks meshRegistry for entities flagged as walls (set by the
  // wall-segment / door / window prefab builders via metadata.isWall), computes the closest
  // point on each wall's top-down rectangle to the tap point in XZ, and returns the nearest
  // hit within `maxDist` (feet). The returned record carries everything the shelf-placement
  // code needs to flush its back face against the wall and rotate it parallel:
  //   { wallId, mesh, closestPoint:{x,z}, normal:{x,z}, wallYaw, length, height }
  // wallYaw is the wall's current Y-axis rotation in radians (so a rotated wall still snaps
  // shelves correctly). Walls are boxes whose long axis lies along local-X — when yaw === 0
  // the wall extends along world X and its normals point ±Z; we project the tap point into
  // wall-local coordinates, clamp to the wall's length, and project back to world space.
  function findNearestWall(point, maxDist = 2.0) {
    let best = null;
    let bestDist = maxDist;
    for (const [, rec] of meshRegistry) {
      if (!rec.entity || !rec.mesh || rec.mesh.isDisposed?.()) continue;
      // We accept either an explicit metadata.isWall flag (set by the prefab builder + carried
      // through meshForEntity) or the wall-bearing prefab refs as a belt-and-braces fallback
      // for entities saved before the metadata-promotion patch landed.
      const meta = rec.mesh.metadata || {};
      const ref = rec.entity.geometry?.prefabRef;
      const isWall = meta.isWall === true
        || ref === "wall-segment" || ref === "door" || ref === "window";
      if (!isWall) continue;
      const g = rec.entity.geometry || {};
      const size = g.size || { x: 8, y: 8, z: 0.5 };
      const t = rec.entity.transform || {};
      const cx = t.position?.x || 0;
      const cz = t.position?.z || 0;
      const yaw = quaternionToYaw(t.rotation || { x: 0, y: 0, z: 0, w: 1 });
      // Transform the tap point into the wall's local frame (rotate by -yaw around the wall
      // centre). In local coords the wall is axis-aligned: extends ±size.x/2 along X, ±size.z/2
      // along Z. Closest point clamps to that rectangle; the wall's normals are world ±Z in
      // local, transformed back by +yaw.
      const dx = point.x - cx;
      const dz = point.z - cz;
      const cosY = Math.cos(-yaw), sinY = Math.sin(-yaw);
      const lx = dx * cosY - dz * sinY;
      const lz = dx * sinY + dz * cosY;
      const halfW = size.x / 2;
      const halfD = size.z / 2;
      const clx = Math.max(-halfW, Math.min(halfW, lx));
      // The "front" face of the wall is the one closest to the tap. Pick the side based on
      // whichever local-Z half the tap is on — this keeps shelves on the side of the wall
      // the user tapped from, instead of always snapping to the same face.
      const sideZ = lz >= 0 ? halfD : -halfD;
      const normalLocalZ = lz >= 0 ? 1 : -1;
      // Distance in the local frame is the perpendicular distance from the tap to the
      // chosen face (|lz - sideZ|), provided the tap's local-X is within the wall length.
      // If the tap is past the ends of the wall, fall back to a Euclidean distance to the
      // clamped corner so we don't snap to a wall the user clearly aimed past.
      const xPenalty = Math.max(0, Math.abs(lx) - halfW);
      const zPenalty = Math.abs(lz - sideZ);
      const localDist = Math.hypot(xPenalty, zPenalty);
      if (localDist > bestDist) continue;
      // Closest point on the wall's surface, in local then world coords.
      const cw_lx = clx;
      const cw_lz = sideZ;
      const cosBack = Math.cos(yaw), sinBack = Math.sin(yaw);
      const cwx = cx + cw_lx * cosBack - cw_lz * sinBack;
      const cwz = cz + cw_lx * sinBack + cw_lz * cosBack;
      // Outward normal in world coords (rotate local (0, normalLocalZ) by +yaw).
      const nx = -normalLocalZ * sinBack;
      const nz = normalLocalZ * cosBack;
      bestDist = localDist;
      best = {
        wallId: rec.entity.id,
        mesh: rec.mesh,
        closestPoint: { x: cwx, z: cwz },
        normal: { x: nx, z: nz },
        wallYaw: yaw,
        length: size.x,
        height: size.y,
        thickness: size.z,
      };
    }
    return best;
  }

  // Phase 6.1 — shelf-snap helper. Returns the entity id of the shelf whose top surface is
  // within `maxDistY` of the tap's Y AND whose XZ footprint contains the tap (in the shelf's
  // local frame, accounting for rotation). When found, the caller can parent the new entity
  // onto the shelf and place it at shelf.position.y + size.y/2.
  function findShelfAt(point, maxDistY = 0.3) {
    for (const [, rec] of meshRegistry) {
      if (!rec.entity || !rec.mesh || rec.mesh.isDisposed?.()) continue;
      const meta = rec.mesh.metadata || {};
      const ref = rec.entity.geometry?.prefabRef;
      const isShelf = meta.isShelf === true || ref === "shelf-wall";
      if (!isShelf) continue;
      const g = rec.entity.geometry || {};
      const size = g.size || { x: 3, y: 0.1, z: 1 };
      const t = rec.entity.transform || {};
      const cx = t.position?.x || 0;
      const cy = t.position?.y || 0;
      const cz = t.position?.z || 0;
      const top = cy + size.y;
      // The point's Y must be near the top of the shelf. v1 tolerance is a generous 0.3 ft so
      // a slightly-off ground tap (where pickGround returned y=0 but the shelf is at 4 ft) can
      // still land — but this also means a ground-level tap NEVER matches a shelf at 4 ft, so
      // callers that want shelf-snapping have to provide a Y-bearing point (e.g. the camera
      // ray's intersection with the shelf's plane). For v1 we keep it simple: callers that
      // can't supply a real Y skip this and fall through to bed-snapping.
      if (Math.abs((point.y || 0) - top) > maxDistY) continue;
      const yaw = quaternionToYaw(t.rotation || { x: 0, y: 0, z: 0, w: 1 });
      const dx = point.x - cx;
      const dz = point.z - cz;
      const cosY = Math.cos(-yaw), sinY = Math.sin(-yaw);
      const lx = dx * cosY - dz * sinY;
      const lz = dx * sinY + dz * cosY;
      if (Math.abs(lx) <= size.x / 2 && Math.abs(lz) <= size.z / 2) {
        return { shelfId: rec.entity.id, top, mesh: rec.mesh, size, yaw };
      }
    }
    return null;
  }

  // Phase 6.1 — alternate shelf finder that uses a SCREEN ray to test each shelf's top plane
  // directly. The pickGround() helper only returns a point on the floor (y=0), so a shelf at
  // 4 ft never matches via findShelfAt's Y tolerance. This walks the registry and ray-tests the
  // shelf top plane at its actual world height; first hit wins. Returns the same record as
  // findShelfAt or null. Caller passes the same scene/camera ray used for the placement tap.
  function pickShelfFromScreen() {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    let best = null;
    let bestT = Infinity;
    for (const [, rec] of meshRegistry) {
      if (!rec.entity || !rec.mesh || rec.mesh.isDisposed?.()) continue;
      const meta = rec.mesh.metadata || {};
      const ref = rec.entity.geometry?.prefabRef;
      const isShelf = meta.isShelf === true || ref === "shelf-wall";
      if (!isShelf) continue;
      const g = rec.entity.geometry || {};
      const size = g.size || { x: 3, y: 0.1, z: 1 };
      const t = rec.entity.transform || {};
      const cx = t.position?.x || 0;
      const cy = t.position?.y || 0;
      const cz = t.position?.z || 0;
      const top = cy + size.y;
      // Solve for the ray's t at y = top: ray.origin.y + t * ray.direction.y = top
      if (Math.abs(ray.direction.y) < 1e-6) continue;
      const tHit = (top - ray.origin.y) / ray.direction.y;
      if (tHit < 0 || tHit > bestT) continue;
      const hx = ray.origin.x + tHit * ray.direction.x;
      const hz = ray.origin.z + tHit * ray.direction.z;
      const yaw = quaternionToYaw(t.rotation || { x: 0, y: 0, z: 0, w: 1 });
      const dx = hx - cx, dz = hz - cz;
      const cosY = Math.cos(-yaw), sinY = Math.sin(-yaw);
      const lx = dx * cosY - dz * sinY;
      const lz = dx * sinY + dz * cosY;
      if (Math.abs(lx) > size.x / 2 || Math.abs(lz) > size.z / 2) continue;
      bestT = tHit;
      best = {
        shelfId: rec.entity.id,
        top,
        mesh: rec.mesh,
        size,
        yaw,
        hitPoint: { x: hx, y: top, z: hz },
      };
    }
    return best;
  }

  // ---------- plant autocomplete modal ----------
  let activeModal = null;
  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  async function openPlantModal(point) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>What are you planting?</h2>
      <input type="text" placeholder="Start typing — Brandywine Tomato, Basil..." autocomplete="off" />
      <div class="suggestions"></div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="confirm">Place</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const input = modal.querySelector("input");
    const suggestions = modal.querySelector(".suggestions");
    let highlighted = -1;
    let currentResults = [];
    let selectedCrop = null;

    const render = (results) => {
      currentResults = results;
      suggestions.innerHTML = "";
      results.forEach((c, i) => {
        const div = document.createElement("div");
        div.className = "suggestion" + (i === highlighted ? " highlight" : "");
        div.innerHTML = `
          <div class="name">${escapeHtml(c.commonName)}</div>
          ${c.scientificName ? `<div class="scientific">${escapeHtml(c.scientificName)}</div>` : ""}
        `;
        div.addEventListener("click", () => {
          selectedCrop = c;
          input.value = c.commonName;
          highlighted = i;
          render(currentResults);
        });
        suggestions.appendChild(div);
      });
    };

    let debounce = 0;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        const results = await Api.searchCrops(q);
        highlighted = -1; selectedCrop = null;
        render(results);
      }, 80);
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { highlighted = Math.min(currentResults.length - 1, highlighted + 1); render(currentResults); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { highlighted = Math.max(0, highlighted - 1); render(currentResults); ev.preventDefault(); }
      else if (ev.key === "Enter") {
        if (highlighted >= 0 && currentResults[highlighted]) selectedCrop = currentResults[highlighted];
        confirm();
        ev.preventDefault();
      } else if (ev.key === "Escape") {
        closeModal();
      }
    });

    const confirm = async () => {
      const q = input.value.trim();
      // If user typed without picking, try the top suggestion.
      const crop = selectedCrop || currentResults[0] || null;
      // If still nothing matched but user typed something, place an unbound plant with that name.
      if (!crop && q.length === 0) { closeModal(); return; }
      closeModal();
      try {
        await createPlant(point, crop || { commonName: q || "Plant", slug: null });
      } catch (e) { console.error(e); setStatus("failed to place plant"); }
    };

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="confirm"]').addEventListener("click", () => confirm());

    // Initial suggestions.
    Api.searchCrops("").then((results) => render(results));
    setTimeout(() => input.focus(), 50);
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- radial menu ----------
  let radialEntityId = null;
  function openRadial(eid, x, y) {
    radialEntityId = eid;
    radial.style.left = x + "px";
    radial.style.top = y + "px";
    // Resize is only meaningful for box-geometry entities (Beds). Disable it for Plants.
    const rec = meshRegistry.get(eid);
    const resizeItem = radial.querySelector('.item[data-action="resize"]');
    if (resizeItem) {
      const canResize = !!rec && rec.entity?.kind === "Bed";
      resizeItem.classList.toggle("disabled", !canResize);
      resizeItem.title = canResize ? "Resize this bed" : "Resize is only available for beds";
    }
    radial.classList.add("open");
  }
  function closeRadial() {
    radial.classList.remove("open");
    radialEntityId = null;
  }
  radial.addEventListener("click", async (ev) => {
    const item = ev.target.closest(".item");
    if (!item || !radialEntityId) return;
    if (item.classList.contains("disabled")) return;
    const action = item.dataset.action;
    const eid = radialEntityId;
    closeRadial();
    if (action === "delete") deleteEntityById(eid);
    else if (action === "rename") openRenameModal(eid);
    else if (action === "move") startMove(eid);
    else if (action === "resize") openResizeModal(eid);
    else if (action === "photo") openPhotosModal(eid);
  });
  document.addEventListener("pointerdown", (ev) => {
    if (radial.classList.contains("open") && !radial.contains(ev.target)) closeRadial();
  });

  async function deleteEntityById(eid) {
    if (!confirm("Delete this?")) return;
    try {
      await Api.deleteEntity(gardenId, eid);
      disposeEntity(eid);
      // Phase 5.0: if the deleted entity was the one shown in the edit panel, clear it.
      // The SignalR handler does this too, but local-first prevents a brief stale flash.
      if (selectedEntityId === eid) clearSelection();
      setStatus("deleted");
    } catch (e) { console.error(e); setStatus("delete failed"); }
  }

  async function openRenameModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Rename</h2>
      <input type="text" autocomplete="off" />
      <div class="suggestions"></div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="confirm">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const input = modal.querySelector("input");
    input.value = rec.entity.name || "";
    const suggestions = modal.querySelector(".suggestions");
    let highlighted = -1;
    let currentResults = [];
    let selectedCrop = null;

    const renderSug = (rs) => {
      currentResults = rs;
      suggestions.innerHTML = "";
      rs.forEach((c, i) => {
        const div = document.createElement("div");
        div.className = "suggestion" + (i === highlighted ? " highlight" : "");
        div.innerHTML = `<div class="name">${escapeHtml(c.commonName)}</div>` +
          (c.scientificName ? `<div class="scientific">${escapeHtml(c.scientificName)}</div>` : "");
        div.addEventListener("click", () => {
          selectedCrop = c; input.value = c.commonName; highlighted = i; renderSug(currentResults);
        });
        suggestions.appendChild(div);
      });
    };

    // Only show crop suggestions for plants.
    if (rec.entity.kind === "Plant") {
      const debounce = (() => {
        let t = 0;
        return (q) => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const r = await Api.searchCrops(q);
            highlighted = -1; renderSug(r);
          }, 80);
        };
      })();
      input.addEventListener("input", () => debounce(input.value.trim()));
      Api.searchCrops("").then(renderSug);
    }

    const save = async () => {
      const newName = input.value.trim();
      if (!newName) { closeModal(); return; }
      closeModal();
      try {
        const body = { name: newName };
        if (rec.entity.kind === "Plant") body.cropRef = selectedCrop ? selectedCrop.slug : null;
        const updated = await Api.updateEntity(gardenId, eid, body);
        // Replace mesh+label with new name.
        disposeEntity(eid);
        meshForEntity(updated);
        // Phase 5.0: keep the edit panel coherent if this entity is currently selected.
        if (selectedEntityId === eid) selectEntity(eid);
        setStatus("renamed");
      } catch (e) { console.error(e); setStatus("rename failed"); }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { save(); ev.preventDefault(); }
      else if (ev.key === "Escape") closeModal();
    });
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="confirm"]').addEventListener("click", () => save());
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  // ---------- photos modal ----------
  async function openPhotosModal(eid) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Photos</h2>
      <div class="modal-actions" style="justify-content:flex-start; margin-top:0; gap:8px;">
        <button class="primary" data-act="take">📷 Take photo</button>
        <button data-act="diagnose">🔍 Diagnose</button>
      </div>
      <div class="photo-grid"></div>
      <div class="ai-output"></div>
      <div class="modal-actions">
        <button data-act="close">Close</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const grid = modal.querySelector(".photo-grid");
    const refresh = async () => {
      grid.innerHTML = "";
      const photos = await Api.listPhotos(gardenId, eid);
      if (photos.length === 0) {
        const empty = document.createElement("div");
        empty.className = "photo-empty";
        empty.textContent = "No photos yet. Tap “Take photo” to start a journal for this entity.";
        grid.appendChild(empty);
        return;
      }
      photos.forEach(p => {
        const tile = document.createElement("div");
        tile.className = "photo-tile";
        const date = new Date(p.takenUtc).toLocaleDateString();
        tile.innerHTML = `
          <img src="${p.url}" alt="" loading="lazy" />
          <div class="meta">${escapeHtml(date)}</div>
          <div class="delete" title="Delete">×</div>
        `;
        tile.querySelector(".delete").addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm("Delete this photo?")) return;
          try {
            await Api.deletePhoto(gardenId, eid, p.id);
            await refresh();
            await refreshEntityPhotoBadge(eid);
          } catch (e) { console.error(e); setStatus("photo delete failed"); }
        });
        tile.addEventListener("click", () => {
          window.open(p.url, "_blank", "noopener");
        });
        grid.appendChild(tile);
      });
    };

    const photoInput = document.getElementById("photoInput");
    const out = modal.querySelector(".ai-output");
    let nextAction = "upload"; // or "diagnose"

    const onPick = async () => {
      const file = photoInput.files?.[0];
      photoInput.value = "";
      if (!file) return;
      const action = nextAction;
      nextAction = "upload";
      if (action === "diagnose") {
        if (!advisorConfigured) { setStatus("AI advisor not configured"); return; }
        out.innerHTML = `<div class="ai-spinner">analyzing the photo…</div>`;
        try {
          const result = await Api.diagnose(gardenId, eid, file, "");
          out.innerHTML = `
            <div class="ai-answer">${escapeHtml(result.diagnosis)}${result.identifiedProblem ? "\n\nProblem: " + escapeHtml(result.identifiedProblem) : ""}${result.treatment ? "\n\nTreatment: " + escapeHtml(result.treatment) : ""}</div>
            <div class="ai-meta">${escapeHtml(result.provider)} · ${escapeHtml(result.model)}</div>
          `;
          setStatus("diagnosis logged");
          await refresh();
          await refreshEntityPhotoBadge(eid);
        } catch (e) { console.error(e); out.innerHTML = `<div class="ai-spinner" style="color:var(--danger)">diagnosis failed</div>`; }
      } else {
        setStatus("uploading photo...");
        try {
          await Api.uploadPhoto(gardenId, eid, file);
          setStatus("photo uploaded");
          await refresh();
          await refreshEntityPhotoBadge(eid);
        } catch (e) { console.error(e); setStatus("photo upload failed"); }
      }
    };
    photoInput.addEventListener("change", onPick, { once: true });

    modal.querySelector('[data-act="take"]').addEventListener("click", () => { nextAction = "upload"; photoInput.click(); });
    modal.querySelector('[data-act="diagnose"]').addEventListener("click", () => { nextAction = "diagnose"; photoInput.click(); });
    modal.querySelector('[data-act="close"]').addEventListener("click", () => closeModal());
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });

    refresh();
  }

  // After upload/delete, refresh the entity's local mesh count badge by re-fetching.
  async function refreshEntityPhotoBadge(eid) {
    // Phase 2 doesn't surface a badge yet — placeholder for future UX. Refetch entities so
    // PhotoLog presence is up to date in the local registry.
    try {
      const entities = await Api.getEntities(gardenId);
      entities.forEach(e => {
        const rec = meshRegistry.get(e.id);
        if (rec) rec.entity = e;
      });
    } catch { /* ignore */ }
  }

  // Move: detach camera control, then arm a drag-and-drop state machine on the canvas.
  //
  // The previous implementation was racy: it registered a window-level pointerup the moment
  // the radial item was tapped, so the very next pointerup (often a stray click on the canvas
  // or the synthesized tap from closing the radial on a touchscreen) committed the move
  // before the user had a chance to drag. Mesh tracking ran on every POINTERMOVE — fine on
  // desktop, but on touch the pointer position is stale until the user actually presses, so
  // the bed appeared "stuck" while the move silently ended.
  //
  // The new flow:
  //   1. setMode → Mode.Move; status nag tells the user what to do.
  //   2. Wait for a fresh POINTERDOWN on the canvas — that arms the drag.
  //   3. Track POINTERMOVE only between pointerdown and pointerup (proper drag semantics
  //      on both mouse and touch).
  //   4. POINTERUP commits + PATCHes the new transform, then restores camera control.
  //   5. Pressing Escape or tapping outside cancels and snaps the bed back.
  function startMove(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    setStatus("tap-and-drag the bed to its new spot — release to drop");
    canvas.style.cursor = "grab";
    camera.detachControl();
    mode = Mode.Move;

    // Phase 5.3 — origin captures the WORLD position so cancel/commit/no-op-guard can compare
    // against world coordinates regardless of whether the mesh is parented (and therefore
    // expressing position in parent-local coords). Babylon refreshes absolutePosition lazily,
    // so we computeWorldMatrix first to ensure a fresh value.
    rec.mesh.computeWorldMatrix(true);
    const ap = rec.mesh.absolutePosition;
    const origin = { x: ap.x, y: ap.y, z: ap.z };
    let dragging = false;
    let committed = false;

    const followPointer = () => {
      const p = pickGround();
      if (!p) return;
      // Phase 5.2.1: when snap is active, quantize live during the drag so the user gets
      // visible stair-step feedback against the chosen grid (not just on release).
      // Phase 5.3: we always set WORLD coordinates here. For unparented meshes that's just
      // mesh.position. For parented meshes (child of a bed/shelf) we convert to parent-local.
      const worldX = applySnap(p.x);
      const worldZ = applySnap(p.z);
      if (rec.mesh.parent) {
        rec.mesh.parent.computeWorldMatrix(true);
        const pap = rec.mesh.parent.absolutePosition;
        rec.mesh.position.x = worldX - pap.x;
        rec.mesh.position.z = worldZ - pap.z;
      } else {
        rec.mesh.position.x = worldX;
        rec.mesh.position.z = worldZ;
      }
    };

    const cleanup = () => {
      scene.onPointerObservable.remove(moveObs);
      window.removeEventListener("keydown", onKey, true);
      camera.attachControl(canvas, true);
      canvas.style.cursor = "";
      mode = Mode.Idle;
    };

    // Phase 5.3 — small helper: write world (X, Z) onto rec.mesh, accounting for parent if any.
    const setMeshWorldXZ = (worldX, worldZ) => {
      if (rec.mesh.parent) {
        rec.mesh.parent.computeWorldMatrix(true);
        const pap = rec.mesh.parent.absolutePosition;
        rec.mesh.position.x = worldX - pap.x;
        rec.mesh.position.z = worldZ - pap.z;
      } else {
        rec.mesh.position.x = worldX;
        rec.mesh.position.z = worldZ;
      }
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      setMeshWorldXZ(origin.x, origin.z);
      cleanup();
      setStatus("move cancelled");
    };

    const commit = async () => {
      if (committed) return;
      committed = true;
      cleanup();
      // Phase 5.3 — when the moved entity is a parent, Babylon has already pulled the children
      // along (their meshes are reparented in the scene graph), so each child's world position
      // is now updated. We need to PATCH each child too: the server stores world-space, and a
      // reload would otherwise re-render children at their OLD world positions while the
      // parent sits at the NEW one. We snapshot the dragged mesh's new WORLD position here
      // via absolutePosition so the value is correct whether or not rec.mesh itself is
      // parented (you can grab a child pot and drag it inside its bed).
      rec.mesh.computeWorldMatrix(true);
      const newAp = rec.mesh.absolutePosition;
      const newPos = { x: newAp.x, y: 0, z: newAp.z };
      // No-op guard: if the user tapped without actually dragging, skip the PATCH.
      const dx = newPos.x - origin.x;
      const dz = newPos.z - origin.z;
      if (dx * dx + dz * dz < 0.0001) {
        setStatus("move cancelled (no drag)");
        return;
      }
      try {
        const updated = await Api.updateEntity(gardenId, eid, {
          transform: {
            position: newPos,
            // Phase 6.1 — preserve the entity's rotation across a move so a user-rotated
            // shelf or wall doesn't snap back to axis-aligned the moment they drag it.
            rotation: rec.entity.transform?.rotation || { x: 0, y: 0, z: 0, w: 1 },
            scale: rec.entity.transform?.scale || { x: 1, y: 1, z: 1 },
          },
        });
        rec.entity = updated;

        // Phase 5.3 — propagate the parent's move to its children's stored world positions.
        // The children's meshes already moved (parented in the scene graph), so we read each
        // child's absolutePosition and PATCH it back as the new world transform. Y is
        // recovered from the entity's previous y minus the prefab yOffset so we don't double-
        // shift labels and meshes whose anchor y differs from the stored entity y.
        const children = [];
        for (const [, child] of meshRegistry) {
          if (child.entity?.parentId === eid) children.push(child);
        }
        await Promise.all(children.map(async (child) => {
          const ap = child.mesh.absolutePosition;
          const yOffset = child.mesh.metadata?.yOffset ?? 0;
          const newChildPos = { x: ap.x, y: ap.y - yOffset, z: ap.z };
          try {
            const childUpdated = await Api.updateEntity(gardenId, child.entity.id, {
              transform: {
                position: newChildPos,
                // Phase 6.1 — preserve child's own rotation across the parent's move.
                rotation: child.entity.transform?.rotation || { x: 0, y: 0, z: 0, w: 1 },
                scale: child.entity.transform?.scale || { x: 1, y: 1, z: 1 },
              },
            });
            child.entity = childUpdated;
            if (selectedEntityId === child.entity.id) renderToolbar(childUpdated);
          } catch (childErr) {
            console.warn("child PATCH failed", child.entity.id, childErr);
          }
        }));

        // Phase 5.2.1: refresh the toolbar's position chip if this is the selected entity.
        if (selectedEntityId === eid) renderToolbar(updated);
        const childCount = children.length;
        setStatus(childCount > 0
          ? `moved to ${formatPos(newPos)} (+ ${childCount} child${childCount === 1 ? "" : "ren"})`
          : `moved to ${formatPos(newPos)}`);
      } catch (e) {
        console.error(e);
        // Snap back on server failure so client state matches truth.
        rec.mesh.position.x = origin.x;
        rec.mesh.position.z = origin.z;
        setStatus("move failed — reverted");
      }
    };

    // Phase 5.2.2 (B7) — clearer drag FSM. The previous implementation moved the mesh on
    // POINTERDOWN (via followPointer), which felt jarring: a stray tap teleported the bed to
    // wherever the finger landed before the user even started dragging. Now POINTERDOWN just
    // ARMS the drag (records that a touch is active and remembers the start point); the mesh
    // only moves once the user actually drags past a small threshold on POINTERMOVE. A
    // tap-and-release with no movement is treated as a no-op (cancels the move silently),
    // matching the "I tapped 🚚 by mistake" recovery path.
    let moved = false;
    const DRAG_THRESHOLD_PX = 6;
    let downX = 0, downY = 0;
    const moveObs = scene.onPointerObservable.add((info) => {
      if (committed) return;
      if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        dragging = true;
        moved = false;
        downX = scene.pointerX;
        downY = scene.pointerY;
        canvas.style.cursor = "grabbing";
      } else if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        if (!dragging) return;
        if (!moved) {
          const dx = scene.pointerX - downX;
          const dy = scene.pointerY - downY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
          moved = true;
        }
        followPointer();
      } else if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
        // Trailing POINTERUP from the toolbar tap that armed Move? Ignore — we only commit if
        // we got our own POINTERDOWN inside this session.
        if (!dragging) return;
        dragging = false;
        if (!moved) {
          // Tap with no drag → treat as cancel. The user most likely tapped 🚚 by accident
          // or wanted to abort. Snap mesh back to origin (no-op since we never moved it).
          cancel();
          return;
        }
        commit();
      }
    });

    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
  }

  // ---------- resize modal ----------
  // Phase 5.2.1: handles Beds (Box geometry, 2 axes: width + depth) and Prefabs (3 axes:
  // width + height + depth). All inputs are in the user's chosen unit; we convert to feet
  // before PATCH. Prefab clamps come from the prefab definition's min/max; Box beds use the
  // historical 1–30 ft range. For prefabs whose Y has fixed proportions (Stake, Trellis,
  // Fence) the height field is hidden — those builders only react to X/Z anyway.
  async function openResizeModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec || rec.entity.kind !== "Bed") return;
    const g = rec.entity.geometry || {};
    const isPrefab = g.kind === "Prefab";
    const prefabDef = isPrefab ? (window.OpenHarvestPrefabs?.[g.prefabRef] || null) : null;
    const sizeDefault = (isPrefab && prefabDef) ? prefabDef.defaultSize : { x: 4, y: 0.4, z: 4 };
    const size = g.size || sizeDefault;
    const minSize = (isPrefab && prefabDef) ? prefabDef.minSize : { x: 1, y: 0.4, z: 1 };
    const maxSize = (isPrefab && prefabDef) ? prefabDef.maxSize : { x: 30, y: 30, z: 30 };
    // Prefabs with fixed Y proportions (the ratio is baked into the builder): Stake, Trellis,
    // Fence — surfacing a height input would mislead the user. Detect by the prefab's slug.
    const fixedHeightPrefabs = new Set(["stake", "trellis-flat", "fence-section"]);
    const showHeight = isPrefab && !fixedHeightPrefabs.has(g.prefabRef);

    const u = currentUnit;
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Resize${isPrefab && prefabDef ? ` ${escapeHtml(prefabDef.icon || "")} ${escapeHtml(prefabDef.name)}` : " bed"} (${escapeHtml(u)})</h2>
      <div style="display:grid;grid-template-columns:${showHeight ? "1fr 1fr 1fr" : "1fr 1fr"};gap:8px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Width <input type="number" data-field="w" step="any" />
        </label>
        ${showHeight ? `
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Height <input type="number" data-field="h" step="any" />
        </label>` : ""}
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Depth <input type="number" data-field="d" step="any" />
        </label>
      </div>
      <div class="ai-meta" style="margin-top:8px;">Range: ${formatNum(fromFt(minSize.x))}–${formatNum(fromFt(maxSize.x))} ${escapeHtml(u)} (W) ${showHeight ? `· ${formatNum(fromFt(minSize.y))}–${formatNum(fromFt(maxSize.y))} ${escapeHtml(u)} (H)` : ""} · ${formatNum(fromFt(minSize.z))}–${formatNum(fromFt(maxSize.z))} ${escapeHtml(u)} (D).</div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const wInput = modal.querySelector('input[data-field="w"]');
    const hInput = modal.querySelector('input[data-field="h"]');
    const dInput = modal.querySelector('input[data-field="d"]');
    wInput.value = formatNum(fromFt(+size.x || sizeDefault.x));
    if (hInput) hInput.value = formatNum(fromFt(+size.y || sizeDefault.y));
    dInput.value = formatNum(fromFt(+size.z || sizeDefault.z));

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const save = async () => {
      const wRaw = parseFloat(wInput.value);
      const dRaw = parseFloat(dInput.value);
      const hRaw = hInput ? parseFloat(hInput.value) : null;
      if (!isFinite(wRaw) || !isFinite(dRaw) || (hInput && !isFinite(hRaw))) {
        setStatus("invalid number"); return;
      }
      // Convert from the chosen unit to feet, then clamp to the prefab/bed bounds.
      const w = clamp(toFt(wRaw), minSize.x, maxSize.x);
      const d = clamp(toFt(dRaw), minSize.z, maxSize.z);
      const h = hInput
        ? clamp(toFt(hRaw), minSize.y, maxSize.y)
        : (Number(size.y) || sizeDefault.y);
      closeModal();
      try {
        const newGeometry = isPrefab
          ? { kind: "Prefab", prefabRef: g.prefabRef, size: { x: w, y: h, z: d } }
          : { kind: "Box", size: { x: w, y: h, z: d } };
        const updated = await Api.updateEntity(gardenId, eid, { geometry: newGeometry });
        // Geometry changed — dispose + recreate the mesh from the server payload. SignalR
        // will broadcast the same upsert; applyEntityUpsert is idempotent.
        disposeEntity(eid);
        meshForEntity(updated);
        if (selectedEntityId === eid) selectEntity(eid);
        const dimList = hInput
          ? `${formatNum(fromFt(w))}×${formatNum(fromFt(h))}×${formatNum(fromFt(d))} ${u}`
          : `${formatNum(fromFt(w))}×${formatNum(fromFt(d))} ${u}`;
        setStatus(`resized to ${dimList}`);
      } catch (e) { console.error(e); setStatus("resize failed"); }
    };

    [wInput, hInput, dInput].filter(Boolean).forEach((el) => {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { save(); ev.preventDefault(); }
        else if (ev.key === "Escape") closeModal();
      });
    });
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", () => save());
    setTimeout(() => { wInput.focus(); wInput.select(); }, 50);
  }

  // ---------- Phase 5.2.2 style modal (B5) ----------
  // Per-instance material color. Stored in entity.extensions.color as "#rrggbb" or null when
  // the user picks "Default". The toolbar 🎨 button opens this; meshForEntity reads the value
  // and applies it via applyEntityColor() (see above).
  const STYLE_SWATCHES = [
    { name: "Default",    hex: null },
    { name: "Wood",       hex: "#735238" },
    { name: "White",      hex: "#f1f1f0" },
    { name: "Grey",       hex: "#7a7c80" },
    { name: "Black",      hex: "#1a1a1c" },
    { name: "Terracotta", hex: "#c4683b" },
    { name: "Red",        hex: "#c0392b" },
    { name: "Blue",       hex: "#3a78c2" },
    { name: "Green",      hex: "#3e8f4e" },
  ];

  function openStyleModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    closeModal();

    const currentColor = rec.entity.extensions?.color || null;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    const swatchesHtml = STYLE_SWATCHES.map(s => {
      const isActive = (currentColor || null) === (s.hex || null);
      const bg = s.hex || "transparent";
      const isDefault = s.hex === null ? '1' : '0';
      return `<div class="opt${isActive ? " active" : ""}" data-hex="${escapeHtml(s.hex || "")}" data-default="${isDefault}" style="background:${escapeHtml(bg)};" title="${escapeHtml(s.name)}"></div>`;
    }).join("");

    modal.innerHTML = `
      <h2>🎨 Style</h2>
      <div class="ai-meta">Pick a swatch or use a custom color. Per-instance — only this entity changes.</div>
      <div class="color-pick" data-region="swatches">${swatchesHtml}</div>
      <div class="color-custom-row">
        <input type="color" data-field="picker" value="${escapeHtml(currentColor || "#cabe8c")}" />
        <input type="text" data-field="hex" placeholder="#cabe8c" value="${escapeHtml(currentColor || "")}" />
      </div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    let chosen = currentColor || null;
    const swatches = modal.querySelectorAll('.color-pick .opt');
    const picker = modal.querySelector('input[data-field="picker"]');
    const hexInput = modal.querySelector('input[data-field="hex"]');

    const setActiveByHex = (hex) => {
      swatches.forEach(s => {
        const sh = s.dataset.hex || null;
        const a = (sh || null) === (hex || null);
        s.classList.toggle("active", a);
      });
    };

    swatches.forEach(opt => {
      opt.addEventListener("click", () => {
        chosen = opt.dataset.hex || null;
        if (chosen) {
          picker.value = chosen;
          hexInput.value = chosen;
        } else {
          hexInput.value = "";
        }
        setActiveByHex(chosen);
      });
    });

    picker.addEventListener("input", () => {
      chosen = picker.value;
      hexInput.value = chosen;
      setActiveByHex(chosen);
    });

    hexInput.addEventListener("input", () => {
      const v = hexInput.value.trim();
      // Accept #rgb / #rrggbb. Empty string = default.
      if (!v) { chosen = null; setActiveByHex(null); return; }
      if (/^#?[0-9a-fA-F]{3}$/.test(v) || /^#?[0-9a-fA-F]{6}$/.test(v)) {
        chosen = v.startsWith("#") ? v : "#" + v;
        try { picker.value = chosen.length === 4
          ? "#" + chosen[1] + chosen[1] + chosen[2] + chosen[2] + chosen[3] + chosen[3]
          : chosen; } catch { /* ignore */ }
        setActiveByHex(chosen);
      }
    });

    const save = async () => {
      closeModal();
      // PATCH the entity's extensions. Sending null for the color key removes it server-side
      // (see UpdateEntityRequest handling in GardensController.cs). Sending a hex sets it.
      const extensionsBody = { color: chosen ? chosen : null };
      try {
        const updated = await Api.updateEntity(gardenId, eid, { extensions: extensionsBody });
        // Force a fresh mesh build so the tint takes effect immediately. The SignalR upsert
        // would do this anyway but local-first removes the visible flicker.
        disposeEntity(eid);
        meshForEntity(updated);
        if (selectedEntityId === eid) selectEntity(eid);
        setStatus(chosen ? `color: ${chosen}` : "color: default");
      } catch (e) { console.error(e); setStatus("style save failed"); }
    };

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", save);
  }

  // ---------- Phase 5.3 tags ----------
  // Curated typeahead pool for the Tags modal. Kept short and grounded in things gardening
  // guidance actually keys on (light / container / soil / care / intent). The user can still
  // type anything not in this list.
  const TAG_SUGGESTIONS = [
    // Light/sun
    "full-sun", "partial-shade", "full-shade",
    "south-facing", "north-facing", "east-facing", "west-facing",
    // Container type
    "raised", "in-ground", "container", "indoor", "vertical",
    "balcony", "patio", "windowsill", "greenhouse",
    // Soil/water
    "high-water", "low-water", "drought-tolerant",
    "rich-soil", "poor-soil", "acidic", "alkaline",
    // Care
    "high-maintenance", "low-maintenance",
    // User intent
    "experimental", "favorite", "heirloom", "annual", "perennial",
  ];

  // Normalize a tag the same way the server does so the chip count + suggestions stay in
  // sync with what's persisted.
  function normalizeTag(s) {
    if (!s) return "";
    return String(s).trim();
  }

  function openTagsModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    closeModal();
    let workingTags = Array.isArray(rec.entity.tags) ? [...rec.entity.tags] : [];

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>🏷 Tags for ${escapeHtml(rec.entity.name || "this entity")}</h2>
      <div class="tags-chips" data-chips></div>
      <div class="tags-input-row">
        <input type="text" placeholder="Add a tag (e.g. raised, south-facing)..." autocomplete="off" />
        <button data-act="add">+ Add</button>
      </div>
      <div class="tags-suggest" data-suggest></div>
      <div class="ai-meta" style="margin-top:8px;">Tags feed into the AI advisor for sharper guidance.</div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const chipsEl = modal.querySelector('[data-chips]');
    const suggestEl = modal.querySelector('[data-suggest]');
    const input = modal.querySelector('input');

    const renderChips = () => {
      chipsEl.innerHTML = "";
      if (workingTags.length === 0) {
        const empty = document.createElement("div");
        empty.className = "tags-empty";
        empty.textContent = "No tags yet. Add tags to sharpen AI guidance.";
        chipsEl.appendChild(empty);
        return;
      }
      workingTags.forEach((t, i) => {
        const chip = document.createElement("span");
        chip.className = "tags-chip";
        chip.innerHTML = `<span>${escapeHtml(t)}</span><span class="x" title="Remove">×</span>`;
        chip.querySelector(".x").addEventListener("click", () => {
          workingTags.splice(i, 1);
          renderChips();
          renderSuggest();
        });
        chipsEl.appendChild(chip);
      });
    };

    const renderSuggest = () => {
      suggestEl.innerHTML = "";
      const have = new Set(workingTags.map(t => t.toLowerCase()));
      const q = input.value.trim().toLowerCase();
      const pool = TAG_SUGGESTIONS.filter(t => !have.has(t.toLowerCase()));
      const filtered = q ? pool.filter(t => t.toLowerCase().includes(q)) : pool;
      filtered.slice(0, 24).forEach(t => {
        const chip = document.createElement("span");
        chip.className = "tags-suggest-chip";
        chip.textContent = t;
        chip.addEventListener("click", () => {
          workingTags.push(t);
          input.value = "";
          renderChips();
          renderSuggest();
        });
        suggestEl.appendChild(chip);
      });
    };

    const addCurrent = () => {
      const v = normalizeTag(input.value);
      if (!v) return;
      const exists = workingTags.some(t => t.toLowerCase() === v.toLowerCase());
      if (!exists) workingTags.push(v);
      input.value = "";
      renderChips();
      renderSuggest();
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { addCurrent(); ev.preventDefault(); }
      else if (ev.key === "Escape") closeModal();
    });
    input.addEventListener("input", renderSuggest);
    modal.querySelector('[data-act="add"]').addEventListener("click", addCurrent);

    const save = async () => {
      // Treat "what was on the chip strip when Save was tapped" as canonical. Send even when
      // empty — that's the "user cleared all tags" case the server treats as meaningful.
      closeModal();
      try {
        const updated = await Api.updateEntity(gardenId, eid, { tags: workingTags });
        rec.entity = updated;
        if (selectedEntityId === eid) renderToolbar(updated);
        const n = workingTags.length;
        setStatus(n === 0 ? "tags cleared" : `saved ${n} tag${n === 1 ? "" : "s"}`);
      } catch (e) { console.error(e); setStatus("tag save failed"); }
    };

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", save);

    renderChips();
    renderSuggest();
    setTimeout(() => input.focus(), 50);
  }

  // ---------- Phase 5.2.1 selection + slim toolbar ----------
  // selectEntity/clearSelection are the single entry points for changing what's in the
  // toolbar. They own the Babylon outline state so highlight + toolbar never drift apart.
  // The toolbar replaces the Phase 5.0 right-side panel, which covered ~60% of the mobile
  // viewport. Now the scene stays visible and the toolbar floats above the bottom buttons.
  function selectEntity(eid) {
    // Clear the previous outline first — even if we're re-selecting the same entity, the
    // mesh may have been disposed and recreated (upsert path).
    if (lastSelectedMesh && !lastSelectedMesh.isDisposed()) {
      lastSelectedMesh.renderOutline = false;
    }
    const rec = meshRegistry.get(eid);
    if (!rec) { clearSelection(); return; }
    selectedEntityId = eid;
    lastSelectedMesh = rec.mesh;
    rec.mesh.renderOutline = true;
    rec.mesh.outlineWidth = 0.05;
    rec.mesh.outlineColor = new BABYLON.Color3(0.30, 0.85, 0.45);
    renderToolbar(rec.entity);
  }

  function clearSelection() {
    if (lastSelectedMesh && !lastSelectedMesh.isDisposed()) {
      lastSelectedMesh.renderOutline = false;
    }
    selectedEntityId = null;
    lastSelectedMesh = null;
    const tb = document.getElementById("toolbar");
    if (tb) tb.classList.add("hidden");
  }

  // Render the toolbar against the given entity. Called any time the selection or unit
  // changes; cheap because the toolbar is a small set of nodes already in the DOM.
  function renderToolbar(entity) {
    const tb = document.getElementById("toolbar");
    if (!tb) return;
    if (!entity) { tb.classList.add("hidden"); return; }
    tb.classList.remove("hidden");

    const g = entity.geometry || {};
    const isPrefab = g.kind === "Prefab";
    const prefabDef = isPrefab ? (window.OpenHarvestPrefabs?.[g.prefabRef] || null) : null;
    const isPlant = entity.kind === "Plant";
    const isBed = entity.kind === "Bed";
    // Resize is only meaningful when geometry has user-tweakable size. Plants don't expose
    // a size editor; everything else (Beds + Prefabs) does.
    const canResize = isBed;

    const icon = isPrefab ? (prefabDef?.icon || "📦")
               : isPlant  ? "🌱"
               : isBed    ? "🟫"
                          : "📦";
    const name = entity.name || (isPrefab ? (prefabDef?.name || "Prefab") : entity.kind || "");

    tb.querySelector(".tb-icon").textContent = icon;
    const nameEl = tb.querySelector(".tb-name");
    nameEl.textContent = name;
    nameEl.title = `Rename "${name}"`;
    const posEl = tb.querySelector(".tb-pos");
    posEl.textContent = formatPos(entity.transform?.position);

    // Wire each action. We replace the whole listener set on every render (selection change)
    // by cloning the action span — simpler than tracking individual handlers and avoids the
    // double-fire bug if the same entity is re-selected after an upsert.
    const eid = entity.id;
    const actions = tb.querySelector(".tb-actions");
    const fresh = actions.cloneNode(true);
    actions.replaceWith(fresh);

    fresh.querySelector('[data-act="photo"]').addEventListener("click", () => openPhotosModal(eid));
    const diagBtn = fresh.querySelector('[data-act="diagnose"]');
    diagBtn.disabled = !isPlant;
    diagBtn.title = isPlant ? "Diagnose with photo" : "Diagnose is for plants only";
    if (isPlant) diagBtn.addEventListener("click", () => openPhotosModal(eid));
    const resizeBtn = fresh.querySelector('[data-act="resize"]');
    resizeBtn.disabled = !canResize;
    resizeBtn.title = canResize ? "Resize" : "Plants don't have a size editor";
    if (canResize) resizeBtn.addEventListener("click", () => openResizeModal(eid));
    fresh.querySelector('[data-act="move"]').addEventListener("click", () => startMove(eid));
    // Phase 6.1 — rotate 90° about Y on every tap. We pull the current Y rotation out of the
    // stored quaternion (assuming pure-Y rotation, which is what the toolbar produces), bump
    // by π/2, rebuild the quaternion, and PATCH. The mesh re-renders via the SignalR upsert
    // pipeline, so we don't need to mutate rec.mesh.rotationQuaternion ourselves.
    const rotBtn = fresh.querySelector('[data-act="rotate"]');
    if (rotBtn) rotBtn.addEventListener("click", () => rotateEntityById(eid));
    // Phase 5.2.2 (B5) — Style/color picker. Available for any entity that renders a tintable
    // mesh, which today means everything except plants (whose green color is semantic). We let
    // the modal handle the no-op gracefully though, so the button just opens it for plants too.
    const styleBtn = fresh.querySelector('[data-act="style"]');
    if (styleBtn) styleBtn.addEventListener("click", () => openStyleModal(eid));
    // Phase 5.3 — tags. Display the count next to the icon so a glance tells the user whether
    // any tags exist; opens the tag editor on tap.
    const tagsBtn = fresh.querySelector('[data-act="tags"]');
    if (tagsBtn) {
      const tagCount = (entity.tags?.length || 0);
      const countEl = tagsBtn.querySelector('.tb-tags-count');
      if (countEl) countEl.textContent = tagCount > 0 ? ` ${tagCount}` : "";
      tagsBtn.title = tagCount > 0 ? `Tags (${tagCount})` : "Tags";
      tagsBtn.addEventListener("click", () => openTagsModal(eid));
    }
    fresh.querySelector('[data-act="duplicate"]').addEventListener("click", () => duplicateEntityById(eid));
    // Phase 5.4 — save the current entity as a reusable "My Prefab" template.
    const saveTplBtn = fresh.querySelector('[data-act="save-template"]');
    if (saveTplBtn) saveTplBtn.addEventListener("click", () => openSaveTemplateModal(eid));
    fresh.querySelector('[data-act="delete"]').addEventListener("click", () => deleteEntityById(eid));

    // Re-bind the persistent header bits (icon doesn't react, but name/pos/close do).
    nameEl.onclick = () => openRenameModal(eid);
    posEl.onclick = () => openPositionModal(eid);
    tb.querySelector(".tb-close").onclick = clearSelection;
  }

  // Phase 6.1 — rotate the entity 90° about Y. quaternionToYaw recovers the current Y rotation
  // from the stored quaternion; we add π/2 (modulo 2π) and rebuild a fresh quaternion. Pure-Y
  // rotations are the only kind the toolbar ever produces, so we don't have to worry about
  // pitch/roll bleed; if a future tool ever stores a tilted rotation, this will lose those
  // axes (which is fine — pure-Y is intentional for "stick to wall" and "rotate the floor").
  function quaternionToYaw(q) {
    if (!q) return 0;
    // Yaw extraction for a pure-Y or roughly-Y quaternion: yaw = 2 * atan2(y, w). For a true
    // arbitrary-rotation quaternion the more general formula is atan2(2(wy+xz), 1-2(y²+x²)),
    // but our quaternions only ever carry Y rotation, so the simpler form is exact and avoids
    // the wraparound discontinuity at ±π.
    const y = +q.y || 0, w = +q.w || 1;
    return 2 * Math.atan2(y, w);
  }
  async function rotateEntityById(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    const entity = rec.entity;
    const currentRot = entity.transform?.rotation || { x: 0, y: 0, z: 0, w: 1 };
    const currentYaw = quaternionToYaw(currentRot);
    const TAU = Math.PI * 2;
    let newYaw = (currentYaw + Math.PI / 2) % TAU;
    if (newYaw < 0) newYaw += TAU;
    const q = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), newYaw);
    const newRot = { x: q.x, y: q.y, z: q.z, w: q.w };
    try {
      const updated = await Api.updateEntity(gardenId, eid, {
        transform: {
          position: entity.transform?.position || { x: 0, y: 0, z: 0 },
          rotation: newRot,
          scale: entity.transform?.scale || { x: 1, y: 1, z: 1 },
        },
      });
      // Mesh is rebuilt by the SignalR upsert (or, if the broadcast is slow, we rebuild here
      // for instant feedback). meshForEntity is idempotent, so the SignalR repeat is a no-op.
      disposeEntity(eid);
      meshForEntity(updated);
      if (selectedEntityId === eid) selectEntity(eid);
      const deg = Math.round((newYaw * 180) / Math.PI);
      setStatus(`rotated to ${deg}°`);
    } catch (e) { console.error(e); setStatus("rotate failed"); }
  }

  // Duplicate the entity with a +1 ft X offset (plus snap if active). Pulled out of the old
  // renderEditPanel so both the toolbar and any future caller can share the same pipeline.
  async function duplicateEntityById(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    const entity = rec.entity;
    const pos = entity.transform?.position || { x: 0, y: 0, z: 0 };
    const offset = 1.0;
    const newPos = applySnapVec({ x: pos.x + offset, y: pos.y, z: pos.z });
    const body = {
      kind: entity.kind,
      name: entity.name,
      cropRef: entity.cropRef,
      parentId: entity.parentId,
      transform: {
        position: newPos,
        // Phase 6.1 — carry the source's rotation through the duplicate. Resetting to identity
        // here was a Phase-5 oversight that became visible once we shipped a rotation handle.
        rotation: entity.transform?.rotation || { x: 0, y: 0, z: 0, w: 1 },
        scale: entity.transform?.scale || { x: 1, y: 1, z: 1 },
      },
      geometry: entity.geometry,
      // Phase 5.3 — propagate tags on duplicate so the user doesn't have to re-tag a copy.
      tags: Array.isArray(entity.tags) ? [...entity.tags] : [],
    };
    try {
      const created = await Api.addEntity(gardenId, body);
      if (!meshRegistry.has(created.id)) meshForEntity(created);
      selectEntity(created.id);
      setStatus("duplicated");
    } catch (e) { console.error(e); setStatus("duplicate failed"); }
  }

  // ---------- Phase 5.2.1 position modal ----------
  // Numeric X/Y/Z inputs in the chosen unit, opened by tapping the toolbar position chip.
  // Converts to feet on save and applies the active snap before PATCH.
  function openPositionModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    const entity = rec.entity;
    const pos = entity.transform?.position || { x: 0, y: 0, z: 0 };
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Position (${escapeHtml(currentUnit)})</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          X <input type="number" data-field="x" step="any" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Y <input type="number" data-field="y" step="any" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Z <input type="number" data-field="z" step="any" />
        </label>
      </div>
      <div class="ai-meta" style="margin-top:8px;">${snapFt > 0 ? `Values will snap to ${escapeHtml(snapLabel())}.` : "Snap is off."}</div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const xInput = modal.querySelector('input[data-field="x"]');
    const yInput = modal.querySelector('input[data-field="y"]');
    const zInput = modal.querySelector('input[data-field="z"]');
    xInput.value = formatNum(fromFt(+pos.x || 0));
    yInput.value = formatNum(fromFt(+pos.y || 0));
    zInput.value = formatNum(fromFt(+pos.z || 0));

    const save = async () => {
      const xv = parseFloat(xInput.value);
      const yv = parseFloat(yInput.value);
      const zv = parseFloat(zInput.value);
      if (![xv, yv, zv].every(isFinite)) { setStatus("invalid number"); return; }
      const newPos = applySnapVec({ x: toFt(xv), y: toFt(yv), z: toFt(zv) });
      closeModal();
      try {
        const updated = await Api.updateEntity(gardenId, eid, {
          transform: {
            position: newPos,
            // Phase 6.1 — preserve rotation. Position modal only edits XYZ.
            rotation: entity.transform?.rotation || { x: 0, y: 0, z: 0, w: 1 },
            scale: entity.transform?.scale || { x: 1, y: 1, z: 1 },
          },
        });
        disposeEntity(eid);
        meshForEntity(updated);
        selectEntity(eid);
        setStatus(`moved to ${formatPos(newPos)}`);
      } catch (e) { console.error(e); setStatus("position update failed"); }
    };

    [xInput, yInput, zInput].forEach((el) => {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { save(); ev.preventDefault(); }
        else if (ev.key === "Escape") closeModal();
      });
    });
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", () => save());
    setTimeout(() => { xInput.focus(); xInput.select(); }, 50);
  }

  // ---------- Phase 5.2.1 unit + snap chip wiring ----------
  function refreshChipLabels() {
    const u = document.getElementById("unitChip");
    if (u) u.textContent = currentUnit;
    const s = document.getElementById("snapChip");
    if (s) s.textContent = `Snap: ${snapLabel()}`;
  }
  function cycleUnit() {
    const i = UnitCycle.indexOf(currentUnit);
    currentUnit = UnitCycle[(i + 1) % UnitCycle.length];
    localStorage.setItem("openharvest.unit", currentUnit);
    refreshChipLabels();
    // Re-render the toolbar so the position chip + any open modal flips into the new unit.
    if (selectedEntityId) {
      const rec = meshRegistry.get(selectedEntityId);
      if (rec) renderToolbar(rec.entity);
    }
    setStatus(`units: ${currentUnit}`);
  }
  function cycleSnap() {
    const i = SnapCycle.findIndex(s => Math.abs(s.ft - snapFt) < 1e-6);
    const next = SnapCycle[(i + 1) % SnapCycle.length];
    snapFt = next.ft;
    localStorage.setItem("openharvest.snap", String(snapFt));
    refreshChipLabels();
    // Phase 5.2.2 (B6) — flip the snap grid overlay to match the new interval.
    refreshSnapGrid();
    setStatus(`snap: ${next.label}`);
  }
  document.getElementById("unitChip")?.addEventListener("click", cycleUnit);
  document.getElementById("snapChip")?.addEventListener("click", cycleSnap);
  refreshChipLabels();
  // Phase 5.2.2 (B6) — initial snap-grid visibility based on persisted snap setting.
  refreshSnapGrid();

  // ---------- Phase 6.0 cut-away view ----------
  // When ON, every wall mesh (anything whose metadata.isWall === true) gets its dominant
  // material's `alpha` lowered to 0.30 so the user can peer into the rooms from above.
  // This is a v1 simplification — true "clip everything above Y=4 ft" needs a custom shader
  // or per-mesh BABYLON.Plane clipping, both of which fight Mesh.MergeMeshes for our door /
  // window composites. Fading the whole wall is uglier but instantly readable.
  //
  // We mutate the SHARED prefab materials directly. That's safe in our codebase because every
  // wall in a scene shares the same `houseWall` material from the prefab palette, so a single
  // alpha mutation per material updates every wall in lockstep. Per-instance tints (Style
  // button) clone the material — those clones also get walked here so per-tinted walls fade
  // correctly. Floors are NOT faded; they're the user's anchor while inspecting layout.
  const CUTAWAY_ALPHA = 0.30;
  const cutawayKey = "openharvest.cutaway";
  let cutawayActive = localStorage.getItem(cutawayKey) === "1";

  function refreshCutawayChip() {
    const chip = document.getElementById("cutawayChip");
    if (!chip) return;
    chip.classList.toggle("active", cutawayActive);
    chip.title = cutawayActive
      ? "Cut-away ON — walls are translucent. Tap to restore."
      : "Toggle cut-away view (fade walls to see into rooms)";
  }

  // Walk every registered mesh + its children, find walls (metadata.isWall), and set alpha
  // on the owning material(s). For MultiMaterial composites (door + window) we ONLY fade the
  // first sub-material — by construction every house builder passes [wall, accent] to the
  // merge, so subMaterials[0] is the drywall body. Skipping subMaterials[1] keeps the wood
  // door panel and the glass-blue window pane visible during cut-away, which is more
  // readable than a uniform fade of every surface in the segment.
  function applyCutawayToMaterial(mat, alpha) {
    if (!mat) return;
    if (mat instanceof BABYLON.MultiMaterial) {
      const subs = mat.subMaterials || [];
      if (subs.length > 0 && subs[0]) subs[0].alpha = alpha;
    } else {
      mat.alpha = alpha;
    }
  }

  function refreshCutaway() {
    const targetAlpha = cutawayActive ? CUTAWAY_ALPHA : 1.0;
    // Walk both the registry (which carries entity meshes) and the scene (catches any merged
    // child meshes that aren't directly registered but still have isWall metadata).
    const seen = new WeakSet();
    const visit = (m) => {
      if (!m || m.isDisposed?.()) return;
      if (m.metadata?.isWall && m.material && !seen.has(m.material)) {
        seen.add(m.material);
        applyCutawayToMaterial(m.material, targetAlpha);
      }
    };
    for (const rec of meshRegistry.values()) {
      visit(rec.mesh);
      // Cover any registered children (e.g., a future composite that parents instead of merges).
      if (rec.mesh && rec.mesh.getChildMeshes) {
        for (const child of rec.mesh.getChildMeshes(false)) visit(child);
      }
    }
    // Belt-and-braces: also walk loose scene meshes that carry the isWall flag.
    for (const m of scene.meshes) visit(m);
  }

  function toggleCutaway() {
    cutawayActive = !cutawayActive;
    localStorage.setItem(cutawayKey, cutawayActive ? "1" : "0");
    refreshCutawayChip();
    refreshCutaway();
    setStatus(cutawayActive ? "cut-away view: ON" : "cut-away view: off");
  }

  document.getElementById("cutawayChip")?.addEventListener("click", toggleCutaway);
  refreshCutawayChip();
  // Apply on first load so a persisted ON state takes effect after entities arrive. We call
  // refreshCutaway() once after the initial entity load below; this initial call is a no-op
  // when the registry is empty.
  refreshCutaway();

  // ---------- live sync (SignalR) ----------
  let connection = null;

  function applyEntityUpsert(entity) {
    if (!entity || !entity.id) return;
    // Idempotent: dispose any existing mesh for this id, recreate from server data.
    if (meshRegistry.has(entity.id)) disposeEntity(entity.id);
    meshForEntity(entity);
    // Keep the edit panel's selection visuals coherent across upserts. The mesh was just
    // recreated, so the outline + panel inputs need to be re-applied against the fresh data.
    if (selectedEntityId === entity.id) {
      selectEntity(entity.id);
    }
    // Phase 6.0 — keep the cut-away state coherent. A wall placed while the user has
    // cut-away ON should appear faded immediately; without this re-apply the new wall would
    // render at full opacity until the next toggle.
    if (typeof refreshCutaway === "function") refreshCutaway();
  }

  function applyEntityDelete(entityId) {
    if (meshRegistry.has(entityId)) disposeEntity(entityId);
    if (selectedEntityId === entityId) clearSelection();
  }

  async function connectHub(gid) {
    if (!window.signalR) {
      console.warn("SignalR client missing — live sync disabled");
      return;
    }
    connection = new signalR.HubConnectionBuilder()
      .withUrl(BASE + "hubs/garden")
      .withAutomaticReconnect([0, 1000, 2000, 5000, 10000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on("entityUpserted", applyEntityUpsert);
    connection.on("entityDeleted", applyEntityDelete);
    connection.on("nudge", showNudge);

    connection.onreconnected(async () => {
      try { await connection.invoke("Join", gid); } catch (e) { console.warn("rejoin failed", e); }
      // Pull a fresh snapshot to recover anything missed during the disconnect.
      try {
        const entities = await Api.getEntities(gid);
        // Drop any meshes for entities the server no longer has.
        const seen = new Set(entities.map(e => e.id));
        for (const id of [...meshRegistry.keys()]) if (!seen.has(id)) disposeEntity(id);
        entities.forEach(applyEntityUpsert);
      } catch (e) { console.warn("post-reconnect refresh failed", e); }
      setStatus("reconnected — live sync resumed");
    });

    try {
      await connection.start();
      await connection.invoke("Join", gid);
    } catch (e) {
      console.warn("hub connect failed — retrying via auto-reconnect", e);
    }
  }

  // ---------- ask the master gardener ----------
  let advisorConfigured = false;

  async function checkAdvisor() {
    const s = await Api.advisorStatus();
    advisorConfigured = !!s.configured;
    for (const id of ["askButton", "calendarButton", "planButton"]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.classList.toggle("unconfigured", !advisorConfigured);
      if (!advisorConfigured) btn.title = "Advisor not configured (set CLAUDE_API_KEY)";
    }
  }

  function openAskModal() {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>🌱 Ask the master gardener</h2>
      <input type="text" placeholder="What's eating my tomato leaves? When should I plant carrots?" autocomplete="off" />
      <div class="ai-output"></div>
      <div class="modal-actions">
        <button data-act="close">Close</button>
        <button class="primary" data-act="ask">Ask</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const input = modal.querySelector("input");
    const out = modal.querySelector(".ai-output");

    const ask = async () => {
      const q = input.value.trim();
      if (!q) return;
      out.innerHTML = `<div class="ai-spinner">thinking…</div>`;
      try {
        const a = await Api.ask(gardenId, q);
        out.innerHTML = `
          <div class="ai-answer">${escapeHtml(a.text)}</div>
          <div class="ai-meta">${escapeHtml(a.provider)} · ${escapeHtml(a.model)} · in ${a.inputTokens} / out ${a.outputTokens}</div>
        `;
      } catch (e) {
        console.error(e);
        out.innerHTML = `<div class="ai-spinner" style="color:var(--danger)">request failed</div>`;
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ask(); ev.preventDefault(); }
      else if (ev.key === "Escape") closeModal();
    });
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="close"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="ask"]').addEventListener("click", ask);
    setTimeout(() => input.focus(), 50);
  }

  document.getElementById("askButton").addEventListener("click", openAskModal);

  // ---------- planting calendar ----------
  function openCalendarModal() {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>📅 Planting calendar</h2>
      <div class="ai-output"></div>
      <div class="calendar-list"></div>
      <div class="modal-actions">
        <button data-act="close">Close</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const out = modal.querySelector(".ai-output");
    const list = modal.querySelector(".calendar-list");
    out.innerHTML = `<div class="ai-spinner">building your calendar…</div>`;

    Api.calendar(gardenId).then((cal) => {
      out.innerHTML = cal.summary
        ? `<div class="ai-answer">${escapeHtml(cal.summary)}</div>
           <div class="ai-meta">${escapeHtml(cal.provider)} · ${escapeHtml(cal.model)} · ${cal.entries.length} entries</div>`
        : `<div class="ai-meta">${escapeHtml(cal.provider)} · ${escapeHtml(cal.model)} · ${cal.entries.length} entries</div>`;
      renderCalendarList(list, cal.entries);
    }).catch((e) => {
      console.error(e);
      out.innerHTML = `<div class="ai-spinner" style="color:var(--danger)">calendar request failed</div>`;
    });

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="close"]').addEventListener("click", () => closeModal());
  }

  function renderCalendarList(container, entries) {
    container.innerHTML = "";
    if (!entries || entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "photo-empty";
      empty.textContent = "No entries — add some plants with a CropRef and try again.";
      container.appendChild(empty);
      return;
    }
    let lastMonth = "";
    for (const e of entries) {
      const date = new Date(e.date + "T00:00:00");
      const month = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (month !== lastMonth) {
        const h = document.createElement("div");
        h.className = "calendar-month";
        h.textContent = month;
        container.appendChild(h);
        lastMonth = month;
      }
      const row = document.createElement("div");
      row.className = "calendar-row";
      const day = date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
      row.innerHTML = `
        <div class="date">${escapeHtml(day)}</div>
        <div>
          <div class="crop">${escapeHtml(e.cropName || "")}</div>
          <div class="kind">${escapeHtml(humanKind(e.kind))}</div>
          ${e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : ""}
        </div>
      `;
      container.appendChild(row);
    }
  }

  function humanKind(k) {
    return ({
      "StartIndoors": "start indoors",
      "DirectSow": "direct sow",
      "Transplant": "transplant",
      "HarvestWindowStart": "harvest starts",
      "HarvestWindowEnd": "harvest ends",
      "Other": "task",
    })[k] || k;
  }

  document.getElementById("calendarButton").addEventListener("click", openCalendarModal);

  // ---------- Phase 5.5 — AI-assisted placement ----------
  //
  // Opens a modal with a chip-input for picking crops, then POSTs to /api/v1/advisor/plan/{gid}
  // to get back a list of suggestions. Each suggestion is rendered as a row in the modal AND as
  // a translucent ghost marker (wireframe sphere + name label) in the 3D scene. Tapping either
  // commits the suggestion as a real Plant entity at the suggested coordinates with the right
  // CropRef. Ghost markers are scene-only, never persisted, and cleared when the modal closes.
  const ghostMarkers = new Map();   // suggestionIndex -> { mesh, label, suggestion, placed }
  let planModalEl = null;

  function clearGhostMarkers() {
    for (const m of ghostMarkers.values()) {
      try { m.mesh?.dispose(); } catch { /* ignore */ }
      try { m.label?.dispose(); } catch { /* ignore */ }
    }
    ghostMarkers.clear();
  }

  // Build the dashed-sphere ghost marker. We use a wireframe sphere over a transparent fill
  // so it reads clearly as "preview, not real" against the existing solid plant cylinders.
  // The associated nameplate is a Babylon Plane with a dynamic-texture label that always faces
  // the camera. Fade out when the suggestion is committed (placed === true).
  function drawGhostMarker(idx, sugg, placed) {
    const x = sugg.position?.x ?? 0;
    const z = sugg.position?.z ?? 0;

    const sphere = BABYLON.MeshBuilder.CreateSphere(`ghost_${idx}`, { diameter: 1.0, segments: 12 }, scene);
    sphere.position = new BABYLON.Vector3(x, 0.5, z);
    sphere.isPickable = true;
    sphere.metadata = { ghost: true, idx };
    const mat = new BABYLON.StandardMaterial(`ghostMat_${idx}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.27, 0.85, 0.50);
    mat.emissiveColor = new BABYLON.Color3(0.20, 0.55, 0.30);
    mat.alpha = placed ? 0.18 : 0.45;
    mat.wireframe = true;
    sphere.material = mat;

    // Floating nameplate — a 1.6×0.4 plane high above the marker, billboard-mode aligned to
    // camera so the text stays readable from any angle. Dynamic texture is sized for ~24px
    // text rendered crisp on Hi-DPI screens (the canvas is 256×64).
    const labelText = `${sugg.cropName || sugg.cropRef || "Plant"}${placed ? "  ✓" : ""}`;
    const label = BABYLON.MeshBuilder.CreatePlane(`ghostLabel_${idx}`, { width: 2.4, height: 0.6 }, scene);
    label.position = new BABYLON.Vector3(x, 1.6, z);
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    label.isPickable = true;
    label.metadata = { ghost: true, idx };
    const tex = new BABYLON.DynamicTexture(`ghostTex_${idx}`, { width: 384, height: 96 }, scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 384, 96);
    ctx.fillStyle = placed ? "rgba(74, 222, 128, 0.85)" : "rgba(20, 20, 24, 0.85)";
    ctx.fillRect(0, 0, 384, 96);
    ctx.font = "bold 36px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = placed ? "#06210d" : "#eee";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, 192, 48);
    tex.update();
    const lmat = new BABYLON.StandardMaterial(`ghostLabelMat_${idx}`, scene);
    lmat.diffuseTexture = tex;
    lmat.emissiveTexture = tex;
    lmat.opacityTexture = tex;
    lmat.useAlphaFromDiffuseTexture = true;
    lmat.disableLighting = true;
    lmat.backFaceCulling = false;
    label.material = lmat;

    // Tapping a ghost marker commits the suggestion. We re-look-up the row in the modal by
    // index and trigger the same commit handler used by the in-modal "Place here" button — so
    // the UI state (placed flag, placed-style) stays in sync regardless of which surface the
    // user tapped.
    const onPick = () => {
      const rec = ghostMarkers.get(idx);
      if (!rec || rec.placed) return;
      commitSuggestion(idx);
    };
    sphere.actionManager = new BABYLON.ActionManager(scene);
    sphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickTrigger, onPick));
    label.actionManager = new BABYLON.ActionManager(scene);
    label.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickTrigger, onPick));

    return { mesh: sphere, label, suggestion: sugg, placed };
  }

  // Re-render a single ghost marker (e.g. after commit, to fade it out + add the checkmark).
  // We dispose + rebuild rather than mutating state in-place — simpler than tracking the
  // dynamic-texture redraw and the marker is cheap.
  function refreshGhostMarker(idx) {
    const rec = ghostMarkers.get(idx);
    if (!rec) return;
    try { rec.mesh?.dispose(); } catch { /* ignore */ }
    try { rec.label?.dispose(); } catch { /* ignore */ }
    const fresh = drawGhostMarker(idx, rec.suggestion, rec.placed);
    fresh.placed = rec.placed;
    ghostMarkers.set(idx, fresh);
  }

  async function commitSuggestion(idx) {
    const rec = ghostMarkers.get(idx);
    if (!rec || rec.placed) return;
    const sugg = rec.suggestion;
    setStatus(`placing ${sugg.cropName || sugg.cropRef}...`);

    // Resolve a real Crop row when we have a slug — gives us a proper commonName + slug for
    // the entity body (createPlant in the existing path uses { commonName, slug }). When the
    // slug doesn't resolve we fall back to the AI's display name with a null cropRef so the
    // plant still lands; the user can rename it later via the radial.
    let crop = null;
    if (sugg.cropRef) {
      try {
        const list = await Api.searchCrops(sugg.cropRef);
        crop = list.find(c => c.slug === sugg.cropRef) || list[0] || null;
      } catch { /* ignore */ }
    }

    const x = sugg.position?.x ?? 0;
    const z = sugg.position?.z ?? 0;

    // ParentId is taken straight from the AI response when present and known to the registry
    // (so a hallucinated id doesn't blow up the request). Otherwise we let the existing
    // findContainingBed helper attach to whatever bed contains the suggested point.
    let parentId = null;
    if (sugg.parentEntityId && meshRegistry.has(sugg.parentEntityId)) {
      parentId = sugg.parentEntityId;
    } else {
      try { parentId = findContainingBed({ x, y: 0, z }); } catch { parentId = null; }
    }

    const body = {
      kind: "Plant",
      name: crop ? crop.commonName : (sugg.cropName || sugg.cropRef || "Plant"),
      cropRef: crop ? crop.slug : (sugg.cropRef || null),
      parentId,
      transform: {
        position: { x, y: 0, z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: "Cylinder", radius: 0.25, height: 1.0 }
    };
    try {
      const created = await Api.addEntity(gardenId, body);
      meshForEntity(created);
      setStatus(`placed ${created.name}`);
      rec.placed = true;
      ghostMarkers.set(idx, rec);
      refreshGhostMarker(idx);
      // Update the matching modal row, if present.
      if (planModalEl) {
        const row = planModalEl.querySelector(`.plan-item[data-idx="${idx}"]`);
        if (row) {
          row.classList.add("placed");
          const btn = row.querySelector('button[data-act="place"]');
          if (btn) { btn.textContent = "✅ Placed"; btn.classList.add("placed"); btn.disabled = true; }
        }
      }
    } catch (e) {
      console.error("commit suggestion failed", e);
      setStatus("place failed");
    }
  }

  function openPlanModal() {
    closeModal();
    clearGhostMarkers();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>🤖 Plan with AI</h2>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">
        Type or pick the crops you want to grow — the advisor will suggest where to put them.
      </div>
      <div class="plan-chips" data-chips></div>
      <div class="tags-input-row">
        <input type="text" placeholder="Add a crop — start typing (e.g. tomato, basil)..." autocomplete="off" />
        <button data-act="add">Add</button>
      </div>
      <div class="suggestions" data-sugg></div>
      <div class="plan-actions-bar">
        <button data-act="run" class="primary" style="padding:10px 16px;background:var(--accent);color:#06210d;border:1px solid var(--accent);border-radius:6px;font-weight:600;cursor:pointer;flex:1;">Get suggestions</button>
      </div>
      <div class="ai-output"></div>
      <div class="plan-list"></div>
      <div class="modal-actions">
        <button data-act="placeAll">Place all</button>
        <button data-act="close">Close</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;
    planModalEl = modal;

    const chipsEl = modal.querySelector("[data-chips]");
    const suggEl = modal.querySelector("[data-sugg]");
    const input = modal.querySelector("input");
    const addBtn = modal.querySelector('button[data-act="add"]');
    const runBtn = modal.querySelector('button[data-act="run"]');
    const out = modal.querySelector(".ai-output");
    const list = modal.querySelector(".plan-list");
    const placeAllBtn = modal.querySelector('button[data-act="placeAll"]');

    // Selected crop slugs the user wants planned. We dedupe (case-insensitive) — the planner
    // won't return two suggestions for the same slug, and it keeps the chip row tidy.
    const selected = []; // [{ slug, commonName }]
    let currentSearch = [];
    let highlighted = -1;

    const renderChips = () => {
      chipsEl.innerHTML = "";
      if (selected.length === 0) {
        const empty = document.createElement("span");
        empty.className = "tags-empty";
        empty.textContent = "No crops yet — add some above.";
        chipsEl.appendChild(empty);
        return;
      }
      selected.forEach((c, i) => {
        const chip = document.createElement("span");
        chip.className = "plan-chip";
        chip.innerHTML = `${escapeHtml(c.commonName || c.slug)}<span class="x" data-i="${i}">×</span>`;
        chipsEl.appendChild(chip);
      });
    };
    chipsEl.addEventListener("click", (ev) => {
      const x = ev.target.closest(".x");
      if (!x) return;
      const i = +x.dataset.i;
      selected.splice(i, 1);
      renderChips();
    });

    const renderSugg = (results) => {
      suggEl.innerHTML = "";
      currentSearch = results || [];
      if (!input.value.trim() || currentSearch.length === 0) return;
      currentSearch.slice(0, 8).forEach((c, i) => {
        const div = document.createElement("div");
        div.className = "suggestion" + (i === highlighted ? " highlight" : "");
        div.innerHTML = `<span class="name">${escapeHtml(c.commonName)}</span>` +
          (c.scientificName ? `<span class="scientific">${escapeHtml(c.scientificName)}</span>` : "");
        div.addEventListener("click", () => addCrop(c));
        suggEl.appendChild(div);
      });
    };

    const addCrop = (c) => {
      if (!c) return;
      const slug = (c.slug || "").toLowerCase();
      if (!slug) return;
      if (selected.some(s => (s.slug || "").toLowerCase() === slug)) return;
      selected.push({ slug: c.slug, commonName: c.commonName });
      input.value = "";
      currentSearch = []; highlighted = -1;
      suggEl.innerHTML = "";
      renderChips();
    };

    let debounce = 0;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) { suggEl.innerHTML = ""; return; }
        const results = await Api.searchCrops(q);
        highlighted = -1;
        renderSugg(results);
      }, 80);
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { highlighted = Math.min(currentSearch.length - 1, highlighted + 1); renderSugg(currentSearch); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { highlighted = Math.max(0, highlighted - 1); renderSugg(currentSearch); ev.preventDefault(); }
      else if (ev.key === "Enter") {
        const pick = highlighted >= 0 ? currentSearch[highlighted] : currentSearch[0];
        if (pick) addCrop(pick);
        ev.preventDefault();
      } else if (ev.key === "Escape") {
        closeModal();
      }
    });
    addBtn.addEventListener("click", () => {
      const pick = currentSearch[Math.max(0, highlighted)] || currentSearch[0];
      if (pick) addCrop(pick);
      else if (input.value.trim()) {
        // Allow ad-hoc slug entry (lowercased + dashed) when nothing matches, so users
        // who know an OpenFarm slug don't have to wait for the autocomplete to land it.
        const slug = input.value.trim().toLowerCase().replace(/\s+/g, "-");
        addCrop({ slug, commonName: input.value.trim() });
      }
    });

    runBtn.addEventListener("click", async () => {
      if (selected.length === 0) {
        out.innerHTML = `<div class="ai-spinner" style="color:var(--danger)">add at least one crop first</div>`;
        return;
      }
      out.innerHTML = `<div class="ai-spinner">planning…</div>`;
      list.innerHTML = "";
      clearGhostMarkers();
      try {
        const plan = await Api.planPlacement(gardenId, selected.map(s => s.slug));
        out.innerHTML = plan.summary
          ? `<div class="ai-answer">${escapeHtml(plan.summary)}</div>
             <div class="ai-meta">${escapeHtml(plan.provider)} · ${escapeHtml(plan.model)} · ${plan.suggestions.length} suggestion(s)</div>`
          : `<div class="ai-meta">${escapeHtml(plan.provider)} · ${escapeHtml(plan.model)} · ${plan.suggestions.length} suggestion(s)</div>`;
        renderPlanList(list, plan.suggestions || []);
      } catch (e) {
        console.error(e);
        out.innerHTML = `<div class="ai-spinner" style="color:var(--danger)">plan request failed</div>`;
      }
    });

    placeAllBtn.addEventListener("click", async () => {
      // Walk the in-modal list in order and commit each suggestion that hasn't been placed
      // yet. We await each commit so the server sees them sequentially — adds latency vs.
      // Promise.all but keeps SignalR broadcast ordering predictable.
      const indices = [...ghostMarkers.keys()].sort((a, b) => a - b);
      for (const i of indices) {
        const rec = ghostMarkers.get(i);
        if (rec && !rec.placed) await commitSuggestion(i);
      }
    });

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModalAndClearGhosts(); });
    modal.querySelector('button[data-act="close"]').addEventListener("click", () => closeModalAndClearGhosts());

    renderChips();
    setTimeout(() => input.focus(), 50);
  }

  function renderPlanList(container, suggestions) {
    container.innerHTML = "";
    if (!suggestions || suggestions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "photo-empty";
      empty.textContent = "No suggestions — try different crops.";
      container.appendChild(empty);
      return;
    }
    suggestions.forEach((s, i) => {
      // Draw the ghost marker BEFORE the row so the scene + modal land together — gives the
      // user the strongest "the AI proposed this" visual feedback.
      const rec = drawGhostMarker(i, s, false);
      ghostMarkers.set(i, rec);

      const row = document.createElement("div");
      row.className = "plan-item";
      row.dataset.idx = i;
      const x = s.position?.x ?? 0, z = s.position?.z ?? 0;
      row.innerHTML = `
        <div class="crop">
          <span>${escapeHtml(s.cropName || s.cropRef || "Plant")}</span>
          <span class="pos">@ (${x.toFixed(1)}, ${z.toFixed(1)}) ft</span>
        </div>
        ${s.rationale ? `<div class="why">${escapeHtml(s.rationale)}</div>` : ""}
        <div class="row">
          <button data-act="place">Place here</button>
        </div>
      `;
      row.querySelector('button[data-act="place"]').addEventListener("click", () => commitSuggestion(i));
      container.appendChild(row);
    });
  }

  function closeModalAndClearGhosts() {
    clearGhostMarkers();
    planModalEl = null;
    closeModal();
  }

  document.getElementById("planButton").addEventListener("click", openPlanModal);

  // ---------- nudges ----------
  const shownNudgeKeys = new Set();
  const nudgeContainer = document.getElementById("nudges");

  function nudgeKey(n) { return `${n.entityId}:${n.kind}`; }

  function showNudge(n) {
    if (!n || !n.message) return;
    const key = nudgeKey(n);
    if (shownNudgeKeys.has(key)) return;   // dedupe across scan + signalr
    shownNudgeKeys.add(key);

    const el = document.createElement("div");
    el.className = "nudge";
    el.innerHTML = `<span>${escapeHtml(n.message)}</span><span class="x">×</span>`;
    el.addEventListener("click", () => dismiss());
    nudgeContainer.appendChild(el);

    function dismiss() {
      el.classList.add("fade");
      setTimeout(() => { el.remove(); shownNudgeKeys.delete(key); }, 400);
    }
    setTimeout(dismiss, 12000);
  }

  async function scanNudges() {
    if (!gardenId) return;
    try {
      const nudges = await Api.scanNudges(gardenId);
      // The API also broadcasts via SignalR; the dedupe set keeps them from doubling up.
      nudges.forEach(showNudge);
    } catch (e) { /* silent — nudges are best-effort */ }
  }

  // ---------- Phase 5.1: spatial awareness (compass + sun + time) ----------
  // Convention: world +Z = scene-north, +X = east, +Y = up. The compass overlay
  // rotates so its "N" stays pointing toward scene-north regardless of camera
  // alpha. The directional sun is recomputed from the garden lat/lng + wall clock
  // every 60s using SunCalc; intensity/colour are eased through a day/night curve.

  // Default location if the user hasn't set one yet — 40°N / 75°W (≈ Philadelphia).
  // Picked so the sun has *something* to compute on first load. The settings modal
  // shows a warning prompting the user to set their real coordinates.
  const DEFAULT_LAT = 40.0;
  const DEFAULT_LNG = -75.0;
  let gardenLat = DEFAULT_LAT;
  let gardenLng = DEFAULT_LNG;
  let gardenName = "My Garden";
  let gardenLocationSet = false; // true once we've persisted real lat/lng

  // Compass: rotate the SVG-style overlay every frame so N stays scene-north.
  // ArcRotateCamera.alpha = -π/2 looks down +Z; rotating the badge by (alpha + π/2)
  // CCW (i.e. negative CSS rotation) keeps N pointing up onscreen when the camera
  // looks north, swings to the side when the camera spins, etc.
  const compassEl = document.getElementById("compass");
  scene.onBeforeRenderObservable.add(() => {
    if (!compassEl) return;
    // Camera alpha increases CCW around +Y. CSS rotate is CW. The +90° offset
    // accounts for our default camera alpha of -π/2 (looking down +Z = north).
    const deg = (camera.alpha + Math.PI / 2) * (180 / Math.PI);
    compassEl.style.transform = `rotate(${deg}deg)`;
  });

  // Sun phase pill — derived from SunCalc.getTimes().
  const sunPhaseEl = document.getElementById("sunPhase");
  function setSunPhase(label) {
    if (!sunPhaseEl) return;
    if (!label) { sunPhaseEl.classList.add("hidden"); return; }
    sunPhaseEl.textContent = label;
    sunPhaseEl.classList.remove("hidden");
  }

  // SunCalc azimuth: radians from south, clockwise (south=0, west=π/2, north=±π).
  // Babylon DirectionalLight.direction is the direction that *light rays travel*,
  // i.e. the vector from sun → ground. We compute the sun's position relative to
  // the observer, then negate to get the ray direction.
  function updateSun() {
    if (typeof SunCalc === "undefined") return;
    const now = new Date();
    const pos = SunCalc.getPosition(now, gardenLat, gardenLng);
    const a = pos.azimuth;     // radians, south=0, +CW
    const e = pos.altitude;    // radians, 0=horizon, π/2=zenith

    // SunCalc azimuth a is measured clockwise from south (south=0, west=+π/2,
    // north=±π, east=-π/2). The unit vector from observer TO sun, in our world
    // frame (+X=east, +Y=up, +Z=north), is therefore:
    //   sun_x = -sin(a) * cos(e)      // west has sin(a)>0, but west = -X, so sign flip
    //   sun_y =  sin(e)
    //   sun_z = -cos(a) * cos(e)      // south has cos(a)>0, but south = -Z, so sign flip
    // The light's RAY direction (sun → ground) is the negation:
    const cosE = Math.cos(e);
    const dirX =  Math.sin(a) * cosE;   // east+ when ray heads east
    const dirY = -Math.sin(e);          // down (negative Y) while sun is above horizon
    const dirZ =  Math.cos(a) * cosE;   // +Z (north) when sun is south of us — checks out:
                                         // at solar noon a=0, dirZ=+cos(e) → light shines north.
    sun.direction = new BABYLON.Vector3(dirX, dirY, dirZ).normalize();

    // Day/night curve. Above horizon: ramp from a "moonlit" floor up to full sun at zenith.
    // Below horizon: same floor — never go pitch black, beds and toolbar stay legible.
    // Phase 5.2.2 (B1) — bumped the sky/hemispheric floor to 0.35 so the canvas is always
    // readable on phones; previously the night intensities of 0.05 / 0.18 made the scene
    // unusable on iPhone Safari at midnight. Sun direction still tracks SunCalc precisely so
    // dawn/dusk shadows still feel real.
    const NIGHT_SUN_FLOOR = 0.18;   // gentle directional fill so beds catch a faint highlight
    const NIGHT_SKY_FLOOR = 0.35;   // hemispheric ambient — the load-bearing legibility light
    if (e > 0) {
      const t = Math.min(1, e / (Math.PI / 2));         // 0 at horizon, 1 at zenith
      sun.intensity = Math.max(NIGHT_SUN_FLOOR, 0.30 + 0.70 * t);
      // Warm colour near horizon (sunrise/sunset), cooler near zenith.
      const warm = 1.0 - t;                              // 1 at horizon, 0 at zenith
      sun.diffuse = new BABYLON.Color3(
        1.0,
        0.78 + 0.18 * t,                                 // 0.78 → 0.96
        0.55 + 0.31 * t                                  // 0.55 → 0.86
      );
      sun.specular = sun.diffuse;
      sky.intensity = Math.max(NIGHT_SKY_FLOOR, 0.35 + 0.20 * t);  // 0.35 → 0.55
      sky.diffuse = new BABYLON.Color3(
        0.55 + 0.10 * t,
        0.70 + 0.08 * t,
        0.95
      );
      // Tint background slightly with daylight so the canvas isn't a black void.
      const bgT = 0.15 * t;
      scene.clearColor = new BABYLON.Color4(0.06 + bgT, 0.07 + bgT, 0.08 + bgT * 1.2, 1);
      void warm; // (warm reserved for future fog tinting)
    } else {
      // Night: hold the floors but tint cool. We still let the sun direction drift past the
      // horizon so the directional light hits the underside of objects subtly — feels like
      // moonlight rather than a flat torch. clearColor is a touch warmer than before so the
      // canvas reads as "deep dusk / moonlit" rather than "off".
      sun.intensity = NIGHT_SUN_FLOOR;
      sun.diffuse = new BABYLON.Color3(0.42, 0.50, 0.78);   // moonlit blue with a hint of warmth
      sun.specular = sun.diffuse;
      sky.intensity = NIGHT_SKY_FLOOR;
      sky.diffuse = new BABYLON.Color3(0.40, 0.48, 0.68);
      sky.groundColor = new BABYLON.Color3(0.20, 0.22, 0.26);
      scene.clearColor = new BABYLON.Color4(0.07, 0.08, 0.13, 1);
    }

    // Phase label from SunCalc times. getTimes() returns Date objects keyed by
    // dawn / sunrise / sunriseEnd / solarNoon / sunsetStart / sunset / dusk.
    const times = SunCalc.getTimes(now, gardenLat, gardenLng);
    const t = now.getTime();
    const ms = (d) => (d instanceof Date && !isNaN(d.getTime())) ? d.getTime() : NaN;
    let phase = "🌙 Night";
    if (e > 0) {
      if (t < ms(times.sunriseEnd))      phase = "🌅 Dawn";
      else if (t < ms(times.sunsetStart)) phase = "☀ Mid-day";
      else                                phase = "🌇 Dusk";
    } else {
      // Pre-dawn glow vs deep night vs dusk-tail
      if (!isNaN(ms(times.dawn)) && t > ms(times.dawn) && t < ms(times.sunrise)) phase = "🌅 Dawn";
      else if (!isNaN(ms(times.dusk)) && t > ms(times.sunset) && t < ms(times.dusk)) phase = "🌇 Dusk";
      else phase = "🌙 Night";
    }
    setSunPhase(phase);
  }

  let sunTimer = 0;
  function startSunLoop() {
    clearInterval(sunTimer);
    updateSun();
    sunTimer = setInterval(updateSun, 60 * 1000); // every minute is plenty
  }

  // Settings modal — gear-icon entry point.
  function openSettingsModal() {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    const warnHidden = gardenLocationSet ? "hidden" : "";
    modal.innerHTML = `
      <h2>⚙ Garden settings</h2>
      <div class="settings-section">
        <label>Garden name</label>
        <input type="text" data-field="name" placeholder="My Garden" />
      </div>
      <div class="settings-section">
        <label>Location (decimal degrees)</label>
        <div class="settings-row">
          <input type="number" step="0.0001" data-field="lat" placeholder="40.0" />
          <input type="number" step="0.0001" data-field="lng" placeholder="-75.0" />
        </div>
        <button class="settings-locate" data-act="locate">Use my location</button>
        <div class="settings-help ${warnHidden}" data-help>
          Set your location for an accurate sun position. Defaults to ${DEFAULT_LAT.toFixed(1)} / ${DEFAULT_LNG.toFixed(1)}.
        </div>
      </div>
      <!-- Phase 5.6: portable scene export. GLB is the standard glTF binary format Blender,
           Three.js, Unity, and most viewers open natively. The Babylon-native .babylon JSON
           dump is offered alongside as a lighter format for Babylon-only round-tripping. -->
      <div class="settings-section">
        <label>Export</label>
        <button class="settings-locate" data-act="export-glb">📦 Export Scene (.glb)</button>
        <button class="settings-locate" data-act="export-babylon">📄 Export Scene (.babylon JSON)</button>
      </div>
      <div class="modal-actions">
        <button data-act="cancel">Close</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const nameInput = modal.querySelector('[data-field="name"]');
    const latInput = modal.querySelector('[data-field="lat"]');
    const lngInput = modal.querySelector('[data-field="lng"]');
    const locateBtn = modal.querySelector('[data-act="locate"]');
    const helpEl = modal.querySelector('[data-help]');

    nameInput.value = gardenName || "";
    latInput.value = gardenLocationSet ? String(gardenLat) : "";
    lngInput.value = gardenLocationSet ? String(gardenLng) : "";

    locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { setStatus("geolocation unavailable"); return; }
      locateBtn.disabled = true;
      locateBtn.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => {
          latInput.value = p.coords.latitude.toFixed(4);
          lngInput.value = p.coords.longitude.toFixed(4);
          locateBtn.disabled = false;
          locateBtn.textContent = "Use my location";
          if (helpEl) helpEl.classList.add("hidden");
        },
        (err) => {
          console.warn("geolocation error", err);
          locateBtn.disabled = false;
          locateBtn.textContent = "Use my location";
          setStatus("couldn't get location — enter manually");
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    });

    // Phase 5.6: portable scene export. GLB is the headline format; .babylon JSON is offered
    // as a lighter Babylon-native dump. Both filter to entity meshes only via shouldExportNode.
    const exportGlbBtn = modal.querySelector('[data-act="export-glb"]');
    if (exportGlbBtn) {
      exportGlbBtn.addEventListener("click", async () => {
        if (!window.BABYLON || !BABYLON.GLTF2Export) {
          setStatus("glTF serializer not loaded");
          return;
        }
        const filename = `openharvest-${(gardenId || "garden").slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`;
        // Filter: only entity meshes (those with metadata.entityId) + their descendants. The
        // ground, snap grid, sun, compass, and ghost pins are intentionally excluded.
        const options = {
          shouldExportNode: (node) => {
            if (node?.metadata?.entityId) return true;
            let p = node?.parent;
            while (p) {
              if (p.metadata?.entityId) return true;
              p = p.parent;
            }
            return false;
          }
        };
        exportGlbBtn.disabled = true;
        const oldLabel = exportGlbBtn.textContent;
        exportGlbBtn.textContent = "Exporting…";
        try {
          const glb = await BABYLON.GLTF2Export.GLBAsync(scene, filename, options);
          glb.downloadFiles();
          setStatus("scene exported");
        } catch (e) {
          console.error("glb export failed", e);
          setStatus("export failed");
        } finally {
          exportGlbBtn.disabled = false;
          exportGlbBtn.textContent = oldLabel;
        }
      });
    }
    const exportBabylonBtn = modal.querySelector('[data-act="export-babylon"]');
    if (exportBabylonBtn) {
      exportBabylonBtn.addEventListener("click", () => {
        if (!window.BABYLON || !BABYLON.SceneSerializer) {
          setStatus("scene serializer unavailable");
          return;
        }
        try {
          const data = BABYLON.SceneSerializer.Serialize(scene);
          const json = JSON.stringify(data);
          const blob = new Blob([json], { type: "application/babylon" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `openharvest-${(gardenId || "garden").slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.babylon`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setStatus("scene exported");
        } catch (e) {
          console.error("babylon export failed", e);
          setStatus("export failed");
        }
      });
    }

    const close = () => closeModal();
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) close(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", close);
    modal.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const latRaw = latInput.value.trim();
      const lngRaw = lngInput.value.trim();
      const body = {};
      if (name) body.name = name;
      if (latRaw !== "") {
        const v = parseFloat(latRaw);
        if (isFinite(v) && v >= -90 && v <= 90) body.latitude = v;
      }
      if (lngRaw !== "") {
        const v = parseFloat(lngRaw);
        if (isFinite(v) && v >= -180 && v <= 180) body.longitude = v;
      }
      try {
        const updated = await Api.updateGarden(gardenId, body);
        gardenName = updated.name || gardenName;
        if (typeof updated.latitude === "number") { gardenLat = updated.latitude; gardenLocationSet = true; }
        if (typeof updated.longitude === "number") { gardenLng = updated.longitude; gardenLocationSet = true; }
        setStatus("settings saved");
        startSunLoop();   // re-run sun calc with new coords immediately
        close();
      } catch (e) {
        console.error(e);
        setStatus("failed to save settings");
      }
    });
    setTimeout(() => nameInput.focus(), 50);
  }
  document.getElementById("settingsButton").addEventListener("click", openSettingsModal);

  // ---------- bootstrap ----------
  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => scene.render());

  (async () => {
    try {
      setStatus("connecting...");
      gardenId = await ensureGarden();
      setStatus("loading garden...");
      // Phase 5.1: pull garden meta first so the sun loop starts with the user's
      // real lat/lng (if set). Fall back to defaults if the garden doesn't have
      // coordinates yet — the settings modal warns the user to set them.
      const garden = await Api.getGarden(gardenId);
      if (garden) {
        gardenName = garden.name || gardenName;
        if (typeof garden.latitude === "number" && typeof garden.longitude === "number") {
          gardenLat = garden.latitude;
          gardenLng = garden.longitude;
          gardenLocationSet = true;
        }
      }
      startSunLoop();
      const entities = await Api.getEntities(gardenId);
      entities.forEach(meshForEntity);
      // Phase 6.0 — re-apply persisted cut-away state now that walls exist in the scene.
      refreshCutaway();
      setStatus(entities.length === 0
        ? "empty garden — tap Bed or Plant to start"
        : `loaded ${entities.length} entities — tap to select, long-press for radial`);
      // Live sync over SignalR.
      connectHub(gardenId);
      // Probe advisor configuration so the Ask button reflects state.
      checkAdvisor();
      // Initial nudge scan + periodic refresh every 5 minutes.
      scanNudges();
      setInterval(scanNudges, 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      setStatus("failed to load — see console", 0);
    }
  })();
})();
