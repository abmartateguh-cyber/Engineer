/**
 * STEP-format text serializer and parser for a limited geometry representation.
 *
 * General ISO 10303 conformance and interoperability have not been independently
 * verified. Beyond the B-Rep solid export (single part), this module also emits
 * assembly / product structure records:
 *
 *   - PRODUCT, PRODUCT_DEFINITION_FORMATION, PRODUCT_DEFINITION,
 *     PRODUCT_DEFINITION_SHAPE, SHAPE_DEFINITION_REPRESENTATION
 *   - NEXT_ASSEMBLY_USAGE_OCCURRENCE (ISO 10303-42: assembly_component_usage;
 *     attribute order: relating_product_definition, related_product_definition,
 *     reference_designator, name, description)
 *   - ITEM_DEFINED_TRANSFORMATION + CARTESIAN_TRANSFORMATION_3D for occurrence
 *     placement (transformation operator applied to the part's solid item)
 *   - DRAUGHTING_MODEL + LAYER_ASSIGNMENT metadata records (optional layers),
 *     with optional COLOUR_RGB records carried alongside the layer assignment
 *
 * The parser performs a structural round-trip: it counts every emitted entity
 * type, resolves the reference graph of the assembly occurrences, and exposes
 * the results for validation.
 */

class StepTranslator {
  /**
   * Serializes a solid/mesh, or an assembly descriptor, to STEP-format text.
   * @param {Object} input
   *   - B-Rep solid or mesh (legacy single-part export), OR
   *   - { solids: [{id, name, solid, layer, color}], assembly: { nodes, references } }
   * @param {string} modelName Part name (single-part export)
   * @param {Object} [opts] Optional { layers: [...] } metadata for single-part export
   */
  static exportSTEP(input, modelName = 'OmniEng_CAD_Part', opts = {}) {
    if (
      input &&
      typeof input === 'object' &&
      (input.assembly || (Array.isArray(input.solids) && !input.faces && !input.vertices))
    ) {
      return StepTranslator.exportAssemblySTEP(input, modelName);
    }
    return StepTranslator._exportSinglePart(input, modelName, opts);
  }

  static _exportSinglePart(solid, modelName, opts = {}) {
    let entityId = 1;
    const idGen = { n: entityId };
    const getNextId = () => `#${idGen.n++}`;
    const lines = [];

    StepTranslator._emitHeader(lines, modelName, 'OmniEng Parametric B-Rep Model');

    const ctx = StepTranslator._emitGlobalContext(lines, getNextId);

    const geo = StepTranslator._emitSolidGeometry(lines, getNextId, solid, modelName);

    // Closed Shell and Manifold Solid B-Rep
    const idClosedShell = getNextId();
    lines.push(`${idClosedShell}=CLOSED_SHELL('', (${geo.faceIds.join(', ')}));`);
    const idManifoldSolid = getNextId();
    lines.push(`${idManifoldSolid}=MANIFOLD_SOLID_BREP('${modelName}', ${idClosedShell});`);

    // AP242-style PMI block (datums + geometric tolerances)
    StepTranslator._emitPmi(lines, getNextId, solid, geo.faceIdByEntity, idManifoldSolid);

    // Shape Representation and Product Definition Structure
    const idShapeRep = getNextId();
    lines.push(
      `${idShapeRep}=ADVANCED_BREP_SHAPE_REPRESENTATION('${modelName}', (${idManifoldSolid}, ${ctx.rootPlacement}), ${ctx.dimContext});`
    );

    const productRefs = StepTranslator._emitProductStructure(lines, getNextId, modelName, ctx, idShapeRep);

    StepTranslator._emitLayerMetadata(lines, getNextId, opts.layers, [idManifoldSolid, ctx.rootPlacement]);

    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');

    return lines.join('\n');
  }

  /**
   * Exports an assembly / product structure to ISO 10303-21.
   * @param {Object} data { solids: [{id, name, solid, layer, color}], assembly: { nodes, references } }
   *   node: { id, name, children: [nodeId...], transforms, solid, solidId, layer, color }
   *   transform: { origin: [x,y,z], axis1: [x,y,z], axis2: [x,y,z], scale } or 4x4 row-major matrix
   *   reference: { id, parentId, childId, name, transform }
   */
  static exportAssemblySTEP(data, modelName = 'OmniEng_Assembly') {
    const idGen = { n: 1 };
    const getNextId = () => `#${idGen.n++}`;
    const lines = [];

    const assembly = (data && data.assembly) || {};
    const nodes = Array.isArray(assembly.nodes) ? assembly.nodes : [];
    const rawRefs = Array.isArray(assembly.references) ? assembly.references : [];
    const solidDefs = Array.isArray(data.solids) ? data.solids : [];

    StepTranslator._emitHeader(lines, modelName, 'OmniEng Assembly B-Rep Model');
    const ctx = StepTranslator._emitGlobalContext(lines, getNextId);

    // Index solids by id and by node.solidId
    const solidById = new Map();
    for (const s of solidDefs) {
      if (s && s.id) solidById.set(s.id, s);
    }

    // Build node table
    const nodeById = new Map();
    for (const n of nodes) {
      nodeById.set(n.id, n);
    }

    // Resolve edges (parent -> child) from references or node.children
    const edges = [];
    if (rawRefs.length > 0) {
      for (const ref of rawRefs) {
        if (!ref.childId) continue;
        const parentId = ref.parentId !== undefined && ref.parentId !== null ? ref.parentId : null;
        edges.push({ parentId, childId: ref.childId, name: ref.name, transform: ref.transform, refId: ref.id });
      }
    } else {
      const visit = (node, parentId) => {
        if (Array.isArray(node.children)) {
          for (const childId of node.children) {
            edges.push({ parentId: node.id, childId, transform: node.transforms });
            const child = nodeById.get(childId);
            if (child) visit(child, childId);
          }
        }
      };
      for (const n of nodes) {
        if (!n.parent && !edges.some((e) => e.childId === n.id)) visit(n, null);
      }
    }

    // States for products and shape representations
    const prodDefByNode = new Map(); // nodeId -> product definition id
    const shapeRepByNode = new Map(); // nodeId -> shape representation id
    const solidItemByNode = new Map(); // nodeId -> manifold solid id (when geometry present)

    // 1. Emit geometry + shape representation + product structure per node with geometry
    for (const node of nodes) {
      const solidDef = node.solidId ? solidById.get(node.solidId) : null;
      const solid = node.solid || (solidDef ? solidDef.solid : null);
      if (!solid) continue;

      const nodeName = node.name || (solidDef ? solidDef.name : '') || node.id || 'Part';
      const geo = StepTranslator._emitSolidGeometry(lines, getNextId, solid, nodeName);
      const idClosedShell = getNextId();
      lines.push(`${idClosedShell}=CLOSED_SHELL('', (${geo.faceIds.join(', ')}));`);
      const idManifoldSolid = getNextId();
      lines.push(`${idManifoldSolid}=MANIFOLD_SOLID_BREP('${nodeName}', ${idClosedShell});`);
      solidItemByNode.set(node.id, idManifoldSolid);

      const idShapeRep = getNextId();
      lines.push(
        `${idShapeRep}=ADVANCED_BREP_SHAPE_REPRESENTATION('${nodeName}', (${idManifoldSolid}, ${ctx.rootPlacement}), ${ctx.dimContext});`
      );
      shapeRepByNode.set(node.id, idShapeRep);

      const shapeDefId = StepTranslator._emitProductStructure(lines, getNextId, nodeName, ctx, idShapeRep);
      prodDefByNode.set(node.id, shapeDefId);

      const layerMeta = node.layer !== undefined ? node.layer : solidDef ? solidDef.layer : undefined;
      const colorMeta = node.color !== undefined ? node.color : solidDef ? solidDef.color : undefined;
      StepTranslator._emitLayerMetadata(lines, getNextId, layerMeta, [idManifoldSolid, ctx.rootPlacement], colorMeta);

      StepTranslator._emitPmi(lines, getNextId, solid, geo.faceIdByEntity, idManifoldSolid);
    }

    // 2. Assembly-level product (root)
    const rootDefId = StepTranslator._emitProductStructure(lines, getNextId, modelName, ctx, null);
    // 3. NAUO occurrences + placement transformations
    for (const edge of edges) {
      const childDef = prodDefByNode.get(edge.childId);
      if (!childDef) continue; // child has no geometry -> not an occurrence with shape
      const parentDef =
        edge.parentId === null || edge.parentId === undefined ? rootDefId : prodDefByNode.get(edge.parentId);
      if (!parentDef) continue;

      const childName = (nodeById.get(edge.childId) || {}).name || edge.name || 'Occurrence';
      const refDes = edge.refId || '';
      const idNauo = getNextId();
      lines.push(
        `${idNauo}=NEXT_ASSEMBLY_USAGE_OCCURRENCE(${parentDef}, ${childDef}, '${StepTranslator._stepString(refDes)}', '${StepTranslator._stepString(childName)}', '');`
      );

      const transform = edge.transform || (nodeById.get(edge.childId) || {}).transforms;
      if (transform) {
        const solidItem = solidItemByNode.get(edge.childId);
        if (solidItem) {
          const idCartTrans = StepTranslator._emitCartesianTransformation(
            lines,
            getNextId,
            transform,
            `${childName}_placement`
          );
          const idItemTransform = getNextId();
          lines.push(`${idItemTransform}=ITEM_DEFINED_TRANSFORMATION('', '', ${idCartTrans}, ${solidItem});`);
        }
      }
    }

    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');

    return lines.join('\n');
  }

