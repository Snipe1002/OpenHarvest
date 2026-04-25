// OpenHarvest Phase 1 canvas. The decorating is the data model.
//
// State machine:
//   idle → click "Bed" → bedFirstCorner → bedSecondCorner → idle (POST entity, exit place mode)
//   idle → click "Plant" → plantPick → autocomplete modal → idle (POST entity, exit place mode)
//   idle → long-press entity → radialOpen → action → idle
//
// Anonymous-first: garden id stored in localStorage. If absent, POST a new garden on first load.

(() => {
  // ---------- API ----------
  const Api = {
    async createGarden() {
      const res = await fetch("/api/v1/gardens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Garden" })
      });
      if (!res.ok) throw new Error("createGarden failed: " + res.status);
      return res.json();
    },
    async getEntities(gid) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities`);
      if (!res.ok) throw new Error("getEntities failed: " + res.status);
      return res.json();
    },
    async addEntity(gid, body) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("addEntity failed: " + res.status);
      return res.json();
    },
    async updateEntity(gid, eid, body) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities/${eid}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("updateEntity failed: " + res.status);
      return res.json();
    },
    async deleteEntity(gid, eid) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities/${eid}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("deleteEntity failed: " + res.status);
    },
    async searchCrops(q) {
      const res = await fetch(`/api/v1/crops?q=${encodeURIComponent(q || "")}&limit=12`);
      if (!res.ok) return [];
      return res.json();
    },
    async listPhotos(gid, eid) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities/${eid}/photos`);
      if (!res.ok) return [];
      return res.json();
    },
    async uploadPhoto(gid, eid, file) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/v1/gardens/${gid}/entities/${eid}/photos`, {
        method: "POST", body: fd
      });
      if (!res.ok) throw new Error("uploadPhoto failed: " + res.status);
      return res.json();
    },
    async deletePhoto(gid, eid, pid) {
      const res = await fetch(`/api/v1/gardens/${gid}/entities/${eid}/photos/${pid}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("deletePhoto failed: " + res.status);
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

  const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.95;

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
    if (kind === "Cylinder") {
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

    const mat = new BABYLON.StandardMaterial(`mat_${entity.id}`, scene);
    mat.diffuseColor =
      entity.kind === "Plant" ? new BABYLON.Color3(0.20, 0.65, 0.15) :
      entity.kind === "Bed"   ? new BABYLON.Color3(0.45, 0.30, 0.18) :
                                new BABYLON.Color3(0.6, 0.6, 0.6);
    mesh.material = mat;

    let label = null;
    if (entity.name) {
      label = makeLabel(entity.id, entity.name, mesh, geom);
    }
    meshRegistry.set(entity.id, { entity, mesh, label });
    return mesh;
  }

  function makeLabel(eid, name, parentMesh, geom) {
    const labelHeight = ((geom.height || 0) + (geom.size?.y || 0)) / 2 + 0.6;
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
  };
  let mode = Mode.Idle;
  let bedFirst = null;
  let bedPreview = null;

  function setMode(next) {
    mode = next;
    buttons.forEach(b => b.classList.toggle("active",
      (next.startsWith("bed-") && b.dataset.mode === "bed") ||
      (next === Mode.PlantPick && b.dataset.mode === "plant")));
    canvas.style.cursor = (next === Mode.Idle) ? "" : "crosshair";
    if (next === Mode.Idle) {
      bedFirst = null;
      if (bedPreview) { bedPreview.dispose(); bedPreview = null; }
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
    radial.classList.add("open");
  }
  function closeRadial() {
    radial.classList.remove("open");
    radialEntityId = null;
  }
  radial.addEventListener("click", async (ev) => {
    const item = ev.target.closest(".item");
    if (!item || !radialEntityId) return;
    const action = item.dataset.action;
    const eid = radialEntityId;
    closeRadial();
    if (action === "delete") deleteEntityById(eid);
    else if (action === "rename") openRenameModal(eid);
    else if (action === "move") startMove(eid);
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
      <div class="modal-actions" style="justify-content:flex-start; margin-top:0;">
        <button class="primary" data-act="take">📷 Take photo</button>
      </div>
      <div class="photo-grid"></div>
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
    const onPick = async () => {
      const file = photoInput.files?.[0];
      photoInput.value = "";
      if (!file) return;
      setStatus("uploading photo...");
      try {
        await Api.uploadPhoto(gardenId, eid, file);
        setStatus("photo uploaded");
        await refresh();
        await refreshEntityPhotoBadge(eid);
      } catch (e) { console.error(e); setStatus("photo upload failed"); }
    };
    photoInput.addEventListener("change", onPick, { once: true });

    modal.querySelector('[data-act="take"]').addEventListener("click", () => photoInput.click());
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

  // Move: detach camera control, drag entity along the ground until pointer up.
  function startMove(eid) {
    const rec = meshRegistry.get(eid);
    if (!rec) return;
    setStatus("drag to move; release to drop");
    camera.detachControl();

    const move = () => {
      const p = pickGround();
      if (p) {
        rec.mesh.position.x = p.x;
        rec.mesh.position.z = p.z;
      }
    };
    const onMove = () => move();
    const onUp = async () => {
      scene.onPointerObservable.remove(moveObs);
      window.removeEventListener("pointerup", onUp, true);
      camera.attachControl(canvas, true);
      const newPos = { x: rec.mesh.position.x, y: 0, z: rec.mesh.position.z };
      try {
        const updated = await Api.updateEntity(gardenId, eid, {
          transform: {
            position: newPos,
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: rec.entity.transform?.scale || { x: 1, y: 1, z: 1 }
          }
        });
        rec.entity = updated;
        setStatus("moved");
      } catch (e) { console.error(e); setStatus("move failed"); }
    };
    const moveObs = scene.onPointerObservable.add((info) => {
      if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) onMove();
    });
    window.addEventListener("pointerup", onUp, true);
  }

  // ---------- live sync (SignalR) ----------
  let connection = null;

  function applyEntityUpsert(entity) {
    if (!entity || !entity.id) return;
    // Idempotent: dispose any existing mesh for this id, recreate from server data.
    if (meshRegistry.has(entity.id)) disposeEntity(entity.id);
    meshForEntity(entity);
  }

  function applyEntityDelete(entityId) {
    if (meshRegistry.has(entityId)) disposeEntity(entityId);
  }

  async function connectHub(gid) {
    if (!window.signalR) {
      console.warn("SignalR client missing — live sync disabled");
      return;
    }
    connection = new signalR.HubConnectionBuilder()
      .withUrl("/hubs/garden")
      .withAutomaticReconnect([0, 1000, 2000, 5000, 10000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on("entityUpserted", applyEntityUpsert);
    connection.on("entityDeleted", applyEntityDelete);

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

  // ---------- bootstrap ----------
  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => scene.render());

  (async () => {
    try {
      setStatus("connecting...");
      gardenId = await ensureGarden();
      setStatus("loading garden...");
      const entities = await Api.getEntities(gardenId);
      entities.forEach(meshForEntity);
      setStatus(entities.length === 0
        ? "empty garden — tap Bed or Plant to start"
        : `loaded ${entities.length} entities — long-press to edit`);
      // Live sync over SignalR.
      connectHub(gardenId);
    } catch (e) {
      console.error(e);
      setStatus("failed to load — see console", 0);
    }
  })();
})();
