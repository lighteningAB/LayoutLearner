// 3D keyboard built from a ParsedLayout, drawn as a drafted line drawing: flat
// unlit keycaps (one InstancedMesh per distinct cap size) and plate in the
// sheet's fill tones, every outline a constant-width screen-space line in the
// line colour, one instanced quad per legend sampling a shared canvas atlas,
// and heavy outline frames for the target key (solid) and held keys (dashed).

import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { mixSRGB, type HandsTheme } from "./theme";
import type { KeySink } from "./pose";
import type { LayoutLayer } from "../types";
import { KEY_GAP, KEY_TOP, KEY_TRAVEL, type KeyPlacement, type PlacedLayout } from "./space";

const LEGEND_INSET = 0.2;
/** How strongly idle keys are filled with their finger's colour (flat fill). */
const ZONE_TINT = 0.2;
/** Held keys that get a dashed frame (more are still filled). */
const MAX_HOLD_FRAMES = 3;
/** Corner radius of a cap (key units) and segments per corner: near-square, just enough for clean line joins. */
const CAP_CORNER = 0.05;
const CORNER_SEGS = 2;
/** Points (= line segments) in one cap outline. */
const CAP_LOOP = 4 * (CORNER_SEGS + 1);
/** Line weights in CSS pixels (LineMaterial keeps them constant across canvas sizes and pixel ratios). */
const LINE_W = 1.25;
const TARGET_W = 3;
const HOLD_W = 2.25;
/** Lines sit this far above the surface they outline. */
const LINE_LIFT = 0.003;
/** How far cap / plate side walls are toned towards the line colour. */
const SIDE_TONE = 0.3;
/** A pressed key shows its flash fill while the (decaying) flash level is above this. */
const FLASH_ON = 0.22;
const PLATE_TOP = -0.06;
const PLATE_BOTTOM = -0.4;

interface KeyRec {
  pl: KeyPlacement;
  mesh: THREE.InstancedMesh;
  index: number;
  legend: number;
  /** First segment of this key's outline in the shared line buffer. */
  line: number;
  dip: number;
  hold: number;
  flash: number;
  ok: boolean;
}

/** Rounded-rectangle outline in the xz plane, counter-clockwise in (x, z): `out` receives x,z pairs; returns the point count. */
function loopPoints(w: number, h: number, r: number, segs: number, out: Float32Array): number {
  r = Math.min(r, w / 2, h / 2);
  let n = 0;
  for (let c = 0; c < 4; c++) {
    const a0 = (c * Math.PI) / 2;
    const cx = Math.sign(Math.cos(a0 + Math.PI / 4)) * (w / 2 - r);
    const cz = Math.sign(Math.sin(a0 + Math.PI / 4)) * (h / 2 - r);
    for (let s = 0; s <= segs; s++) {
      const a = a0 + (s / segs) * (Math.PI / 2);
      out[n * 2] = cx + r * Math.cos(a);
      out[n * 2 + 1] = cz + r * Math.sin(a);
      n++;
    }
  }
  return n;
}