  /**
   * Exports analytic NURBS surface records (ISO 10303-42) for the faces of a
   * solid (or list of solids):
   *
   *   - Planar faces -> B_SPLINE_SURFACE_WITH_KNOTS (degree 1x1, 2x2 control
   *     points, quasi-uniform knots).
   *   - Cylindrical side faces -> RATIONAL_B_SPLINE_SURFACE patches (degree
   *     2x1, 3x2 control grid with weights for exact circular arc sections).
   *     A full cylinder is emitted as four exact 90-degree rational patches
   *     (weights cos(45deg) on the middle control columns). When the cylinder
   *     tessellation does not align with 90-degree quadrant boundaries, the
   *     emitted patch is a best-fit rational conic with documented weights
   *     cos(theta/2).
   *
   * Existing single-part / assembly export paths are untouched.
   * @param {Object|Array<Object>} solids B-Rep solid or array of solids
   * @param {string} [modelName]
   * @returns {string} STEP text
   */
  static exportNurbsSurfaces(solids, modelName = 'OmniEng_NurbsModel') {
    const list = Array.isArray(solids) ? solids : [solids];
    const idGen = { n: 1 };
    const getNextId = () => `#${idGen.n++}`;
    const lines = [];

    StepTranslator._emitHeader(lines, modelName, 'OmniEng NURBS Surface Model');

    const surfaceIds = [];
    for (const solid of list) {
      if (!solid || !Array.isArray(solid.faces) || solid.faces.length === 0) continue;
      const cyl = StepTranslator._classifyCylindricalFaces(solid);
      for (const face of solid.faces) {
        if (cyl.cylindricalSet.has(face)) continue;
        const idS = StepTranslator._emitPlanarNurbsSurface(lines, getNextId, face, surfaceIds.length);
        if (idS) surfaceIds.push(idS);
      }
      for (const group of cyl.groups) {
        const patchIds = StepTranslator._emitCylinderPatches(lines, getNextId, group, surfaceIds.length);
        surfaceIds.push(...patchIds);
      }
    }

    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');
    return lines.join('\n');
  }

  /**
   * Exports AP214 trimmed NURBS surfaces: each face carries its NURBS
   * surface plus its 2D trim loops (p-curves) as 2D NURBS curves wired into
   * PCURVE / SURFACE_CURVE records inside ADVANCED_FACE bounds. The existing
   * export path for untrimmed surfaces is untouched.
   * @param {Object|Array<Object>} trimmedFaces TrimmedNurbsSurface instances
   *   (or { surface, trims: [TrimLoop2D] } objects)
   * @param {string} [modelName]
   * @returns {string} STEP text
   */
  static exportTrimmedSurfaces(trimmedFaces, modelName = 'OmniEng_TrimmedModel') {
    const list = Array.isArray(trimmedFaces) ? trimmedFaces : [trimmedFaces];
    const idGen = { n: 1 };
    const getNextId = () => `#${idGen.n++}`;
    const lines = [];

    StepTranslator._emitHeader(lines, modelName, 'OmniEng Trimmed NURBS Model (AP214)');

    for (let fi = 0; fi < list.length; fi++) {
      const item = list[fi];
      if (!item || !item.surface) continue;
      const trimmed = item.pointOnTrimmedSurface ? item : { surface: item.surface, trims: item.trims || [] };
      const surface = trimmed.surface;
      const surfId = StepTranslator._emitNurbsSurfaceEntity(lines, getNextId, surface, `TrimmedSurface_${fi + 1}`);

      const bounds = [];
      const trims = Array.isArray(trimmed.trims) ? trimmed.trims : [];
      for (let li = 0; li < trims.length; li++) {
        const loop = trims[li];
        const curves = loop.curves || [];
        const loopEdgeIds = [];
        for (let ci = 0; ci < curves.length; ci++) {
          const curve = curves[ci];
          const p0 = curve.evaluate(0);
          const p1 = curve.evaluate(1);
          const s0 = surface.evaluate(p0.u, p0.v);
          const s1 = surface.evaluate(p1.u, p1.v);

          const idPt0 = StepTranslator._emitCartesianPoint(lines, getNextId, s0.x, s0.y, s0.z);
          const idPt1 = StepTranslator._emitCartesianPoint(lines, getNextId, s1.x, s1.y, s1.z);
          const idV0 = getNextId();
          lines.push(`${idV0}=VERTEX_POINT('', ${idPt0});`);
          const idV1 = getNextId();
          lines.push(`${idV1}=VERTEX_POINT('', ${idPt1});`);

          const dx = s1.x - s0.x;
          const dy = s1.y - s0.y;
          const dz = s1.z - s0.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          const idDir = getNextId();
          lines.push(
            `${idDir}=DIRECTION('', (${(dx / len).toFixed(6)}, ${(dy / len).toFixed(6)}, ${(dz / len).toFixed(6)}));`
          );
          const idLine = getNextId();
          lines.push(`${idLine}=LINE('', ${idPt0}, ${idDir});`);

          const idCurve = StepTranslator._emitTrimCurve(
            lines,
            getNextId,
            curve,
            `TrimCurve_${fi + 1}_${li + 1}_${ci + 1}`
          );
          const idPc = getNextId();
          lines.push(`${idPc}=PCURVE('', ${surfId}, ${idCurve});`);
          const idSurfCurve = getNextId();
          lines.push(`${idSurfCurve}=SURFACE_CURVE('', ${idLine}, (${idPc}), .PCURVE.);`);

          const idEdge = getNextId();
          lines.push(`${idEdge}=EDGE_CURVE('', ${idV0}, ${idV1}, ${idSurfCurve}, .T.);`);
          const idOE = getNextId();
          lines.push(`${idOE}=ORIENTED_EDGE('', *, *, ${idEdge}, .T.);`);
          loopEdgeIds.push(idOE);
        }
        if (loopEdgeIds.length === 0) continue;

        const idLoop = getNextId();
        lines.push(`${idLoop}=EDGE_LOOP('', (${loopEdgeIds.join(', ')}));`);
        const idBound = getNextId();
        if (loop.isOuter) {
          lines.push(`${idBound}=FACE_OUTER_BOUND('', ${idLoop}, .T.);`);
        } else {
          lines.push(`${idBound}=FACE_BOUND('', ${idLoop}, .T.);`);
        }
        bounds.push(idBound);
      }

      if (bounds.length > 0) {
        const idFace = getNextId();
        lines.push(`${idFace}=ADVANCED_FACE('TrimmedFace_${fi + 1}', (${bounds.join(', ')}), ${surfId}, .T.);`);
      }
    }

    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');
    return lines.join('\n');
  }

