// OpenHarvest Phase 5.2 — vendored prefab library (MIT).
//
// Each prefab returns a single Babylon Mesh (built up from primitives, then merged via
// Mesh.MergeMeshes when there are multiple sub-meshes). A merged mesh keeps picking simple
// — selection/long-press code in app.js inspects mesh.metadata.entityId, and a single mesh
// per entity means one pick test, one outline. The tradeoff is that all sub-meshes share a
// material, so each prefab is built around a single dominant material; small accents (a pot
// rim, a soil insert) are coloured by per-vertex faces approximated through composition or
// blended into the dominant material to keep the merge clean.
//
// Sizing convention (units are feet, matching the rest of the engine):
//   - Beds / planters / fences: Size.x = width, Size.y = height/wall, Size.z = depth.
//   - Pots / cages / stakes:    Size.x ≈ diameter, Size.y = height; Size.z is ignored.
//   - Greenhouses:              Size.x = width, Size.y = arch height, Size.z = depth.
// Builders clamp to defaultSize for any missing/zero dimension so the scene never renders a
// degenerate prefab — sliders in the edit panel can't accidentally produce a zero-thickness
// wall.

(function () {
  const C = (r, g, b) => new BABYLON.Color3(r, g, b);

  // Shared material palette. Materials are built lazily per-scene because Babylon
  // materials are owned by a scene and we have one scene per page load.
  const matCache = new WeakMap();
  function pal(scene) {
    let p = matCache.get(scene);
    if (p) return p;
    const make = (name, color, opts = {}) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseColor = color;
      if (opts.alpha !== undefined) m.alpha = opts.alpha;
      if (opts.specular !== undefined) m.specularColor = opts.specular;
      else m.specularColor = C(0.05, 0.05, 0.05);
      return m;
    };
    p = {
      wood:        make("prefab.wood",        C(0.45, 0.30, 0.18)),
      woodDark:    make("prefab.woodDark",    C(0.30, 0.20, 0.12)),
      soil:        make("prefab.soil",        C(0.22, 0.14, 0.08)),
      terracotta:  make("prefab.terracotta",  C(0.78, 0.43, 0.30)),
      plasticBlack:make("prefab.plasticBlack",C(0.20, 0.20, 0.22)),
      metal:       make("prefab.metal",       C(0.70, 0.70, 0.75), { specular: C(0.40, 0.40, 0.45) }),
      glass:       make("prefab.glass",       C(0.85, 0.92, 0.95), { alpha: 0.35 }),
      // Phase 6.0 — house primitives. Floors get a warm wood tone (the user can re-tint
      // per-instance via the Style button); walls are a warm drywall white. Door + window
      // accents reuse `wood` and a sky-blue translucent glass respectively. We keep these in
      // the shared cache so all walls in a scene share one StandardMaterial — important for
      // the cut-away toggle, which mutates `mat.alpha` once per material to fade every wall
      // in lockstep without per-mesh fiddling.
      houseFloor:  make("prefab.houseFloor",  C(0.70, 0.65, 0.55)),
      houseWall:   make("prefab.houseWall",   C(0.92, 0.90, 0.86)),
      houseDoor:   make("prefab.houseDoor",   C(0.45, 0.30, 0.18)),
      houseGlass:  make("prefab.houseGlass",  C(0.55, 0.75, 0.92), { alpha: 0.5 }),
    };
    matCache.set(scene, p);
    return p;
  }

  // Helper: clamp a user-supplied Size against [min, max], substituting defaults for
  // missing/zero components. Returns a fresh {x,y,z} object.
  function resolveSize(size, def, min, max) {
    const pick = (axis) => {
      const v = (size && size[axis] !== undefined && size[axis] !== null) ? +size[axis] : NaN;
      const fallback = def[axis];
      const clamped = isFinite(v) && v > 0 ? v : fallback;
      return Math.max(min[axis], Math.min(max[axis], clamped));
    };
    return { x: pick("x"), y: pick("y"), z: pick("z") };
  }

  // mergeAndName: merge an array of meshes into a single, pickable result mesh whose name is
  // `meshName`. If MergeMeshes returns null (Babylon does this when materials differ across
  // children — we should never hit this since each prefab uses one material per child set,
  // but the guard prevents a hard crash), fall back to parenting meshes under a TransformNode
  // so the caller still gets something pickable. allowMultiMaterial=true preserves child mats.
  function mergeAndName(BABYLON_, meshes, meshName, scene) {
    if (!meshes.length) return null;
    if (meshes.length === 1) {
      meshes[0].name = meshName;
      meshes[0].refreshBoundingInfo();
      return meshes[0];
    }
    const merged = BABYLON_.Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (merged) {
      merged.name = meshName;
      // Phase 5.2.2 (A2) — recompute the bounding info from the merged geometry. Without
      // this, Babylon's picker can fall back to the bounding box of the first source mesh,
      // which for raised beds was big enough to overlap the neighbouring bed and cause
      // "tapped the right bed, got the left one" mis-picks. A tight, refreshed bounding
      // info matches the merged triangles exactly.
      merged.refreshBoundingInfo();
      return merged;
    }
    // Defensive fallback. Should not happen with current builders.
    const root = new BABYLON_.Mesh(meshName, scene);
    meshes.forEach(m => { m.parent = root; m.isPickable = true; });
    return root;
  }

  // ---------- builders ----------
  // Each builder receives (BABYLON, scene, name, size) and returns a single Mesh whose origin
  // is at the prefab's "ground anchor" — the bottom-centre of its footprint — so app.js can
  // place mesh.position.y = 0 (no per-prefab y-offset bookkeeping).

  function buildRaisedBedWood(B, scene, name, size) {
    const p = pal(scene);
    const wall = 0.15; // 1.8" plank thickness
    const w = size.x, h = size.y, d = size.z;
    const halfH = h / 2;

    const parts = [];
    const addBox = (n, sx, sy, sz, px, py, pz, mat) => {
      const box = B.MeshBuilder.CreateBox(n, { width: sx, height: sy, depth: sz }, scene);
      box.position.set(px, py, pz);
      box.material = mat;
      parts.push(box);
    };

    // Four walls (no floor — the soil insert sits below the rim).
    addBox("n", w, h, wall, 0, halfH, d / 2 - wall / 2, p.wood);
    addBox("s", w, h, wall, 0, halfH, -d / 2 + wall / 2, p.wood);
    addBox("e", wall, h, d, w / 2 - wall / 2, halfH, 0, p.wood);
    addBox("w", wall, h, d, -w / 2 + wall / 2, halfH, 0, p.wood);

    // Soil insert — slightly inset, recessed under the rim.
    const inset = wall * 1.25;
    addBox("soil",
      Math.max(0.1, w - inset * 2),
      Math.max(0.05, h * 0.85),
      Math.max(0.1, d - inset * 2),
      0, halfH * 0.85, 0, p.soil);

    return mergeAndName(B, parts, name, scene);
  }

  function buildTerracottaPot(B, scene, name, size) {
    const p = pal(scene);
    const dia = size.x;     // x doubles as diameter
    const h = size.y;
    const parts = [];

    const body = B.MeshBuilder.CreateCylinder(name + "_body", {
      diameterTop: dia,
      diameterBottom: dia * 0.62, // tapered terracotta silhouette
      height: h,
      tessellation: 24,
    }, scene);
    body.position.y = h / 2;
    body.material = p.terracotta;
    parts.push(body);

    // Rim torus — 8% of height tall, slightly wider than the top.
    const rimThick = Math.max(0.04, h * 0.08);
    const rim = B.MeshBuilder.CreateTorus(name + "_rim", {
      diameter: dia + rimThick * 0.5,
      thickness: rimThick,
      tessellation: 24,
    }, scene);
    rim.position.y = h - rimThick * 0.4;
    rim.material = p.terracotta;
    parts.push(rim);

    return mergeAndName(B, parts, name, scene);
  }

  function buildSquarePlanter(B, scene, name, size) {
    const p = pal(scene);
    const wall = 0.10;
    const w = size.x, h = size.y, d = size.z;
    const halfH = h / 2;
    const parts = [];

    const addBox = (n, sx, sy, sz, px, py, pz, mat) => {
      const box = B.MeshBuilder.CreateBox(n, { width: sx, height: sy, depth: sz }, scene);
      box.position.set(px, py, pz);
      box.material = mat;
      parts.push(box);
    };

    // 4 walls + thin bottom (planters have a base; raised beds don't).
    addBox("n", w, h, wall, 0, halfH, d / 2 - wall / 2, p.plasticBlack);
    addBox("s", w, h, wall, 0, halfH, -d / 2 + wall / 2, p.plasticBlack);
    addBox("e", wall, h, d, w / 2 - wall / 2, halfH, 0, p.plasticBlack);
    addBox("w", wall, h, d, -w / 2 + wall / 2, halfH, 0, p.plasticBlack);
    addBox("base", w, wall, d, 0, wall / 2, 0, p.plasticBlack);

    // Soil cap.
    const inset = wall * 1.5;
    addBox("soil",
      Math.max(0.1, w - inset * 2),
      Math.max(0.05, h * 0.7),
      Math.max(0.1, d - inset * 2),
      0, halfH * 0.85, 0, p.soil);

    return mergeAndName(B, parts, name, scene);
  }

  function buildTrellisFlat(B, scene, name, size) {
    const p = pal(scene);
    const w = size.x, h = size.y;
    const parts = [];
    const poleDia = 0.06;
    const railDia = 0.04;

    // 3 vertical poles spaced evenly along the width.
    for (let i = 0; i < 3; i++) {
      const fx = (i / 2 - 0.5) * w; // -w/2 .. +w/2
      const pole = B.MeshBuilder.CreateCylinder(name + "_p" + i, {
        diameter: poleDia, height: h, tessellation: 8,
      }, scene);
      pole.position.set(fx, h / 2, 0);
      pole.material = p.metal;
      parts.push(pole);
    }

    // 4 horizontal rails — evenly spaced at 25/45/65/85% of height.
    const ys = [0.25, 0.45, 0.65, 0.85];
    for (let i = 0; i < ys.length; i++) {
      const rail = B.MeshBuilder.CreateCylinder(name + "_r" + i, {
        diameter: railDia, height: w, tessellation: 8,
      }, scene);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, ys[i] * h, 0);
      rail.material = p.metal;
      parts.push(rail);
    }

    return mergeAndName(B, parts, name, scene);
  }

  function buildTomatoCage(B, scene, name, size) {
    const p = pal(scene);
    const dia = size.x, h = size.y;
    const parts = [];
    const poleDia = 0.05;
    const ringThick = 0.025;
    const r = dia / 2;

    // 4 vertical wires arranged in a square — slightly inboard so the rings sit on them.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pole = B.MeshBuilder.CreateCylinder(name + "_p" + i, {
        diameter: poleDia, height: h, tessellation: 8,
      }, scene);
      pole.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      pole.material = p.metal;
      parts.push(pole);
    }

    // 3 horizontal rings — bottom, middle, upper third.
    const rings = [0.15, 0.50, 0.85];
    for (let i = 0; i < rings.length; i++) {
      const ring = B.MeshBuilder.CreateTorus(name + "_ring" + i, {
        diameter: dia, thickness: ringThick, tessellation: 16,
      }, scene);
      ring.position.y = rings[i] * h;
      ring.material = p.metal;
      parts.push(ring);
    }

    return mergeAndName(B, parts, name, scene);
  }

  function buildGreenhouseArch(B, scene, name, size) {
    const p = pal(scene);
    const w = size.x, archH = size.y, d = size.z;
    const parts = [];

    // Arch built from a half-torus segment using CreateTube along a semicircle in the XY
    // plane, then extruded along Z by stacking ribs. We approximate with two ribs (front/back)
    // connected by a translucent skin (a half-cylinder).
    const radius = Math.max(0.5, w / 2);

    // Skin: half-cylinder. CreateCylinder with a partial arc (`arc: 0.5`) gives us a half tube;
    // we rotate so the flat side faces down. Length = depth.
    const skin = B.MeshBuilder.CreateCylinder(name + "_skin", {
      diameter: w, height: d, tessellation: 24, arc: 0.5,
    }, scene);
    skin.rotation.x = Math.PI / 2;        // axis from Y → Z
    skin.rotation.y = Math.PI / 2;        // open the half-cylinder so flat is down
    skin.position.y = Math.min(archH, radius);
    skin.material = p.glass;
    parts.push(skin);

    // Two end ribs (rectangular frame outlines) so the prefab reads as a structure even when
    // viewed end-on. Implemented as thin boxes — much cheaper than tubes.
    const frameDia = 0.08;
    const ribY = Math.min(archH, radius);
    [d / 2, -d / 2].forEach((zPos, i) => {
      // base sill
      const sill = B.MeshBuilder.CreateBox(name + "_sill" + i, {
        width: w, height: frameDia, depth: frameDia,
      }, scene);
      sill.position.set(0, frameDia / 2, zPos);
      sill.material = p.metal;
      parts.push(sill);
      // arch top — a thin torus quarter would be ideal, but a flat top bar reads fine at this scale
      const top = B.MeshBuilder.CreateBox(name + "_top" + i, {
        width: w * 0.95, height: frameDia, depth: frameDia,
      }, scene);
      top.position.set(0, ribY, zPos);
      top.material = p.metal;
      parts.push(top);
    });

    return mergeAndName(B, parts, name, scene);
  }

  function buildStake(B, scene, name, size) {
    const p = pal(scene);
    const stake = B.MeshBuilder.CreateCylinder(name, {
      diameter: Math.max(0.04, size.x * 0.3),
      height: size.y,
      tessellation: 8,
    }, scene);
    stake.position.y = size.y / 2;
    stake.material = p.wood;
    return stake;
  }

  function buildFenceSection(B, scene, name, size) {
    const p = pal(scene);
    const w = size.x, h = size.y;
    const parts = [];
    const postW = 0.15;

    // 2 vertical posts.
    [-w / 2 + postW / 2, w / 2 - postW / 2].forEach((px, i) => {
      const post = B.MeshBuilder.CreateBox(name + "_post" + i, {
        width: postW, height: h, depth: postW,
      }, scene);
      post.position.set(px, h / 2, 0);
      post.material = p.wood;
      parts.push(post);
    });

    // 3 horizontal rails at 20/55/85% of height.
    const railThick = 0.07;
    const ys = [0.20, 0.55, 0.85];
    for (let i = 0; i < ys.length; i++) {
      const rail = B.MeshBuilder.CreateBox(name + "_rail" + i, {
        width: Math.max(0.1, w - postW * 1.1),
        height: railThick,
        depth: railThick,
      }, scene);
      rail.position.set(0, ys[i] * h, 0);
      rail.material = p.wood;
      parts.push(rail);
    }

    return mergeAndName(B, parts, name, scene);
  }

  // ---------- Phase 6.0 — house primitives ----------
  // Floor / Wall / Door / Window. The user composes a footprint by tiling floor slabs and then
  // erects walls along their edges. v1 walls are solid boxes — we don't do CSG cutouts for
  // doors/windows yet (that's Phase 6.5). Doors and windows render as a wall + a coloured plane
  // glued to the front face so the silhouette still reads "this segment has a door here".
  //
  // metadata.isWall = true is stamped on every wall-bearing mesh so the cut-away toggle in
  // app.js can sweep the scene and lower wall material alpha above a height threshold.

  function buildFloorSlab(B, scene, name, size) {
    const p = pal(scene);
    const slab = B.MeshBuilder.CreateBox(name, {
      width: size.x, height: size.y, depth: size.z,
    }, scene);
    slab.material = p.houseFloor;
    // Anchor at the bottom so position.y = 0 sits on the ground (matches the rest of the
    // prefab library — every builder emits ground-anchored geometry).
    slab.position.y = size.y / 2;
    slab.metadata = slab.metadata || {};
    slab.metadata.isFloor = true;
    return slab;
  }

  function buildWallSegment(B, scene, name, size) {
    const p = pal(scene);
    const wall = B.MeshBuilder.CreateBox(name, {
      width: size.x, height: size.y, depth: size.z,
    }, scene);
    wall.material = p.houseWall;
    wall.position.y = size.y / 2;
    wall.metadata = wall.metadata || {};
    wall.metadata.isWall = true;
    return wall;
  }

  // Wall + door panel composite. We merge the two into a single pickable mesh so selection
  // stays a one-pick affair — but MergeMeshes fuses materials into a MultiMaterial, so the
  // cut-away alpha sweep needs to walk subMaterials, not just material.alpha. The toggle in
  // app.js handles both StandardMaterial and MultiMaterial cases.
  function buildDoor(B, scene, name, size) {
    const p = pal(scene);
    const wall = B.MeshBuilder.CreateBox(name + "_wall", {
      width: size.x, height: size.y, depth: size.z,
    }, scene);
    wall.material = p.houseWall;
    wall.position.y = size.y / 2;

    const doorWidth = Math.min(3, size.x * 0.75);
    const doorHeight = Math.min(7, size.y * 0.85);
    const doorPlane = B.MeshBuilder.CreatePlane(name + "_door", {
      width: doorWidth, height: doorHeight,
    }, scene);
    doorPlane.material = p.houseDoor;
    doorPlane.position.y = doorHeight / 2;
    // Push the door panel a hair in front of the wall's front face so we don't z-fight.
    doorPlane.position.z = -(size.z / 2 + 0.02);

    const merged = mergeAndName(B, [wall, doorPlane], name, scene);
    if (merged) {
      merged.metadata = merged.metadata || {};
      merged.metadata.isWall = true;
    }
    return merged;
  }

  // Wall + translucent window panel composite. Mid-height window matching standard residential
  // proportions. Like buildDoor, this hands off to mergeAndName which produces a multimaterial
  // when source materials differ — `houseGlass` already has alpha=0.5, so the window stays
  // translucent through the cut-away toggle as well.
  function buildWindow(B, scene, name, size) {
    const p = pal(scene);
    const wall = B.MeshBuilder.CreateBox(name + "_wall", {
      width: size.x, height: size.y, depth: size.z,
    }, scene);
    wall.material = p.houseWall;
    wall.position.y = size.y / 2;

    const winWidth = Math.min(3, size.x * 0.7);
    const winHeight = Math.min(3.5, size.y * 0.45);
    const winPlane = B.MeshBuilder.CreatePlane(name + "_win", {
      width: winWidth, height: winHeight,
    }, scene);
    winPlane.material = p.houseGlass;
    // Mid-height of the wall (a tasteful eye-level window).
    winPlane.position.y = size.y / 2;
    winPlane.position.z = -(size.z / 2 + 0.02);

    const merged = mergeAndName(B, [wall, winPlane], name, scene);
    if (merged) {
      merged.metadata = merged.metadata || {};
      merged.metadata.isWall = true;
    }
    return merged;
  }

  // ---------- registry ----------
  const def = (x, y, z) => ({ x, y, z });

  window.OpenHarvestPrefabs = {
    "raised-bed-wood": {
      name: "Raised Bed (wood)",
      category: "Beds",
      icon: "🟫",
      defaultSize: def(4, 1, 8),
      minSize:     def(1, 0.5, 1),
      maxSize:     def(30, 4, 30),
      build: (B, scene, name, size) => buildRaisedBedWood(B, scene, name,
        resolveSize(size, def(4, 1, 8), def(1, 0.5, 1), def(30, 4, 30))),
    },
    "square-planter": {
      name: "Square Planter",
      category: "Beds",
      icon: "⬛",
      defaultSize: def(2, 1.5, 2),
      minSize:     def(0.5, 0.3, 0.5),
      maxSize:     def(10, 4, 10),
      build: (B, scene, name, size) => buildSquarePlanter(B, scene, name,
        resolveSize(size, def(2, 1.5, 2), def(0.5, 0.3, 0.5), def(10, 4, 10))),
    },
    "terracotta-pot": {
      name: "Terracotta Pot",
      category: "Pots",
      icon: "🟧",
      defaultSize: def(1.0, 1.2, 1.0),
      minSize:     def(0.2, 0.2, 0.2),
      maxSize:     def(4, 4, 4),
      build: (B, scene, name, size) => buildTerracottaPot(B, scene, name,
        resolveSize(size, def(1.0, 1.2, 1.0), def(0.2, 0.2, 0.2), def(4, 4, 4))),
    },
    "trellis-flat": {
      name: "Trellis (flat)",
      category: "Structures",
      icon: "🪜",
      defaultSize: def(4, 6, 0.2),
      minSize:     def(1, 2, 0.05),
      maxSize:     def(20, 12, 1),
      build: (B, scene, name, size) => buildTrellisFlat(B, scene, name,
        resolveSize(size, def(4, 6, 0.2), def(1, 2, 0.05), def(20, 12, 1))),
    },
    "tomato-cage": {
      name: "Tomato Cage",
      category: "Structures",
      icon: "🪤",
      defaultSize: def(1.5, 4, 1.5),
      minSize:     def(0.5, 1, 0.5),
      maxSize:     def(4, 8, 4),
      build: (B, scene, name, size) => buildTomatoCage(B, scene, name,
        resolveSize(size, def(1.5, 4, 1.5), def(0.5, 1, 0.5), def(4, 8, 4))),
    },
    "greenhouse-arch": {
      name: "Greenhouse Arch",
      category: "Structures",
      icon: "🏛",
      defaultSize: def(8, 7, 12),
      minSize:     def(3, 3, 3),
      maxSize:     def(30, 14, 60),
      build: (B, scene, name, size) => buildGreenhouseArch(B, scene, name,
        resolveSize(size, def(8, 7, 12), def(3, 3, 3), def(30, 14, 60))),
    },
    "stake": {
      name: "Stake",
      category: "Structures",
      icon: "📏",
      defaultSize: def(0.3, 4, 0.3),
      minSize:     def(0.1, 1, 0.1),
      maxSize:     def(1, 10, 1),
      build: (B, scene, name, size) => buildStake(B, scene, name,
        resolveSize(size, def(0.3, 4, 0.3), def(0.1, 1, 0.1), def(1, 10, 1))),
    },
    "fence-section": {
      name: "Fence Section",
      category: "Structures",
      icon: "🚧",
      defaultSize: def(6, 4, 0.15),
      minSize:     def(2, 1, 0.05),
      maxSize:     def(20, 8, 0.5),
      build: (B, scene, name, size) => buildFenceSection(B, scene, name,
        resolveSize(size, def(6, 4, 0.15), def(2, 1, 0.05), def(20, 8, 0.5))),
    },
    // Phase 6.0 — house primitives. Sizes default to standard residential proportions
    // (12×12 ft floor slab, 8×8×0.5 ft wall, etc.) but every dimension is editable from the
    // Resize panel. Floors anchor at Y=0; walls and door/window composites are also
    // ground-anchored (origin at the midline of the wall's bottom edge), matching the rest
    // of the library so app.js doesn't need a special branch for them.
    "floor-slab": {
      name: "Floor",
      category: "House",
      icon: "🟦",
      defaultSize: def(12, 0.25, 12),
      minSize:     def(2, 0.05, 2),
      maxSize:     def(100, 1, 100),
      build: (B, scene, name, size) => buildFloorSlab(B, scene, name,
        resolveSize(size, def(12, 0.25, 12), def(2, 0.05, 2), def(100, 1, 100))),
    },
    "wall-segment": {
      name: "Wall",
      category: "House",
      icon: "🧱",
      defaultSize: def(8, 8, 0.5),
      minSize:     def(1, 4, 0.25),
      maxSize:     def(40, 12, 1.5),
      build: (B, scene, name, size) => buildWallSegment(B, scene, name,
        resolveSize(size, def(8, 8, 0.5), def(1, 4, 0.25), def(40, 12, 1.5))),
    },
    "door": {
      name: "Door",
      category: "House",
      icon: "🚪",
      defaultSize: def(4, 8, 0.5),
      minSize:     def(2.5, 6, 0.25),
      maxSize:     def(8, 10, 1.5),
      build: (B, scene, name, size) => buildDoor(B, scene, name,
        resolveSize(size, def(4, 8, 0.5), def(2.5, 6, 0.25), def(8, 10, 1.5))),
    },
    "window": {
      name: "Window",
      category: "House",
      icon: "🪟",
      defaultSize: def(4, 8, 0.5),
      minSize:     def(2, 4, 0.25),
      maxSize:     def(10, 10, 1.5),
      build: (B, scene, name, size) => buildWindow(B, scene, name,
        resolveSize(size, def(4, 8, 0.5), def(2, 4, 0.25), def(10, 10, 1.5))),
    },
  };

  // List helper used by the picker UI — returns prefabs grouped by category in display order.
  window.OpenHarvestPrefabs.__listByCategory = function () {
    const groups = new Map();
    for (const [slug, def_] of Object.entries(window.OpenHarvestPrefabs)) {
      if (slug.startsWith("__")) continue;
      const cat = def_.category || "Other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ slug, ...def_ });
    }
    // Stable category order: House first (Phase 6.0 — composing the home is the primary new
    // workflow), then garden categories in the original order, then anything else alphabetically.
    const order = ["House", "Beds", "Pots", "Structures"];
    return [...groups.entries()].sort((a, b) => {
      const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0]);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a[0].localeCompare(b[0]);
    });
  };
})();