/** Flat-topped slab over an outline: top face at `top`, walls down to `bottom`. `aSide` is 1 on the walls. */
function slabGeometry(loop: Float32Array, n: number, top: number, bottom: number): THREE.BufferGeometry {
  const position = new Float32Array(n * 3 * 3);
  const side = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = loop[i * 2];
    const z = loop[i * 2 + 1];
    position.set([x, top, z], i * 3);
    position.set([x, top, z], (n + i) * 3);
    position.set([x, bottom, z], (2 * n + i) * 3);
    side[n + i] = side[2 * n + i] = 1;
  }
  const index: number[] = [];
  for (let i = 1; i < n - 1; i++) index.push(0, i + 1, i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(n + i, n + j, 2 * n + j, n + i, 2 * n + j, 2 * n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  g.setIndex(index);
  return g;
}

/** Unlit fill pushed back in depth so the outlines drawn on it always win; walls are toned towards `side`. */
function fillMaterial(side: { value: THREE.Color }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2, toneMapped: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSide = side;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSide;\nvarying float vSide;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSide = aSide;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSide;\nvarying float vSide;")
      .replace("#include <color_fragment>", `#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uSide, vSide * ${SIDE_TONE.toFixed(2)} );`);
  };
  return m;
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&nbsp;": " " };

function legendTexts(pl: KeyPlacement): string[] {
  return pl.key.legends
    .map((l) =>
      l
        .replace(/<[^>]*>/g, "")
        .replace(/&[a-z]+;/g, (m) => ENTITIES[m] ?? "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 2);
}

/** Legends of a key while a layer is shown: its character(s), blank when the layer leaves a character key unused. */
function layerLegendTexts(pl: KeyPlacement, layer: LayoutLayer): string[] {
  const e = layer.keys[pl.key.id];
  if (e) return e.shifted ? [e.shifted, e.base] : [e.base];
  const k = pl.key;
  // Activators and non-character keys (Space, Shift, ...) keep their names; unused character keys go blank.
  return k.base && k.base !== " " && !layer.activatorIds.includes(k.id) ? [] : legendTexts(pl);
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const col2 = new THREE.Color();
const loopBuf = new Float32Array(64);

/** A heavy outline around one key (the target, or a held key), moved with its cap. */
interface Frame {
  line: LineSegments2;
  material: LineMaterial;
  /** x,y,z,x,y,z per segment, in the key's local frame. */
  seg: THREE.InstancedInterleavedBuffer;
  /** Distance along the outline at each segment's start / end (for dashes). */
  dist: THREE.InstancedInterleavedBuffer;
}

function makeFrame(width: number, dashed: boolean): Frame {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(CAP_LOOP * 6));
  const seg = (geo.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer;
  seg.setUsage(THREE.DynamicDrawUsage);
  const dist = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP_LOOP * 2), 2, 1);
  dist.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(dist, 1, 0));
  geo.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(dist, 1, 1));
  const material = new LineMaterial({ linewidth: width, dashed, dashSize: 0.13, gapSize: 0.09, toneMapped: false });
  const line = new LineSegments2(geo, material);
  line.frustumCulled = false;
  line.visible = false;
  line.renderOrder = 2;
  return { line, material, seg, dist };
}

export class Keyboard3D implements KeySink {
  readonly group = new THREE.Group();
  private recs = new Map<string, KeyRec>();
  private capMeshes: THREE.InstancedMesh[] = [];
  private capMaterial: THREE.MeshBasicMaterial;
  /** Tone of the cap and plate walls. */
  private sideTone = { value: new THREE.Color() };
  /** Every static outline (caps, plate) as one batch of fat line segments; cap segments follow their cap in y. */
  private lineMaterial: LineMaterial;
  private lineSeg: THREE.InstancedInterleavedBuffer;
  /** 0: target key (solid), 1..MAX_HOLD_FRAMES: held keys (dashed). */
  private frames: Frame[] = [];
  private legendMesh: THREE.InstancedMesh | null = null;
  private legendMaterial: THREE.MeshBasicMaterial;
  private legendTexture: THREE.CanvasTexture | null = null;
  private legendCanvas: HTMLCanvasElement | null = null;
  /** The layer whose legends are on the keycaps (null = base), and one cached atlas per layer shown so far. */
  private layer: LayoutLayer | null = null;
  private layerAtlases = new Map<LayoutLayer, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  private legendCells: { pl: KeyPlacement; x: number; y: number; w: number; h: number }[] = [];
  private pxPerUnit = 128;
  private plate: THREE.Mesh;
  private plateMaterial: THREE.MeshBasicMaterial;
  private dots: THREE.InstancedMesh;
  private dotTexture: THREE.CanvasTexture;
  private theme: HandsTheme | null = null;
  private targetId: string | null = null;
  private holdIds: string[] = [];
  private zones = true;
  private disposables: { dispose(): void }[] = [];

