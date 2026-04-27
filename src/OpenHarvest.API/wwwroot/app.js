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
  camera.panningSensibility = 50;

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

  // ---------- entity → mesh registry ----------
  /** @type {Map<string, {entity:any, mesh:BABYLON.Mesh, label:BABYLON.Mesh|null}>} */
  const meshRegistry = new Map();

  function disposeEntity(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    rec.label?.dispose();
    rec.mesh.dispose();
    meshRegistry.delete(eid);
  }

  function meshForEntity(entity) {
    const t = entity.transform || {};
    const pos = t.position || { x: 0, y: 0, z: 0 };
    const scale = t.scale || { x: 1, y: 1, z: 1 };
    const geom = entity.geometry || {};
    const kind = geom.kind || "Box";

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
    mesh.position = new BABYLON.Vector3(pos.x, pos.y + yOffset, pos.z);
    mesh.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);
    mesh.metadata = { entityId: entity.id, kind: entity.kind };
    mesh.isPickable = true;

    if (assignDefaultMaterial) {
      const mat = new BABYLON.StandardMaterial(`mat_${entity.id}`, scene);
      mat.diffuseColor =
        entity.kind === "Plant" ? new BABYLON.Color3(0.20, 0.65, 0.15) :
        entity.kind === "Bed"   ? new BABYLON.Color3(0.45, 0.30, 0.18) :
                                  new BABYLON.Color3(0.6, 0.6, 0.6);
      mesh.material = mat;
    }

    let label = null;
    if (entity.name) {
      label = makeLabel(entity.id, entity.name, mesh, geom);
    }
    meshRegistry.set(entity.id, { entity, mesh, label });
    return mesh;
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

  // ---------- Phase 5.0 selection state ----------
  // selectedEntityId is the id of the entity currently shown in the edit panel.
  // lastSelectedMesh is tracked separately so we can clear the outline cleanly even when the
  // mesh has been disposed and recreated by the upsert pipeline.
  let selectedEntityId = null;
  let lastSelectedMesh = null;

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
    const pick = scene.pick(scene.pointerX, scene.pointerY,
      (m) => m.metadata && m.metadata.entityId);
    return pick.hit ? pick.pickedMesh : null;
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
        // Phase 5.2: a prefab was selected in the picker; this tap places it. If somehow
        // pendingPrefabRef is null (user re-entered the mode without picking), bail back to idle.
        const p = pickGround();
        if (p && pendingPrefabRef) {
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
    const body = {
      kind: "Bed",
      name: "Bed",
      transform: {
        position: { x: cx, y: 0, z: cz },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: "Box", size: { x: w, y: 0.4, z: d } }
    };
    setStatus("placing bed...");
    const created = await Api.addEntity(gardenId, body);
    meshForEntity(created);
    setStatus(`placed bed (${w.toFixed(1)}×${d.toFixed(1)})`);
  }

  async function createPlant(p, crop) {
    // Find the bed underneath, if any, to set ParentId — Phase 1 hierarchy enforcement is loose:
    // we attach to whichever bed contains the click point, else null.
    const parentId = findContainingBed(p);
    const body = {
      kind: "Plant",
      name: crop ? crop.commonName : "Plant",
      cropRef: crop ? crop.slug : null,
      parentId: parentId,
      transform: {
        position: { x: p.x, y: 0, z: p.z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: "Cylinder", radius: 0.25, height: 1.0 }
    };
    setStatus("placing plant...");
    const created = await Api.addEntity(gardenId, body);
    meshForEntity(created);
    setStatus(`placed ${created.name}`);
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
    const body = {
      kind: "Bed",
      name: prefab.name,
      transform: {
        position: { x: p.x, y: 0, z: p.z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
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
    setStatus(`placed ${prefab.name}`);
  }

  function openPrefabPickerModal() {
    closeModal();
    const lib = window.OpenHarvestPrefabs;
    if (!lib || typeof lib.__listByCategory !== "function") {
      setStatus("prefab library not loaded");
      return;
    }
    const groups = lib.__listByCategory();

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
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    modal.querySelectorAll(".prefab-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const slug = tile.dataset.slug;
        if (!slug) return;
        pendingPrefabRef = slug;
        closeModal();
        setMode(Mode.PrefabPick);
        const def_ = lib[slug];
        setStatus(`tap the ground to place ${def_?.name || slug}`);
      });
    });

    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
  }

  function findContainingBed(p) {
    for (const [, rec] of meshRegistry) {
      if (rec.entity.kind !== "Bed") continue;
      const g = rec.entity.geometry;
      const t = rec.entity.transform;
      if (!g?.size) continue;
      const cx = t.position.x, cz = t.position.z;
      const w = g.size.x, d = g.size.z;
      if (p.x >= cx - w / 2 && p.x <= cx + w / 2 &&
          p.z >= cz - d / 2 && p.z <= cz + d / 2) {
        return rec.entity.id;
      }
    }
    return null;
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

    const origin = {
      x: rec.mesh.position.x,
      y: rec.mesh.position.y,
      z: rec.mesh.position.z,
    };
    let dragging = false;
    let committed = false;

    const followPointer = () => {
      const p = pickGround();
      if (!p) return;
      rec.mesh.position.x = p.x;
      rec.mesh.position.z = p.z;
    };

    const cleanup = () => {
      scene.onPointerObservable.remove(moveObs);
      window.removeEventListener("keydown", onKey, true);
      camera.attachControl(canvas, true);
      canvas.style.cursor = "";
      mode = Mode.Idle;
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      rec.mesh.position.x = origin.x;
      rec.mesh.position.z = origin.z;
      cleanup();
      setStatus("move cancelled");
    };

    const commit = async () => {
      if (committed) return;
      committed = true;
      cleanup();
      const newPos = { x: rec.mesh.position.x, y: 0, z: rec.mesh.position.z };
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
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: rec.entity.transform?.scale || { x: 1, y: 1, z: 1 },
          },
        });
        rec.entity = updated;
        // Phase 5.0: refresh the edit panel inputs if this is the selected entity.
        if (selectedEntityId === eid) renderEditPanel(updated);
        setStatus(`moved to (${newPos.x.toFixed(1)}, ${newPos.z.toFixed(1)})`);
      } catch (e) {
        console.error(e);
        // Snap back on server failure so client state matches truth.
        rec.mesh.position.x = origin.x;
        rec.mesh.position.z = origin.z;
        setStatus("move failed — reverted");
      }
    };

    const moveObs = scene.onPointerObservable.add((info) => {
      if (committed) return;
      if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        // Only arm on left-button (or touch). Any pointerdown counts on touch (button 0).
        dragging = true;
        canvas.style.cursor = "grabbing";
        followPointer();
      } else if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        if (dragging) followPointer();
      } else if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
        // Only commit if the user actually pressed down inside this move session. This
        // prevents the trailing pointerup from the radial-menu tap from prematurely ending
        // the move before the user's first drag.
        if (!dragging) return;
        dragging = false;
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

  // ---------- resize bed modal ----------
  // Beds store their footprint in geometry.size (x = width, z = depth, y = thickness).
  // We expose width and depth as feet-style inputs (the canonical engine unit is 1 unit ≈
  // 1 foot). Server accepts the full Geometry on PATCH, so we send a fresh Box with the
  // existing thickness preserved.
  async function openResizeModal(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec || rec.entity.kind !== "Bed") return;
    // Phase 5.2: prefab-geometry beds are sized through the persistent edit panel (which has
    // a clamped 3-axis size editor). Steer the user there instead of squashing the prefab
    // through the legacy 2-axis Box resizer, which would discard prefabRef on save.
    if (rec.entity.geometry?.kind === "Prefab") {
      selectEntity(eid);
      setStatus("use the edit panel to resize this prefab");
      return;
    }
    const size = rec.entity.geometry?.size || { x: 4, y: 0.4, z: 4 };
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>Resize bed</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Width (ft)
          <input type="number" data-field="w" min="1" max="30" step="0.5" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim);">
          Depth (ft)
          <input type="number" data-field="d" min="1" max="30" step="0.5" />
        </label>
      </div>
      <div class="ai-meta" style="margin-top:8px;">Allowed range: 1.0 – 30.0 ft per side.</div>
      <div class="modal-actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    const wInput = modal.querySelector('input[data-field="w"]');
    const dInput = modal.querySelector('input[data-field="d"]');
    wInput.value = (Number(size.x) || 4).toFixed(1);
    dInput.value = (Number(size.z) || 4).toFixed(1);

    const save = async () => {
      const w = parseFloat(wInput.value);
      const d = parseFloat(dInput.value);
      if (!isFinite(w) || !isFinite(d) || w < 1 || w > 30 || d < 1 || d > 30) {
        setStatus("size must be between 1 and 30 ft per side");
        return;
      }
      closeModal();
      try {
        const updated = await Api.updateEntity(gardenId, eid, {
          geometry: {
            kind: "Box",
            size: { x: w, y: Number(size.y) || 0.4, z: d },
          },
        });
        // Geometry changed — easiest path is to dispose + recreate the mesh from the server
        // payload. SignalR will broadcast the same upsert; applyEntityUpsert is idempotent.
        disposeEntity(eid);
        meshForEntity(updated);
        // Phase 5.0: keep panel coherent.
        if (selectedEntityId === eid) selectEntity(eid);
        setStatus(`resized to ${w.toFixed(1)}×${d.toFixed(1)}`);
      } catch (e) { console.error(e); setStatus("resize failed"); }
    };

    wInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { save(); ev.preventDefault(); } else if (ev.key === "Escape") closeModal(); });
    dInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { save(); ev.preventDefault(); } else if (ev.key === "Escape") closeModal(); });
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeModal(); });
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal());
    modal.querySelector('[data-act="save"]').addEventListener("click", () => save());
    setTimeout(() => { wInput.focus(); wInput.select(); }, 50);
  }

  // ---------- Phase 5.0 selection + persistent edit panel ----------
  // selectEntity/clearSelection are the single entry points for changing what's in the
  // panel. They also own the Babylon outline state so highlight + panel never drift apart.
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
    renderEditPanel(rec.entity);
    document.getElementById("editPanel").classList.add("open");
  }

  function clearSelection() {
    if (lastSelectedMesh && !lastSelectedMesh.isDisposed()) {
      lastSelectedMesh.renderOutline = false;
    }
    selectedEntityId = null;
    lastSelectedMesh = null;
    const panel = document.getElementById("editPanel");
    panel.classList.remove("open");
    // Reset to empty-state markup so the next open doesn't briefly flash stale data.
    const content = panel.querySelector(".ep-content");
    if (content) content.innerHTML = `<div class="ep-empty">Tap a bed or plant to edit</div>`;
  }

  function renderEditPanel(entity) {
    const content = document.querySelector("#editPanel .ep-content");
    if (!entity) {
      content.innerHTML = `<div class="ep-empty">Tap a bed or plant to edit</div>`;
      return;
    }
    const t = entity.transform || {};
    const pos = t.position || { x: 0, y: 0, z: 0 };
    const g = entity.geometry || {};
    // Phase 5.2: prefab geometry. Prefab entities are stored as kind=Bed today (so they
    // parent plants the same way raised beds do) but their geometry.kind === "Prefab" picks
    // them out for size+display tweaks. We resolve the prefab definition once here so the
    // header can show the icon + display name, and the size editor can clamp to the prefab's
    // own min/max bounds.
    const isPrefab = g.kind === "Prefab";
    const prefabDef = isPrefab ? (window.OpenHarvestPrefabs?.[g.prefabRef] || null) : null;
    const sizeDefault = (isPrefab && prefabDef) ? prefabDef.defaultSize : { x: 1, y: 1, z: 1 };
    const size = g.size || sizeDefault;
    const isBed = entity.kind === "Bed" && !isPrefab;
    const isPlant = entity.kind === "Plant";
    // Size bounds for the inputs. Beds use the historical 1–30 ft range; prefabs use whatever
    // the prefab declared. Plants don't get size editors.
    const minSize = (isPrefab && prefabDef) ? prefabDef.minSize : { x: 1, y: 0.4, z: 1 };
    const maxSize = (isPrefab && prefabDef) ? prefabDef.maxSize : { x: 30, y: 30, z: 30 };
    const headerLabel = isPrefab
      ? `${prefabDef?.icon || "📦"} ${escapeHtml(prefabDef?.name || g.prefabRef || "Prefab")}: ${escapeHtml(entity.name || "")}`
      : `${escapeHtml(entity.kind)}: ${escapeHtml(entity.name || "")}`;
    content.innerHTML = `
      <div class="ep-header">
        <span>${headerLabel}</span>
        <span class="ep-close" data-act="close" title="Close">×</span>
      </div>
      <div class="ep-section">
        <label>Name</label>
        <input type="text" id="ep-name" value="${escapeHtml(entity.name || "")}" placeholder="Entity name" />
      </div>
      ${isPlant ? `
      <div class="ep-section">
        <label>Crop</label>
        <input type="text" id="ep-cropref" value="${escapeHtml(entity.cropRef || "")}" placeholder="Tap to change crop..." readonly />
      </div>` : ""}
      <div class="ep-section">
        <label>Position (ft)</label>
        <div class="ep-row">
          <input type="number" id="ep-px" step="0.5" value="${(+pos.x).toFixed(2)}" title="X" />
          <input type="number" id="ep-py" step="0.5" value="${(+pos.y).toFixed(2)}" title="Y" />
          <input type="number" id="ep-pz" step="0.5" value="${(+pos.z).toFixed(2)}" title="Z" />
        </div>
      </div>
      ${isBed ? `
      <div class="ep-section">
        <label>Size (ft)</label>
        <div class="ep-row row-2">
          <input type="number" id="ep-sw" min="1" max="30" step="0.5" value="${(+size.x).toFixed(1)}" title="Width" />
          <input type="number" id="ep-sd" min="1" max="30" step="0.5" value="${(+size.z).toFixed(1)}" title="Depth" />
        </div>
      </div>` : ""}
      ${isPrefab ? `
      <div class="ep-section">
        <label>Size (ft) — width / height / depth</label>
        <div class="ep-row">
          <input type="number" id="ep-pw" min="${minSize.x}" max="${maxSize.x}" step="0.5" value="${(+size.x).toFixed(2)}" title="Width" />
          <input type="number" id="ep-ph" min="${minSize.y}" max="${maxSize.y}" step="0.5" value="${(+size.y).toFixed(2)}" title="Height" />
          <input type="number" id="ep-pd" min="${minSize.z}" max="${maxSize.z}" step="0.5" value="${(+size.z).toFixed(2)}" title="Depth" />
        </div>
      </div>` : ""}
      <div class="ep-section">
        <label>Tags</label>
        <div class="tags-stub">Tags coming in Phase 5.3</div>
      </div>
      <div class="ep-actions">
        <button data-act="photo" title="Photo">📷</button>
        ${isPlant
          ? `<button data-act="diagnose" title="Diagnose">🔍</button>`
          : `<button disabled title="Plants only">🔍</button>`}
        <button data-act="duplicate" title="Duplicate">📋</button>
        <button data-act="move" title="Move (drag)">🚚</button>
        <button data-act="delete" class="danger" title="Delete">🗑</button>
      </div>
    `;

    const eid = entity.id;

    // Name edit — opens existing rename modal so the same flow handles crop autocomplete.
    const nameInput = content.querySelector("#ep-name");
    if (nameInput) {
      nameInput.addEventListener("focus", () => {
        nameInput.blur();
        openRenameModal(eid);
      });
    }

    // Crop chip — Plants only. Tap → existing rename flow (which doubles as crop change for
    // plants since it embeds the crop autocomplete).
    if (isPlant) {
      const cropInput = content.querySelector("#ep-cropref");
      if (cropInput) {
        cropInput.addEventListener("click", () => openRenameModal(eid));
      }
    }

    // Position commit — PATCH on blur or Enter. Replace the mesh + label using the same
    // dispose+recreate pipeline used by Resize so SignalR upserts and inline edits agree.
    const px = content.querySelector("#ep-px");
    const py = content.querySelector("#ep-py");
    const pz = content.querySelector("#ep-pz");
    const commitPos = async () => {
      const newPos = { x: +px.value, y: +py.value, z: +pz.value };
      // Skip the round-trip if nothing actually changed — avoids spurious SignalR fanout.
      if (newPos.x === +pos.x && newPos.y === +pos.y && newPos.z === +pos.z) return;
      try {
        const updated = await Api.updateEntity(gardenId, eid, {
          transform: {
            position: newPos,
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: entity.transform?.scale || { x: 1, y: 1, z: 1 },
          },
        });
        disposeEntity(eid);
        meshForEntity(updated);
        selectEntity(eid);
        setStatus(`moved to (${newPos.x.toFixed(1)}, ${newPos.z.toFixed(1)})`);
      } catch (e) { console.error(e); setStatus("position update failed"); }
    };
    for (const el of [px, py, pz]) {
      if (!el) continue;
      el.addEventListener("change", commitPos);
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); el.blur(); } });
    }

    if (isBed) {
      const sw = content.querySelector("#ep-sw");
      const sd = content.querySelector("#ep-sd");
      const commitSize = async () => {
        const w = Math.max(1, Math.min(30, +sw.value));
        const d = Math.max(1, Math.min(30, +sd.value));
        if (w === +size.x && d === +size.z) return;
        try {
          const updated = await Api.updateEntity(gardenId, eid, {
            geometry: { kind: "Box", size: { x: w, y: Number(size.y) || 0.4, z: d } },
          });
          disposeEntity(eid);
          meshForEntity(updated);
          selectEntity(eid);
          setStatus(`resized to ${w.toFixed(1)}×${d.toFixed(1)}`);
        } catch (e) { console.error(e); setStatus("resize failed"); }
      };
      for (const el of [sw, sd]) {
        if (!el) continue;
        el.addEventListener("change", commitSize);
        el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); el.blur(); } });
      }
    }

    if (isPrefab) {
      // Prefab size editor — clamps to the prefab definition's own min/max so a Pot can't be
      // accidentally sized like a Greenhouse. We send a fresh Geometry that preserves the
      // prefabRef; the server stores it verbatim and SignalR fans out to peers, who resolve
      // the same prefab definition and rebuild the mesh.
      const pw = content.querySelector("#ep-pw");
      const ph = content.querySelector("#ep-ph");
      const pd = content.querySelector("#ep-pd");
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, +v));
      const commitPrefabSize = async () => {
        const w = clamp(pw.value, minSize.x, maxSize.x);
        const h = clamp(ph.value, minSize.y, maxSize.y);
        const d = clamp(pd.value, minSize.z, maxSize.z);
        if (w === +size.x && h === +size.y && d === +size.z) return;
        try {
          const updated = await Api.updateEntity(gardenId, eid, {
            geometry: { kind: "Prefab", prefabRef: g.prefabRef, size: { x: w, y: h, z: d } },
          });
          disposeEntity(eid);
          meshForEntity(updated);
          selectEntity(eid);
          setStatus(`resized to ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)}`);
        } catch (e) { console.error(e); setStatus("resize failed"); }
      };
      for (const el of [pw, ph, pd]) {
        if (!el) continue;
        el.addEventListener("change", commitPrefabSize);
        el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); el.blur(); } });
      }
    }

    // Header close.
    content.querySelector('[data-act="close"]')?.addEventListener("click", clearSelection);

    // Action row.
    content.querySelector('[data-act="photo"]')?.addEventListener("click", () => openPhotosModal(eid));
    // Diagnose lives inside the photos modal already; open it and let the user tap "Diagnose".
    content.querySelector('[data-act="diagnose"]')?.addEventListener("click", () => openPhotosModal(eid));
    content.querySelector('[data-act="duplicate"]')?.addEventListener("click", async () => {
      // Offset +1.0 ft on X so the duplicate doesn't z-fight the original. Server returns the
      // new entity, mesh appears via the existing upsert path; we then select it so the user
      // can drag/resize without an extra tap.
      const offset = 1.0;
      const newPos = { x: pos.x + offset, y: pos.y, z: pos.z };
      const body = {
        kind: entity.kind,
        name: entity.name,
        cropRef: entity.cropRef,
        parentId: entity.parentId,
        transform: {
          position: newPos,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: entity.transform?.scale || { x: 1, y: 1, z: 1 },
        },
        geometry: entity.geometry,
      };
      try {
        const created = await Api.addEntity(gardenId, body);
        // SignalR will also upsert this; the registry is idempotent so a double-create is fine.
        if (!meshRegistry.has(created.id)) meshForEntity(created);
        selectEntity(created.id);
        setStatus("duplicated");
      } catch (e) { console.error(e); setStatus("duplicate failed"); }
    });
    content.querySelector('[data-act="move"]')?.addEventListener("click", () => startMove(eid));
    content.querySelector('[data-act="delete"]')?.addEventListener("click", () => deleteEntityById(eid));
  }

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
    for (const id of ["askButton", "calendarButton"]) {
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

    // Day/night curve. Above horizon: ramp 0.30 → 1.0 from horizon to zenith.
    // Below horizon: a low cool ambient so things stay legible at night.
    if (e > 0) {
      const t = Math.min(1, e / (Math.PI / 2));         // 0 at horizon, 1 at zenith
      sun.intensity = 0.30 + 0.70 * t;
      // Warm colour near horizon (sunrise/sunset), cooler near zenith.
      const warm = 1.0 - t;                              // 1 at horizon, 0 at zenith
      sun.diffuse = new BABYLON.Color3(
        1.0,
        0.78 + 0.18 * t,                                 // 0.78 → 0.96
        0.55 + 0.31 * t                                  // 0.55 → 0.86
      );
      sun.specular = sun.diffuse;
      sky.intensity = 0.25 + 0.20 * t;                   // 0.25 → 0.45
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
      sun.intensity = 0.05;
      sun.diffuse = new BABYLON.Color3(0.30, 0.40, 0.65);
      sun.specular = sun.diffuse;
      sky.intensity = 0.18;
      sky.diffuse = new BABYLON.Color3(0.20, 0.28, 0.45);
      scene.clearColor = new BABYLON.Color4(0.04, 0.05, 0.08, 1);
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