  static _fmtNum(n) {
    return String(parseFloat(Number(n).toFixed(6)));
  }

  static _emitNurbsSurfaceEntity(lines, getNextId, surface, name) {
    const rows = surface.controlPoints.map((row) =>
      row.map((pt) => StepTranslator._emitCartesianPoint(lines, getNextId, pt.x, pt.y, pt.z))
    );
    const gridStr = '(' + rows.map((r) => '(' + r.join(',') + ')').join(',') + ')';
    const uK = '(' + surface.knotsU.map((k) => StepTranslator._fmtNum(k)).join(',') + ')';
    const vK = '(' + surface.knotsV.map((k) => StepTranslator._fmtNum(k)).join(',') + ')';
    const idS = getNextId();
    const isRational = surface.weights.some((row) => row.some((w) => Math.abs(w - 1) > 1e-9));
    if (isRational) {
      const wGrid =
        '(' +
        surface.weights.map((row) => '(' + row.map((w) => StepTranslator._fmtNum(w)).join(',') + ')').join(',') +
        ')';
      lines.push(
        `${idS}=RATIONAL_B_SPLINE_SURFACE('${name}', ${surface.degreeU}, ${surface.degreeV}, ${gridStr}, .UNSPECIFIED., .F., .F., .F., ${uK}, ${vK}, .UNSPECIFIED., ${wGrid});`
      );
    } else {
      lines.push(
        `${idS}=B_SPLINE_SURFACE_WITH_KNOTS('${name}', ${surface.degreeU}, ${surface.degreeV}, ${gridStr}, .UNSPECIFIED., .F., .F., .F., ${uK}, ${vK}, .UNSPECIFIED.);`
      );
    }
    return idS;
  }

  static _emitTrimCurve(lines, getNextId, curve, name) {
    const ids = curve.controlPoints.map((row) =>
      StepTranslator._emitCartesianPoint(lines, getNextId, row[0], row[1], 0)
    );
    const knotsStr = '(' + curve.knots.map((k) => StepTranslator._fmtNum(k)).join(',') + ')';
    const idC = getNextId();
    const isRational = curve.weights.some((w) => Math.abs(w - 1) > 1e-9);
    if (isRational) {
      const wStr = '(' + curve.weights.map((w) => StepTranslator._fmtNum(w)).join(',') + ')';
      lines.push(
        `${idC}=RATIONAL_B_SPLINE_CURVE_WITH_KNOTS('${name}', ${curve.degree}, (${ids.join(',')}), .UNSPECIFIED., .F., .F., ${knotsStr}, .UNSPECIFIED., ${wStr});`
      );
    } else {
      lines.push(
        `${idC}=B_SPLINE_CURVE_WITH_KNOTS('${name}', ${curve.degree}, (${ids.join(',')}), .UNSPECIFIED., .F., .F., ${knotsStr}, .UNSPECIFIED.);`
      );
    }
    return idC;
  }

  static _classifyCylindricalFaces(solid) {
    const result = { cylindricalSet: new Set(), groups: [] };
    if (!solid || !Array.isArray(solid.faces)) return result;

    const candidateFaces = [];
    for (const face of solid.faces) {
      if (!face || !Array.isArray(face.vertices) || face.vertices.length !== 4) continue;
      const n = face.normal || {};
      const nx = Number(n.x) || 0;
      const ny = Number(n.y) || 0;
      const nz = Number(n.z) || 0;
      if (Math.hypot(nx, ny) < 0.5 || Math.abs(nz) > 0.7) continue; // radial normal only
      candidateFaces.push(face);
    }
    if (candidateFaces.length === 0) return result;

    const pts = [];
    for (const face of candidateFaces) {
      for (const v of face.vertices) {
        pts.push({
          x: Number(v.point.x) || 0,
          y: Number(v.point.y) || 0,
          z: Number(v.point.z) || 0
        });
      }
    }
    const zMin = Math.min(...pts.map((p) => p.z));
    const zMax = Math.max(...pts.map((p) => p.z));

    const ring = [];
    const seen = new Set();
    for (const p of pts) {
      if (Math.abs(p.z - zMin) > 1e-6) continue;
      const k = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ring.push({ x: p.x, y: p.y });
    }
    if (ring.length < 3) return result;

    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const radius = ring.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / ring.length;
    if (!(radius > 1e-9)) return result;

    // Validate that every candidate vertex truly lies on the fitted circular axis
    // (rejects planar box side faces whose normals happen to be radial-ish).
    const tol = 1e-3 * Math.max(radius, 1);
    let maxDev = 0;
    for (const p of pts) {
      const dev = Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius);
      if (dev > maxDev) maxDev = dev;
    }
    if (maxDev > tol || ring.length < 6) return result;