  constructor(readonly placed: PlacedLayout) {
    this.capMaterial = fillMaterial(this.sideTone);
    this.disposables.push(this.capMaterial);

    // --- caps, bucketed by size; their outlines go into one shared line buffer
    const buckets = new Map<string, KeyPlacement[]>();
    for (const pl of placed.list) {
      const k = `${pl.w.toFixed(2)}x${pl.h.toFixed(2)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(pl);
    }
    const PLATE_SEGS = 4;
    const plateLoop = 4 * (PLATE_SEGS + 1);
    const segs = new Float32Array((placed.list.length * CAP_LOOP + plateLoop * 2) * 6);
    let legend = 0;
    let line = 0;
    for (const list of buckets.values()) {
      const n = loopPoints(list[0].w - KEY_GAP, list[0].h - KEY_GAP, CAP_CORNER, CORNER_SEGS, loopBuf);
      const geo = slabGeometry(loopBuf, n, 0, -(KEY_TOP - 0.03));
      this.disposables.push(geo);
      const mesh = new THREE.InstancedMesh(geo, this.capMaterial, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      list.forEach((pl, index) => {
        this.recs.set(pl.key.id, { pl, mesh, index, legend: legend++, line, dip: 0, hold: 0, flash: 0, ok: true });
        mesh.setColorAt(index, col.setRGB(1, 1, 1));
        m4.makeRotationY(pl.rotY).setPosition(pl.cx, KEY_TOP + LINE_LIFT, pl.cz);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          pos.set(loopBuf[i * 2], 0, loopBuf[i * 2 + 1]).applyMatrix4(m4).toArray(segs, (line + i) * 6);
          pos.set(loopBuf[j * 2], 0, loopBuf[j * 2 + 1]).applyMatrix4(m4).toArray(segs, (line + i) * 6 + 3);
        }
        line += n;
      });
      this.capMeshes.push(mesh);
      this.disposables.push(mesh);
      this.group.add(mesh);
    }

    // --- plate: a flat slab under the keys, outlined top and bottom
    const pw = placed.maxX - placed.minX + 0.7;
    const ph = placed.maxZ - placed.minZ + 0.7;
    const px = (placed.minX + placed.maxX) / 2;
    const pz = (placed.minZ + placed.maxZ) / 2;
    const pn = loopPoints(pw, ph, 0.18, PLATE_SEGS, loopBuf);
    const plateGeo = slabGeometry(loopBuf, pn, PLATE_TOP, PLATE_BOTTOM);
    plateGeo.translate(px, 0, pz);
    for (const y of [PLATE_TOP + LINE_LIFT, PLATE_BOTTOM]) {
      for (let i = 0; i < pn; i++) {
        const j = (i + 1) % pn;
        pos.set(px + loopBuf[i * 2], y, pz + loopBuf[i * 2 + 1]).toArray(segs, (line + i) * 6);
        pos.set(px + loopBuf[j * 2], y, pz + loopBuf[j * 2 + 1]).toArray(segs, (line + i) * 6 + 3);
      }
      line += pn;
    }
    this.plateMaterial = fillMaterial(this.sideTone);
    this.plate = new THREE.Mesh(plateGeo, this.plateMaterial);
    this.group.add(this.plate);
    this.disposables.push(plateGeo, this.plateMaterial);

    // --- outlines
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(segs);
    this.lineSeg = (lineGeo.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer;
    this.lineSeg.setUsage(THREE.DynamicDrawUsage);
    this.lineMaterial = new LineMaterial({ linewidth: LINE_W, toneMapped: false });
    const lines = new LineSegments2(lineGeo, this.lineMaterial);
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    this.group.add(lines);
    this.disposables.push(lineGeo, this.lineMaterial);

    for (let i = 0; i < 1 + MAX_HOLD_FRAMES; i++) {
      const f = makeFrame(i === 0 ? TARGET_W : HOLD_W, i > 0);
      this.frames.push(f);
      this.group.add(f.line);
      this.disposables.push(f.line.geometry, f.material);
    }

    // --- legends
    this.legendMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.legendMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aUvRect;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = aUvRect.xy + uv * aUvRect.zw;");
    };
    this.disposables.push(this.legendMaterial);
    this.buildLegends();

    // --- contact marks: a drafted ring where each fingertip touches (visible through the hands)
    this.dotTexture = makeDotTexture();
    const dotGeo = new THREE.PlaneGeometry(1, 1);
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({
      map: this.dotTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.dots = new THREE.InstancedMesh(dotGeo, dotMat, 10);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 4;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < 10; i++) {
      this.dots.setMatrixAt(i, m4);
      this.dots.setColorAt(i, col.setRGB(1, 1, 1));
    }
    this.group.add(this.dots);
    this.disposables.push(this.dotTexture, dotGeo, dotMat, this.dots);

    for (const rec of this.recs.values()) this.writeMatrix(rec);
  }

  setContact(finger: number, x: number, z: number, lift: number): void {
    // shrink away as the fingertip lifts off the keys
    const k = lift <= 0.03 ? 1 : Math.max(0, 1 - (lift - 0.03) / 0.5);
    const s = 0.62 * k;
    m4.makeScale(s, 1, s).setPosition(x, KEY_TOP + Math.min(0, lift) + 0.012, z);
    this.dots.setMatrixAt(finger, m4);
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // ---- state ---------------------------------------------------------------

  setTarget(id: string | null): void {
    if (id === this.targetId) return;
    const prev = this.targetId;
    this.targetId = id;
    this.refresh(prev);
    this.refresh(id);
    this.placeFrame(0, id);
  }

  /** Keys shown as held (layer key, Shift, ...). */
  setHolds(ids: readonly string[]): void {
    const prev = this.holdIds;
    if (ids.length === prev.length && ids.every((id, i) => id === prev[i])) return;
    this.holdIds = ids.slice();
    for (const id of prev) this.refresh(id);
    for (const id of ids) this.refresh(id);
    this.placeHoldFrames();
  }

  /** @deprecated use `setHolds`. */
  setModifier(id: string | null): void {
    this.setHolds(id ? [id] : []);
  }

  private placeHoldFrames(): void {
    for (let i = 0; i < MAX_HOLD_FRAMES; i++) this.placeFrame(1 + i, this.holdIds[i] ?? null);
  }

  setFingerZones(on: boolean): void {
    if (on === this.zones) return;
    this.zones = on;
    this.refreshAll();
  }

  setKeyPress(id: string, dip: number, flash: number, ok: boolean): void {
    const rec = this.recs.get(id);
    if (!rec) return;
    const moved = rec.dip !== dip;
    rec.dip = dip;
    rec.flash = flash;
    rec.ok = ok;
    if (moved) this.writeMatrix(rec);
    this.writeColor(rec);
  }

  setKeyHold(id: string, amount: number): void {
    const rec = this.recs.get(id);
    if (!rec || rec.hold === amount) return;
    rec.hold = amount;
    this.writeMatrix(rec);
  }

  applyTheme(theme: HandsTheme): void {
    const fontChanged = !this.theme || this.theme.legendFont !== theme.legendFont;
    this.theme = theme;
    // The drawing's two fill tones and one line colour; everything else is derived per key in writeColor.
    this.plateMaterial.color.copy(theme.bgAlt);
    this.sideTone.value.copy(theme.keyBorder);
    this.lineMaterial.color.copy(theme.keyBorder);
    for (const f of this.frames) f.material.color.copy(theme.text);
    if (fontChanged) this.drawLegends();
    this.refreshAll();
    for (let i = 0; i < 10; i++) this.dots.setColorAt(i, theme.fingers[i]);
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }

  /** Re-rasterise legends (e.g. after web fonts finish loading). */
  redrawLegends(): void {
    this.drawLegends();
  }

  /**
   * Shows `layer`'s legends on the keycaps (null = the base legends). Each layer is rasterised once, the
   * first time it is shown, and then only swapped in; nothing is drawn per frame.
   */
  setLayer(layer: LayoutLayer | null): void {
    if (layer === this.layer || !this.legendCanvas || !this.legendTexture) return;
    this.layer = layer;
    let tex = this.legendTexture;
    if (layer) {
      let atlas = this.layerAtlases.get(layer);
      if (!atlas) {
        const canvas = document.createElement("canvas");
        canvas.width = this.legendCanvas.width;
        canvas.height = this.legendCanvas.height;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        atlas = { canvas, texture };
        this.layerAtlases.set(layer, atlas);
        this.paintLegends(canvas, texture, layer);
      }
      tex = atlas.texture;
    }
    this.legendMaterial.map = tex;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.legendTexture?.dispose();
    for (const a of this.layerAtlases.values()) a.texture.dispose();
    this.layerAtlases.clear();
    this.legendMesh?.geometry.dispose();
    this.legendMesh?.dispose();
    this.legendCanvas = null;
  }

  // ---- internals -----------------------------------------------------------

  private refresh(id: string | null): void {
    const rec = id ? this.recs.get(id) : undefined;
    if (rec) this.writeColor(rec);
  }

  private refreshAll(): void {
    for (const rec of this.recs.values()) this.writeColor(rec);
  }

  private writeMatrix(rec: KeyRec): void {
    const pl = rec.pl;
    const y = KEY_TOP - KEY_TRAVEL * Math.max(rec.dip, rec.hold);
    quat.setFromAxisAngle(Y, pl.rotY);
    m4.compose(pos.set(pl.cx, y, pl.cz), quat, scl.set(1, 1, 1));
    rec.mesh.setMatrixAt(rec.index, m4);
    rec.mesh.instanceMatrix.needsUpdate = true;
    if (this.legendMesh) {
      m4.compose(pos.set(pl.cx, y + 0.004, pl.cz), quat, scl.set(pl.w - LEGEND_INSET, 1, pl.h - LEGEND_INSET));
      this.legendMesh.setMatrixAt(rec.legend, m4);
      this.legendMesh.instanceMatrix.needsUpdate = true;
    }
    // the outline rides on its cap
    const seg = this.lineSeg.array as Float32Array;
    const ly = y + LINE_LIFT;
    for (let i = rec.line * 6, end = (rec.line + CAP_LOOP) * 6; i < end; i += 3) seg[i + 1] = ly;
    this.lineSeg.needsUpdate = true;
    const id = pl.key.id;
    if (id === this.targetId) this.frames[0].line.position.y = ly;
    const hi = this.holdIds.indexOf(id);
    if (hi >= 0 && hi < MAX_HOLD_FRAMES) this.frames[1 + hi].line.position.y = ly;
  }

  private writeColor(rec: KeyRec): void {
    const t = this.theme;
    if (!t) return;
    const id = rec.pl.key.id;
    const finger = rec.pl.fingerIdx >= 0 ? t.fingers[rec.pl.fingerIdx] : null;
    let legendOnAccent = 0;
    col.copy(t.keyBg);
    if (finger && this.zones) mixSRGB(col, col, finger, ZONE_TINT);
    if (id === this.targetId) {
      col.copy(finger ?? t.main);
      legendOnAccent = 1;
    } else if (this.holdIds.includes(id)) {
      mixSRGB(col, col, finger ?? t.main, 0.62);
      legendOnAccent = 1;
    }
    // A press blinks the whole cap in the accent (or error) colour: a hard switch, not a fade, as on a drawing.
    if (rec.flash > FLASH_ON) {
      col.copy(rec.ok ? t.main : t.error);
      legendOnAccent = 1;
    }
    rec.mesh.setColorAt(rec.index, col);
    if (rec.mesh.instanceColor) rec.mesh.instanceColor.needsUpdate = true;

    if (this.legendMesh) {
      // legend: key text normally; on accent-coloured keys pick whichever of bg/text contrasts more
      col2.copy(t.keyText);
      if (legendOnAccent > 0) {
        const l = luma(col);
        const pick = contrast(l, luma(t.bg)) > contrast(l, luma(t.text)) ? t.bg : t.text;
        mixSRGB(col2, col2, pick, legendOnAccent);
      }
      this.legendMesh.setColorAt(rec.legend, col2);
      if (this.legendMesh.instanceColor) this.legendMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Puts frame `i` around key `id` (null hides it): its outline, at the cap's current height. */
  private placeFrame(i: number, id: string | null): void {
    const f = this.frames[i];
    const rec = id ? this.recs.get(id) : undefined;
    if (!rec) {
      f.line.visible = false;
      return;
    }
    const pl = rec.pl;
    const n = loopPoints(pl.w - KEY_GAP, pl.h - KEY_GAP, CAP_CORNER, CORNER_SEGS, loopBuf);
    const seg = f.seg.array as Float32Array;
    const dist = f.dist.array as Float32Array;
    let d = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const x0 = loopBuf[k * 2];
      const z0 = loopBuf[k * 2 + 1];
      const x1 = loopBuf[j * 2];
      const z1 = loopBuf[j * 2 + 1];
      seg[k * 6] = x0;
      seg[k * 6 + 1] = 0;
      seg[k * 6 + 2] = z0;
      seg[k * 6 + 3] = x1;
      seg[k * 6 + 4] = 0;
      seg[k * 6 + 5] = z1;
      dist[k * 2] = d;
      d += Math.hypot(x1 - x0, z1 - z0);
      dist[k * 2 + 1] = d;
    }
    f.seg.needsUpdate = true;
    f.dist.needsUpdate = true;
    f.line.visible = true;
    f.line.position.set(pl.cx, KEY_TOP - KEY_TRAVEL * Math.max(rec.dip, rec.hold) + LINE_LIFT, pl.cz);
    f.line.rotation.y = pl.rotY;
  }

  private buildLegends(): void {
    // shelf-pack one cell per key
    const cells = this.placed.list
      .map((pl) => ({ pl, w: pl.w - LEGEND_INSET, h: pl.h - LEGEND_INSET, x: 0, y: 0 }))
      .sort((a, b) => b.h - a.h || b.w - a.w);
    const area = cells.reduce((s, c) => s + c.w * c.h, 0);
    const rowW = Math.max(8, Math.ceil(Math.sqrt(area) * 1.3));
    let x = 0;
    let y = 0;
    let rowH = 0;
    const pad = 0.04;
    for (const c of cells) {
      if (x + c.w > rowW && x > 0) {
        x = 0;
        y += rowH + pad;
        rowH = 0;
      }
      c.x = x;
      c.y = y;
      x += c.w + pad;
      rowH = Math.max(rowH, c.h);
    }
    const totalW = Math.max(rowW, ...cells.map((c) => c.x + c.w));
    const totalH = y + rowH;
    this.pxPerUnit = Math.max(48, Math.min(128, Math.floor(4096 / Math.max(totalW, totalH))));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(totalW * this.pxPerUnit);
    canvas.height = Math.ceil(totalH * this.pxPerUnit);
    this.legendCanvas = canvas;
    this.legendCells = cells;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.legendTexture = tex;
    this.legendMaterial.map = tex;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const rects = new Float32Array(cells.length * 4);
    for (const c of cells) {
      const rec = this.recs.get(c.pl.key.id) as KeyRec;
      const px = this.pxPerUnit;
      rects[rec.legend * 4] = (c.x * px) / canvas.width;
      rects[rec.legend * 4 + 1] = 1 - ((c.y + c.h) * px) / canvas.height;
      rects[rec.legend * 4 + 2] = (c.w * px) / canvas.width;
      rects[rec.legend * 4 + 3] = (c.h * px) / canvas.height;
    }
    geo.setAttribute("aUvRect", new THREE.InstancedBufferAttribute(rects, 4));
    const mesh = new THREE.InstancedMesh(geo, this.legendMaterial, cells.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    for (let i = 0; i < cells.length; i++) mesh.setColorAt(i, col.setRGB(1, 1, 1));
    this.legendMesh = mesh;
    this.group.add(mesh);
  }

  private drawLegends(): void {
    if (!this.legendCanvas || !this.legendTexture) return;
    this.paintLegends(this.legendCanvas, this.legendTexture, null);
    for (const [layer, a] of this.layerAtlases) this.paintLegends(a.canvas, a.texture, layer);
  }

  private paintLegends(canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, layer: LayoutLayer | null): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px = this.pxPerUnit;
    const font = this.theme?.legendFont ?? "ui-monospace, monospace";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of this.legendCells) {
      const texts = layer ? layerLegendTexts(c.pl, layer) : legendTexts(c.pl);
      const x0 = c.x * px;
      const y0 = c.y * px;
      const w = c.w * px;
      const h = c.h * px;
      const cx = x0 + w / 2;
      const draw = (text: string, size: number, y: number, weight = 600) => {
        let s = size * px;
        ctx.font = `${weight} ${s}px ${font}`;
        const tw = ctx.measureText(text).width;
        const maxW = w - 0.06 * px;
        if (tw > maxW) {
          s *= maxW / tw;
          ctx.font = `${weight} ${s}px ${font}`;
        }
        ctx.fillText(text, cx, y);
      };
      if (texts.length === 1) {
        const t = texts[0];
        if (t.length <= 2) draw(t, 0.44, y0 + h * 0.5);
        else draw(t, 0.21, y0 + h * 0.5, 500);
      } else if (texts.length >= 2) {
        draw(texts[0], 0.27, y0 + h * 0.29);
        draw(texts[1], 0.3, y0 + h * 0.72);
      }
      // tactile bump on index-finger home keys
      const f = c.pl.key.finger;
      if (c.pl.key.isHome && f && f.finger === "index") {
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.rect(cx - 0.11 * px, y0 + h - 0.085 * px, 0.22 * px, 0.035 * px);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    texture.needsUpdate = true;
  }
}

/** WCAG contrast ratio of two relative luminances. */
function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Contact mark: a crisp ring with a centre point, like a drafted hole centre. */
function makeDotTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const c = s / 2;
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