    const angleOf = (p) => Math.atan2(p.y - cy, p.x - cx);
    const anchors = [];
    for (let q = 0; q < 4; q++) {
      const target = (q * Math.PI) / 2;
      let best = null;
      let bestD = Infinity;
      for (const p of ring) {
        const diff = ((angleOf(p) - target + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const d = Math.abs(diff);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      anchors.push({ point: best, angle: best ? angleOf(best) : target });
    }

    for (let q = 0; q < 4; q++) {
      const start = anchors[q];
      const end = anchors[(q + 1) % 4];
      if (!start || !end || !start.point || !end.point) continue;
      let aStart = start.angle;
      let aEnd = end.angle;
      if (aEnd <= aStart) aEnd += 2 * Math.PI;
      result.groups.push({
        center: { x: cx, y: cy },
        radius,
        zMin,
        zMax,
        aStart,
        aEnd,
        startPoint: start.point,
        endPoint: end.point
      });
    }
    for (const f of candidateFaces) result.cylindricalSet.add(f);
    return result;
  }

  static _emitCartesianPoint(lines, getNextId, x, y, z) {
    const idPt = getNextId();
    lines.push(`${idPt}=CARTESIAN_POINT('', (${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}));`);
    return idPt;
  }

  static _emitPlanarNurbsSurface(lines, getNextId, face, index) {
    if (!face || !Array.isArray(face.vertices) || face.vertices.length < 4) return null;
    const coords = face.vertices.map((vert) => {
      const pt = vert.point || vert;
      return [Number(pt.x) || 0, Number(pt.y) || 0, Number(pt.z) || 0];
    });
    const id00 = StepTranslator._emitCartesianPoint(lines, getNextId, coords[0][0], coords[0][1], coords[0][2]);
    const id10 = StepTranslator._emitCartesianPoint(lines, getNextId, coords[1][0], coords[1][1], coords[1][2]);
    const id01 = StepTranslator._emitCartesianPoint(lines, getNextId, coords[3][0], coords[3][1], coords[3][2]);
    const id11 = StepTranslator._emitCartesianPoint(lines, getNextId, coords[2][0], coords[2][1], coords[2][2]);
    const idS = getNextId();
    lines.push(
      `${idS}=B_SPLINE_SURFACE_WITH_KNOTS('Plane_${index + 1}', 1, 1, ((${id00},${id01}),(${id10},${id11})), .PLANAR., .F., .F., .F., (0.,0.,1.,1.), (0.,0.,1.,1.), .QUASI_UNIFORM_KNOTS.);`
    );
    return idS;
  }

  static _emitCylinderPatches(lines, getNextId, group, index) {
    const { center, radius, zMin, zMax, aStart, aEnd } = group;
    if (!(aEnd > aStart) || aEnd - aStart <= 0) return [];
    const theta = aEnd - aStart;
    const w = Math.cos(theta / 2);
    const t = radius * Math.tan(theta / 2);
    const cs = Math.cos(aStart);
    const sn = Math.sin(aStart);
    const ce = Math.cos(aEnd);
    const se = Math.sin(aEnd);
    const midX = center.x + radius * cs - t * sn;
    const midY = center.y + radius * sn + t * cs;

    const bottomStart = StepTranslator._emitCartesianPoint(
      lines,
      getNextId,
      center.x + radius * cs,
      center.y + radius * sn,
      zMin
    );
    const topStart = StepTranslator._emitCartesianPoint(
      lines,
      getNextId,
      center.x + radius * cs,
      center.y + radius * sn,
      zMax
    );
    const bottomMid = StepTranslator._emitCartesianPoint(lines, getNextId, midX, midY, zMin);
    const topMid = StepTranslator._emitCartesianPoint(lines, getNextId, midX, midY, zMax);
    const bottomEnd = StepTranslator._emitCartesianPoint(
      lines,
      getNextId,
      center.x + radius * ce,
      center.y + radius * se,
      zMin
    );
    const topEnd = StepTranslator._emitCartesianPoint(
      lines,
      getNextId,
      center.x + radius * ce,
      center.y + radius * se,
      zMax
    );

    const idS = getNextId();
    lines.push(
      `${idS}=RATIONAL_B_SPLINE_SURFACE('Cylinder_${index + 1}', 2, 1, ((${bottomStart},${topStart}),(${bottomMid},${topMid}),(${bottomEnd},${topEnd})), .CYLINDRICAL., .F., .F., .F., (0.,0.,0.,1.,1.,1.), (0.,0.,1.,1.), .QUASI_UNIFORM_KNOTS., ((1.0,1.0),(${w.toFixed(6)},${w.toFixed(6)}),(1.0,1.0)));`
    );
    return [idS];
  }

  static _emitHeader(lines, modelName, description) {
    const timestamp = new Date().toISOString().replace(/\.\d+Z$/, '');
    lines.push('ISO-10303-21;');
    lines.push('HEADER;');
    lines.push(`FILE_DESCRIPTION(('${description}', 'AP214'), '2;1');`);
    lines.push(
      `FILE_NAME('${modelName}.step', '${timestamp}', ('OmniEng Engineer'), ('OmniEng Platform'), 'OmniEng CAD Kernel v1.1', 'OmniEng', '');`
    );
    lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
    lines.push('ENDSEC;');
    lines.push('DATA;');
  }

  static _emitGlobalContext(lines, getNextId) {
    const idOriginPt = getNextId();
    lines.push(`${idOriginPt}=CARTESIAN_POINT('Origin', (0.0, 0.0, 0.0));`);
    const idZAxis = getNextId();
    lines.push(`${idZAxis}=DIRECTION('Z Axis', (0.0, 0.0, 1.0));`);
    const idXAxis = getNextId();
    lines.push(`${idXAxis}=DIRECTION('X Axis', (1.0, 0.0, 0.0));`);
    const idRootPlacement = getNextId();
    lines.push(`${idRootPlacement}=AXIS2_PLACEMENT_3D('World CS', ${idOriginPt}, ${idZAxis}, ${idXAxis});`);

    const idLengthUnit = getNextId();
    lines.push(`${idLengthUnit}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI., .METRE.));`);
    const idAngleUnit = getNextId();
    lines.push(`${idAngleUnit}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($, .RADIAN.));`);
    const idUncertainty = getNextId();
    lines.push(
      `${idUncertainty}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-06), ${idLengthUnit}, 'distance_accuracy_value', 'confusion accuracy');`
    );

    const idDimContext = getNextId();
    lines.push(
      `${idDimContext}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${idUncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${idLengthUnit}, ${idAngleUnit})) REPRESENTATION_CONTEXT('Context3D', '3D'));`
    );

    return { originPt: idOriginPt, rootPlacement: idRootPlacement, dimContext: idDimContext };
  }

  static _emitProductStructure(lines, getNextId, modelName, ctx, shapeRepId) {
    const idAppCtx = getNextId();
    lines.push(
      `${idAppCtx}=APPLICATION_CONTEXT('configuration controlled 3D designs of mechanical parts and assemblies');`
    );
    const idProductContext = getNextId();
    lines.push(`${idProductContext}=PRODUCT_CONTEXT('', ${idAppCtx}, 'mechanical');`);
    const idProduct = getNextId();
    lines.push(
      `${idProduct}=PRODUCT('${StepTranslator._stepString(modelName)}', '${StepTranslator._stepString(modelName)}', '', (${idProductContext}));`
    );
    const idProdDefFormation = getNextId();
    lines.push(`${idProdDefFormation}=PRODUCT_DEFINITION_FORMATION('', '', ${idProduct});`);
    const idProdDef = getNextId();
    lines.push(`${idProdDef}=PRODUCT_DEFINITION('design', '', ${idProdDefFormation}, ${idProductContext});`);
    const idShapeDef = getNextId();
    lines.push(`${idShapeDef}=PRODUCT_DEFINITION_SHAPE('Shape', '', ${idProdDef});`);
    if (shapeRepId) {
      const idShapeAssoc = getNextId();
      lines.push(`${idShapeAssoc}=SHAPE_DEFINITION_REPRESENTATION(${idShapeDef}, ${shapeRepId});`);
    }
    return idProdDef;
  }

  static _emitCartesianTransformation(lines, getNextId, transform, name) {
    let origin = [0.0, 0.0, 0.0];
    let axis1 = [1.0, 0.0, 0.0];
    let axis2 = [0.0, 1.0, 0.0];
    let scale = 1.0;

    if (Array.isArray(transform) && transform.length === 16) {
      // Row-major 4x4 affine matrix
      const m = transform;
      axis1 = [m[0], m[1], m[2]];
      axis2 = [m[4], m[5], m[6]];
      origin = [m[12], m[13], m[14]];
      const s1 = Math.hypot(...axis1) || 1.0;
      const s2 = Math.hypot(...axis2) || 1.0;
      scale = (s1 + s2) / 2.0;
      axis1 = axis1.map((v) => v / (s1 || 1.0));
      axis2 = axis2.map((v) => v / (s2 || 1.0));
    } else if (transform && typeof transform === 'object') {
      if (Array.isArray(transform.origin) && transform.origin.length === 3) origin = transform.origin;
      if (Array.isArray(transform.axis1) && transform.axis1.length === 3) axis1 = transform.axis1;
      if (Array.isArray(transform.axis2) && transform.axis2.length === 3) axis2 = transform.axis2;
      if (typeof transform.scale === 'number') scale = transform.scale;
    }

    const n1 = Math.hypot(...axis1);
    const n2 = Math.hypot(...axis2);
    const a1 = n1 > 1e-12 ? axis1.map((v) => v / n1) : [1.0, 0.0, 0.0];
    const a2 = n2 > 1e-12 ? axis2.map((v) => v / n2) : [0.0, 1.0, 0.0];

    const idOriginPt = getNextId();
    lines.push(
      `${idOriginPt}=CARTESIAN_POINT('', (${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}, ${origin[2].toFixed(6)}));`
    );
    const idAxis1 = getNextId();
    lines.push(`${idAxis1}=DIRECTION('', (${a1[0].toFixed(6)}, ${a1[1].toFixed(6)}, ${a1[2].toFixed(6)}));`);
    const idAxis2 = getNextId();
    lines.push(`${idAxis2}=DIRECTION('', (${a2[0].toFixed(6)}, ${a2[1].toFixed(6)}, ${a2[2].toFixed(6)}));`);
    const idPlacement = getNextId();
    lines.push(
      `${idPlacement}=AXIS2_PLACEMENT_3D('${StepTranslator._stepString(name)}', ${idOriginPt}, ${idAxis1}, ${idAxis2});`
    );
    const idCartTrans = getNextId();
    lines.push(
      `${idCartTrans}=CARTESIAN_TRANSFORMATION_3D('${StepTranslator._stepString(name)}', ${idPlacement}, ${scale.toFixed(6)});`
    );
    return idCartTrans;
  }

  static _emitLayerMetadata(lines, getNextId, layers, itemIds, color) {
    const layerList = Array.isArray(layers) ? layers : layers !== undefined && layers !== null ? [layers] : [];
    if (layerList.length === 0 && color === undefined) return;

    const layerItemIds = [];
    for (const layer of layerList) {
      const layerName = typeof layer === 'string' ? layer : layer.name || 'DefaultLayer';
      const idLayer = getNextId();
      lines.push(`${idLayer}=LAYER_ASSIGNMENT('${StepTranslator._stepString(layerName)}', (${itemIds.join(', ')}));`);
      layerItemIds.push(idLayer);
    }

    const colourId = color !== undefined ? StepTranslator._emitColourRgb(lines, getNextId, color) : null;
    const dmItems = [...layerItemIds];
    if (colourId) dmItems.push(colourId);
    const idDm = getNextId();
    lines.push(`${idDm}=DRAUGHTING_MODEL('LayerState', (${dmItems.join(', ')}));`);
  }

  static _emitColourRgb(lines, getNextId, color) {
    let r = 0.6;
    let g = 0.8;
    let b = 1.0;
    if (typeof color === 'string') {
      const m = color.match(/^#([0-9a-fA-F]{6})$/);
      if (m) {
        r = parseInt(m[1].substring(0, 2), 16) / 255;
        g = parseInt(m[1].substring(2, 4), 16) / 255;
        b = parseInt(m[1].substring(4, 6), 16) / 255;
      }
    } else if (color && typeof color === 'object') {
      if (typeof color.r === 'number') r = color.r;
      if (typeof color.g === 'number') g = color.g;
      if (typeof color.b === 'number') b = color.b;
    }
    const idColour = getNextId();
    lines.push(`${idColour}=COLOUR_RGB('', ${r.toFixed(6)}, ${g.toFixed(6)}, ${b.toFixed(6)});`);
    return idColour;
  }

  /**
   * Emits an AP242-style PMI block: DATUM, GEOMETRIC_TOLERANCE and
   * TOLERANCED_SIZE records referencing the emitted geometry entities.
   * Honest subset: semantic metadata only, not a full ISO 10303-242 kernel.
   * @param {string[]} lines
   * @param {Function} getNextId
   * @param {Object} solid Source B-Rep solid (may carry .datums / .geometricTolerances)
   * @param {Map<string,string>} faceIdByEntity emitted entity ref by source face id/name
   * @param {string} manifoldSolidId emitted MANIFOLD_SOLID_BREP ref
   * @returns {{datums: number, tolerances: number, sizes: number}} emitted counts
   */
  static _emitPmi(lines, getNextId, solid, faceIdByEntity = new Map(), manifoldSolidId = '') {
    const counts = { datums: 0, tolerances: 0, sizes: 0 };
    if (!solid) return counts;

    const resolveEntityRef = (entityId) => {
      if (entityId === null || entityId === undefined) return '';
      const key = String(entityId);
      if (faceIdByEntity.has(key)) return faceIdByEntity.get(key);
      if (key === String(solid.id) || key === String(solid.name)) return manifoldSolidId;
      return '';
    };

    const datumRefById = new Map();
    const datums = Array.isArray(solid.datums) ? solid.datums : [];
    for (const datum of datums) {
      const entityRef = resolveEntityRef(datum.entityId);
      if (!entityRef) continue;
      const idDatum = getNextId();
      lines.push(
        `${idDatum}=DATUM('${StepTranslator._stepString(datum.label)}', '${StepTranslator._stepString(datum.description || datum.name || '')}', ${entityRef});`
      );
      datumRefById.set(String(datum.label), idDatum);
      datumRefById.set(String(datum.id), idDatum);
      counts.datums++;
    }

    const tolerances = Array.isArray(solid.geometricTolerances) ? solid.geometricTolerances : [];
    for (const tol of tolerances) {
      const entityRef = resolveEntityRef(tol.entityId);
      if (!entityRef) continue;
      const datumIds = (tol.datumRefs || []).map((ref) => datumRefById.get(String(ref))).filter((ref) => ref);
      const idTol = getNextId();
      lines.push(
        `${idTol}=GEOMETRIC_TOLERANCE('${StepTranslator._stepString(tol.type)}', ${Number(tol.value).toFixed(6)}, (${datumIds.join(', ')}), (${entityRef}));`
      );
      counts.tolerances++;
      if (Number.isFinite(tol.nominalSize)) {
        const idSize = getNextId();
        lines.push(
          `${idSize}=TOLERANCED_SIZE('${StepTranslator._stepString(tol.name || tol.type)}', ${Number(tol.nominalSize).toFixed(6)}, ${entityRef});`
        );
        counts.sizes++;
      }
    }

    return counts;
  }

  static _stepString(s) {
    return String(s === undefined || s === null ? '' : s).replace(/'/g, "''");
  }

  static _emitSolidGeometry(lines, getNextId, solid, modelName) {
    const faceIds = [];
    const faceIdByEntity = new Map();

    const computeFaceFrame = (coords, explicitNormal = null) => {
      let tx = 1.0,
        ty = 0.0,
        tz = 0.0;
      let nx = 0.0,
        ny = 0.0,
        nz = 1.0;

      if (coords.length >= 2) {
        const dx1 = Number(coords[1][0]) - Number(coords[0][0]);
        const dy1 = Number(coords[1][1]) - Number(coords[0][1]);
        const dz1 = Number(coords[1][2]) - Number(coords[0][2]);
        const len1 = Math.hypot(dx1, dy1, dz1);
        if (len1 > 1e-12) {
          tx = dx1 / len1;
          ty = dy1 / len1;
          tz = dz1 / len1;
        }
      }

      if (
        explicitNormal &&
        Number.isFinite(explicitNormal.x) &&
        Number.isFinite(explicitNormal.y) &&
        Number.isFinite(explicitNormal.z) &&
        Math.hypot(explicitNormal.x, explicitNormal.y, explicitNormal.z) > 1e-12
      ) {
        const nLen = Math.hypot(explicitNormal.x, explicitNormal.y, explicitNormal.z);
        nx = explicitNormal.x / nLen;
        ny = explicitNormal.y / nLen;
        nz = explicitNormal.z / nLen;
      } else if (coords.length >= 3) {
        const ux = Number(coords[1][0]) - Number(coords[0][0]);
        const uy = Number(coords[1][1]) - Number(coords[0][1]);
        const uz = Number(coords[1][2]) - Number(coords[0][2]);
        const vx = Number(coords[2][0]) - Number(coords[0][0]);
        const vy = Number(coords[2][1]) - Number(coords[0][1]);
        const vz = Number(coords[2][2]) - Number(coords[0][2]);
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const cLen = Math.hypot(cx, cy, cz);
        if (cLen > 1e-12) {
          nx = cx / cLen;
          ny = cy / cLen;
          nz = cz / cLen;
        }
      }

      const dot = tx * nx + ty * ny + tz * nz;
      tx -= dot * nx;
      ty -= dot * ny;
      tz -= dot * nz;
      const tLen = Math.hypot(tx, ty, tz);
      if (tLen > 1e-12) {
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;
      } else {
        if (Math.abs(nz) < 0.9) {
          const fl = Math.hypot(-ny, nx, 0) || 1.0;
          tx = -ny / fl;
          ty = nx / fl;
          tz = 0.0;
        } else {
          const fl = Math.hypot(0, -nz, ny) || 1.0;
          tx = 0.0;
          ty = -nz / fl;
          tz = ny / fl;
        }
      }

      return {
        normal: [nx, ny, nz],
        tangent: [tx, ty, tz]
      };
    };

    if (solid && solid.faces && solid.faces.length > 0) {
      for (let f = 0; f < solid.faces.length; f++) {
        const face = solid.faces[f];
        const loopEdgeIds = [];

        const verts = face.vertices || (face.wire && face.wire.edges ? face.wire.edges.map((e) => e.startVertex) : []);
        const vertexEntities = [];

        for (let v = 0; v < verts.length; v++) {
          const pt = verts[v].point || verts[v];
          const numX = Number(pt[0] !== undefined ? pt[0] : pt.x || 0);
          const numY = Number(pt[1] !== undefined ? pt[1] : pt.y || 0);
          const numZ = Number(pt[2] !== undefined ? pt[2] : pt.z || 0);
          const px = numX.toFixed(6);
          const py = numY.toFixed(6);
          const pz = numZ.toFixed(6);

          const idPt = getNextId();
          lines.push(`${idPt}=CARTESIAN_POINT('', (${px}, ${py}, ${pz}));`);
          const idV = getNextId();
          lines.push(`${idV}=VERTEX_POINT('', ${idPt});`);
          vertexEntities.push({ ptId: idPt, vId: idV, coord: [numX, numY, numZ] });
        }

        for (let v = 0; v < vertexEntities.length; v++) {
          const vStart = vertexEntities[v];
          const vEnd = vertexEntities[(v + 1) % vertexEntities.length];

          const dx = vEnd.coord[0] - vStart.coord[0];
          const dy = vEnd.coord[1] - vStart.coord[1];
          const dz = vEnd.coord[2] - vStart.coord[2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;

          const idDir = getNextId();
          lines.push(
            `${idDir}=DIRECTION('', (${(dx / len).toFixed(6)}, ${(dy / len).toFixed(6)}, ${(dz / len).toFixed(6)}));`
          );
          const idLine = getNextId();
          lines.push(`${idLine}=LINE('', ${vStart.ptId}, ${idDir});`);
          const idEdge = getNextId();
          lines.push(`${idEdge}=EDGE_CURVE('', ${vStart.vId}, ${vEnd.vId}, ${idLine}, .T.);`);
          const idOrientedEdge = getNextId();
          lines.push(`${idOrientedEdge}=ORIENTED_EDGE('', *, *, ${idEdge}, .T.);`);
          loopEdgeIds.push(idOrientedEdge);
        }

        if (loopEdgeIds.length > 0) {
          const idEdgeLoop = getNextId();
          lines.push(`${idEdgeLoop}=EDGE_LOOP('', (${loopEdgeIds.join(', ')}));`);
          const idFaceBound = getNextId();
          lines.push(`${idFaceBound}=FACE_OUTER_BOUND('', ${idEdgeLoop}, .T.);`);

          const frame = computeFaceFrame(
            vertexEntities.map((ve) => ve.coord),
            face.normal
          );
          const idFaceNormal = getNextId();
          lines.push(
            `${idFaceNormal}=DIRECTION('${face.name || `Face_${f + 1}`}_Normal', (${frame.normal[0].toFixed(6)}, ${frame.normal[1].toFixed(6)}, ${frame.normal[2].toFixed(6)}));`
          );
          const idFaceTangent = getNextId();
          lines.push(
            `${idFaceTangent}=DIRECTION('${face.name || `Face_${f + 1}`}_Tangent', (${frame.tangent[0].toFixed(6)}, ${frame.tangent[1].toFixed(6)}, ${frame.tangent[2].toFixed(6)}));`
          );
          const idPlaneCS = getNextId();
          lines.push(
            `${idPlaneCS}=AXIS2_PLACEMENT_3D('', ${vertexEntities[0].ptId}, ${idFaceNormal}, ${idFaceTangent});`
          );
          const idPlane = getNextId();
          lines.push(`${idPlane}=PLANE('', ${idPlaneCS});`);

          const idAdvFace = getNextId();
          lines.push(
            `${idAdvFace}=ADVANCED_FACE('${face.name || `Face_${f + 1}`}', (${idFaceBound}), ${idPlane}, .T.);`
          );
          faceIds.push(idAdvFace);
          if (face && face.id) faceIdByEntity.set(String(face.id), idAdvFace);
          if (face && face.name) faceIdByEntity.set(String(face.name), idAdvFace);
        }
      }
    } else {
      const corners = [
        [-10, -10, 0],
        [10, -10, 0],
        [10, 10, 0],
        [-10, 10, 0],
        [-10, -10, 20],
        [10, -10, 20],
        [10, 10, 20],
        [-10, 10, 20]
      ];
      const cornerPts = corners.map((c) => {
        const idPt = getNextId();
        lines.push(`${idPt}=CARTESIAN_POINT('', (${c[0].toFixed(6)}, ${c[1].toFixed(6)}, ${c[2].toFixed(6)}));`);
        const idV = getNextId();
        lines.push(`${idV}=VERTEX_POINT('', ${idPt});`);
        return { ptId: idPt, vId: idV, coord: c };
      });

      const boxFaceIndices = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7]
      ];

      for (let f = 0; f < boxFaceIndices.length; f++) {
        const idx = boxFaceIndices[f];
        const loopEdgeIds = [];
        const faceCoords = idx.map((k) => cornerPts[k].coord);

        for (let i = 0; i < 4; i++) {
          const vS = cornerPts[idx[i]];
          const vE = cornerPts[idx[(i + 1) % 4]];
          const dx = vE.coord[0] - vS.coord[0];
          const dy = vE.coord[1] - vS.coord[1];
          const dz = vE.coord[2] - vS.coord[2];
          const len = Math.hypot(dx, dy, dz) || 1.0;
          const idDir = getNextId();
          lines.push(
            `${idDir}=DIRECTION('', (${(dx / len).toFixed(6)}, ${(dy / len).toFixed(6)}, ${(dz / len).toFixed(6)}));`
          );
          const idLine = getNextId();
          lines.push(`${idLine}=LINE('', ${vS.ptId}, ${idDir});`);
          const idEdge = getNextId();
          lines.push(`${idEdge}=EDGE_CURVE('', ${vS.vId}, ${vE.vId}, ${idLine}, .T.);`);
          const idOE = getNextId();
          lines.push(`${idOE}=ORIENTED_EDGE('', *, *, ${idEdge}, .T.);`);
          loopEdgeIds.push(idOE);
        }

        const idEdgeLoop = getNextId();
        lines.push(`${idEdgeLoop}=EDGE_LOOP('', (${loopEdgeIds.join(', ')}));`);
        const idFaceBound = getNextId();
        lines.push(`${idFaceBound}=FACE_OUTER_BOUND('', ${idEdgeLoop}, .T.);`);

        const frame = computeFaceFrame(faceCoords);
        const idFaceNormal = getNextId();
        lines.push(
          `${idFaceNormal}=DIRECTION('Box_Face_${f + 1}_Normal', (${frame.normal[0].toFixed(6)}, ${frame.normal[1].toFixed(6)}, ${frame.normal[2].toFixed(6)}));`
        );
        const idFaceTangent = getNextId();
        lines.push(
          `${idFaceTangent}=DIRECTION('Box_Face_${f + 1}_Tangent', (${frame.tangent[0].toFixed(6)}, ${frame.tangent[1].toFixed(6)}, ${frame.tangent[2].toFixed(6)}));`
        );
        const idPlaneCS = getNextId();
        lines.push(
          `${idPlaneCS}=AXIS2_PLACEMENT_3D('Box_Face_${f + 1}_CS', ${cornerPts[idx[0]].ptId}, ${idFaceNormal}, ${idFaceTangent});`
        );
        const idPlane = getNextId();
        lines.push(`${idPlane}=PLANE('', ${idPlaneCS});`);
        const idFace = getNextId();
        lines.push(`${idFace}=ADVANCED_FACE('Box_Face_${f + 1}', (${idFaceBound}), ${idPlane}, .T.);`);
        faceIds.push(idFace);
      }
    }

    return { faceIds, faceIdByEntity };
  }

  /**
   * Parses an ISO 10303-21 STEP file and extracts solids, faces, points, and
   * (when present) assembly / product structure records.
   * @param {string} stepContent Raw text of .step / .stp file
   */
  static parseSTEP(stepContent) {
    if (!stepContent || typeof stepContent !== 'string') {
      throw new Error('Invalid STEP content: must be a non-empty string');
    }

    const result = {
      header: {
        description: '',
        fileName: '',
        schema: ''
      },
      entities: {},
      summary: {
        cartesianPointsCount: 0,
        directionsCount: 0,
        advancedFacesCount: 0,
        manifoldSolidsCount: 0,
        productsCount: 0,
        productDefinitionsCount: 0,
        productDefinitionShapesCount: 0,
        shapeDefinitionRepresentationsCount: 0,
        nextAssemblyUsageOccurrencesCount: 0,
        itemDefinedTransformationsCount: 0,
        cartesianTransformationsCount: 0,
        shapeRepresentationsCount: 0,
        draughtingModelsCount: 0,
        layerAssignmentsCount: 0,
        colourRgbCount: 0,
        bSplineSurfacesCount: 0,
        rationalBSplineSurfacesCount: 0,
        bSplineCurvesCount: 0,
        rationalBSplineCurvesCount: 0,
        pCurvesCount: 0,
        surfaceCurvesCount: 0,
        faceBoundsCount: 0,
        faceOuterBoundsCount: 0,
        edgeLoopsCount: 0,
        datumsCount: 0,
        geometricTolerancesCount: 0,
        tolerancedSizesCount: 0
      },
      nurbsSurfaces: [],
      trimCurves: [],
      pCurves: [],
      parsedSolids: [],
      pmi: {
        datums: [],
        geometricTolerances: [],
        tolerancedSizes: []
      },
      assembly: {
        nodes: [],
        occurrences: [],
        transformations: [],
        layers: []
      }
    };

    const descMatch = stepContent.match(/FILE_DESCRIPTION\s*\(\s*\(([^)]+)\)/i);
    if (descMatch) result.header.description = descMatch[1].replace(/'/g, '').trim();

    const nameMatch = stepContent.match(/FILE_NAME\s*\(\s*'([^']+)'/i);
    if (nameMatch) result.header.fileName = nameMatch[1];

    const schemaMatch = stepContent.match(/FILE_SCHEMA\s*\(\s*\(([^)]+)\)/i);
    if (schemaMatch) result.header.schema = schemaMatch[1].replace(/'/g, '').trim();

    const dataMatch = stepContent.match(/DATA\s*;([\s\S]*?)ENDSEC\s*;/i);
    if (!dataMatch) {
      return result;
    }

    const entityRegex = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
    let match;

    while ((match = entityRegex.exec(dataMatch[1])) !== null) {
      const id = `#${match[1]}`;
      const type = match[2].toUpperCase();
      const rawArgs = match[3];

      result.entities[id] = { id, type, rawArgs };

      const sum = result.summary;
      if (type === 'CARTESIAN_POINT') {
        sum.cartesianPointsCount++;
        const coordMatch = rawArgs.match(/\(([^)]+)\)/);
        if (coordMatch) {
          const parts = coordMatch[1].split(',').map((s) => parseFloat(s.trim()));
          result.entities[id].coordinates = parts;
        }
      } else if (type === 'DIRECTION') {
        sum.directionsCount++;
      } else if (type === 'ADVANCED_FACE') {
        sum.advancedFacesCount++;
      } else if (type === 'MANIFOLD_SOLID_BREP') {
        sum.manifoldSolidsCount++;
        const nameMatch = rawArgs.match(/'([^']*)'/);
        result.parsedSolids.push({
          id,
          name: nameMatch ? nameMatch[1] : `Solid_${result.parsedSolids.length + 1}`
        });
      } else if (type === 'PRODUCT') {
        sum.productsCount++;
        const nameMatch = rawArgs.match(/'([^']*)'/);
        result.assembly.nodes.push({ id, type, name: nameMatch ? nameMatch[1] : '' });
      } else if (type === 'PRODUCT_DEFINITION') {
        sum.productDefinitionsCount++;
      } else if (type === 'PRODUCT_DEFINITION_SHAPE') {
        sum.productDefinitionShapesCount++;
      } else if (type === 'SHAPE_DEFINITION_REPRESENTATION') {
        sum.shapeDefinitionRepresentationsCount++;
        const refs = StepTranslator._splitTopLevelArgs(rawArgs);
        result.assembly.nodes.push({ id, type, shapeDef: refs[0] || '', shapeRep: refs[1] || '' });
      } else if (type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE') {
        sum.nextAssemblyUsageOccurrencesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        const strings = parts.filter((p, i) => i >= 2 && p.startsWith("'"));
        result.assembly.occurrences.push({
          id,
          relatingProductDefinition: parts[0] || '',
          relatedProductDefinition: parts[1] || '',
          referenceDesignator: StepTranslator._stripString(strings[0] || ''),
          name: StepTranslator._stripString(strings[1] || ''),
          description: StepTranslator._stripString(strings[2] || '')
        });
      } else if (type === 'ITEM_DEFINED_TRANSFORMATION') {
        sum.itemDefinedTransformationsCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        result.assembly.transformations.push({
          id,
          transformationOperator: parts[2] || '',
          item: parts[3] || ''
        });
      } else if (type === 'CARTESIAN_TRANSFORMATION_3D') {
        sum.cartesianTransformationsCount++;
      } else if (type === 'ADVANCED_BREP_SHAPE_REPRESENTATION' || type === 'SHAPE_REPRESENTATION') {
        sum.shapeRepresentationsCount++;
      } else if (type === 'DRAUGHTING_MODEL') {
        sum.draughtingModelsCount++;
      } else if (type === 'LAYER_ASSIGNMENT') {
        sum.layerAssignmentsCount++;
        const nameMatch = rawArgs.match(/'([^']*)'/);
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        result.assembly.layers.push({
          id,
          name: nameMatch ? nameMatch[1] : '',
          items: (parts[1] || '').match(/#\d+/g) || []
        });
      } else if (type === 'COLOUR_RGB') {
        sum.colourRgbCount++;
      } else if (type === 'B_SPLINE_SURFACE_WITH_KNOTS' || type === 'RATIONAL_B_SPLINE_SURFACE') {
        sum.bSplineSurfacesCount++;
        if (type === 'RATIONAL_B_SPLINE_SURFACE') sum.rationalBSplineSurfacesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        const pointRefs = StepTranslator._parseControlPointGrid(parts[3]);
        const surf = {
          id,
          type,
          name: StepTranslator._stripString(parts[0] || ''),
          uDegree: parseInt(parts[1], 10),
          vDegree: parseInt(parts[2], 10),
          controlPointRefs: pointRefs,
          controlPoints: [],
          surfaceForm: parts[4] || '',
          uClosed: parts[5] || '',
          vClosed: parts[6] || '',
          selfIntersect: parts[7] || '',
          uKnots: StepTranslator._parseNumberList(parts[8]),
          vKnots: StepTranslator._parseNumberList(parts[9]),
          knotSpec: parts[10] || ''
        };
        if (parts.length > 11) surf.weights = StepTranslator._parseNumberGrid(parts[11]);
        result.nurbsSurfaces.push(surf);
      } else if (type === 'B_SPLINE_CURVE_WITH_KNOTS' || type === 'RATIONAL_B_SPLINE_CURVE_WITH_KNOTS') {
        sum.bSplineCurvesCount++;
        if (type === 'RATIONAL_B_SPLINE_CURVE_WITH_KNOTS') sum.rationalBSplineCurvesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        const curveRefs = (parts[2] || '').match(/#\d+/g) || [];
        const curveRec = {
          id,
          type,
          name: StepTranslator._stripString(parts[0] || ''),
          degree: parseInt(parts[1], 10),
          controlPointRefs: curveRefs,
          controlPoints: [],
          form: parts[3] || '',
          closed: parts[4] || '',
          selfIntersect: parts[5] || '',
          knots: StepTranslator._parseNumberList(parts[6]),
          knotSpec: parts[7] || ''
        };
        if (parts.length > 8) curveRec.weights = StepTranslator._parseNumberList(parts[8]);
        result.trimCurves.push(curveRec);
      } else if (type === 'PCURVE') {
        sum.pCurvesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        result.pCurves.push({ id, surface: parts[1] || '', curve: parts[2] || '' });
      } else if (type === 'SURFACE_CURVE') {
        sum.surfaceCurvesCount++;
      } else if (type === 'FACE_BOUND') {
        sum.faceBoundsCount++;
      } else if (type === 'FACE_OUTER_BOUND') {
        sum.faceOuterBoundsCount++;
      } else if (type === 'EDGE_LOOP') {
        sum.edgeLoopsCount++;
      } else if (type === 'DATUM') {
        sum.datumsCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        result.pmi.datums.push({
          id,
          label: StepTranslator._stripString(parts[0] || ''),
          description: StepTranslator._stripString(parts[1] || ''),
          associatedEntity: (parts[2] || '').match(/#\d+/g) || []
        });
      } else if (type === 'GEOMETRIC_TOLERANCE') {
        sum.geometricTolerancesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        const datumRefs = (parts[2] || '').match(/#\d+/g) || [];
        const appliedEntities = (parts[3] || '').match(/#\d+/g) || [];
        result.pmi.geometricTolerances.push({
          id,
          characteristic: StepTranslator._stripString(parts[0] || ''),
          value: parseFloat(parts[1]),
          datumRefs,
          appliedEntities
        });
      } else if (type === 'TOLERANCED_SIZE') {
        sum.tolerancedSizesCount++;
        const parts = StepTranslator._splitTopLevelArgs(rawArgs);
        result.pmi.tolerancedSizes.push({
          id,
          name: StepTranslator._stripString(parts[0] || ''),
          value: parseFloat(parts[1]),
          appliedEntity: (parts[2] || '').match(/#\d+/g) || []
        });
      }
    }

    for (const surf of result.nurbsSurfaces) {
      surf.controlPoints = surf.controlPointRefs.map((row) =>
        row.map((ref) => {
          const ent = result.entities[ref];
          return ent && Array.isArray(ent.coordinates) ? ent.coordinates : null;
        })
      );
    }

    for (const curve of result.trimCurves) {
      curve.controlPoints = curve.controlPointRefs.map((ref) => {
        const ent = result.entities[ref];
        return ent && Array.isArray(ent.coordinates) ? ent.coordinates : null;
      });
    }

    result.format = 'STEP_AP203_AP214';
    result.totalEntities = Object.keys(result.entities).length;
    result.vertices = Object.values(result.entities)
      .filter((e) => e.type === 'CARTESIAN_POINT' && e.coordinates)
      .map((e) => e.coordinates);

    return result;
  }

  static _parseNumberList(str) {
    if (!str) return [];
    const inner = String(str).replace(/^\s*\((.*)\)\s*$/s, '$1');
    return inner
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
  }

  static _parseNumberGrid(str) {
    if (!str) return [];
    const inner = String(str).replace(/^\s*\((.*)\)\s*$/s, '$1');
    return StepTranslator._splitTopLevelArgs(inner).map((row) => StepTranslator._parseNumberList(row));
  }

  static _parseControlPointGrid(str) {
    if (!str) return [];
    const inner = String(str).replace(/^\s*\((.*)\)\s*$/s, '$1');
    return StepTranslator._splitTopLevelArgs(inner).map((row) => {
      const refs = row.match(/#\d+/g) || [];
      return refs.map((r) => r);
    });
  }

  static _splitTopLevelArgs(rawArgs) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < rawArgs.length; i++) {
      const ch = rawArgs[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim().length > 0) parts.push(current.trim());
    return parts;
  }

  static _stripString(s) {
    return s.replace(/^'|'$/g, '').replace(/''/g, "'");
  }

  static toSTEP(solid, modelName = 'OmniEng_CAD_Part') {
    return StepTranslator.exportSTEP(solid, modelName);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StepTranslator };
}
