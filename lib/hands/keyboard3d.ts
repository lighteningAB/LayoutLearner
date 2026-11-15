// 3D keyboard built from a ParsedLayout: instanced low-profile keycaps (one
// InstancedMesh per distinct cap size), one instanced quad per legend sampling
// a shared canvas atlas, a plate, and soft glows for target / modifier keys.

import * as THREE from "three";
import { mixSRGB, type HandsTheme } from "./theme";
import type { KeySink } from "./pose";
import { KEY_GAP, KEY_TOP, KEY_TRAVEL, type KeyPlacement, type PlacedLayout } from "./space";

const BEVEL = 0.055;
const LEGEND_INSET = 0.2;
/** How strongly idle keys are tinted with their finger's colour. */
const ZONE_TINT = 0.16;

interface KeyRec {
  pl: KeyPlacement;
  mesh: THREE.InstancedMesh;
  index: number;
  legend: number;
  dip: number;
  hold: number;
  flash: number;
  ok: boolean;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Cap with its top face at y = 0, extending down to y = -height. */
function capGeometry(w: number, h: number, height: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(roundedRect(w - KEY_GAP, h - KEY_GAP, 0.12), {
    depth: height - BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(height - BEVEL) - BEVEL, 0);
  g.deleteAttribute("uv");
  return g;
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

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const col2 = new THREE.Color();

export class Keyboard3D implements KeySink {
  readonly group = new THREE.Group();
  private recs = new Map<string, KeyRec>();
  private capMeshes: THREE.InstancedMesh[] = [];
  private capMaterial: THREE.MeshStandardMaterial;
  private legendMesh: THREE.InstancedMesh | null = null;
  private legendMaterial: THREE.MeshBasicMaterial;
  private legendTexture: THREE.CanvasTexture | null = null;
  private legendCanvas: HTMLCanvasElement | null = null;
  private legendCells: { pl: KeyPlacement; x: number; y: number; w: number; h: number }[] = [];
  private pxPerUnit = 128;
  private plate: THREE.Mesh;
  private plateMaterial: THREE.MeshStandardMaterial;
  private glowTexture: THREE.CanvasTexture;
  private glows: THREE.Mesh[] = [];
  private dots: THREE.InstancedMesh;
  private dotTexture: THREE.CanvasTexture;
  private theme: HandsTheme | null = null;
  private targetId: string | null = null;
  private modifierId: string | null = null;
  private zones = true;
  private disposables: { dispose(): void }[] = [];

  constructor(readonly placed: PlacedLayout) {
    this.capMaterial = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
    this.disposables.push(this.capMaterial);

    // --- caps, bucketed by size
    const buckets = new Map<string, KeyPlacement[]>();
    for (const pl of placed.list) {
      const k = `${pl.w.toFixed(2)}x${pl.h.toFixed(2)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(pl);
    }
    let legend = 0;
    for (const list of buckets.values()) {
      const geo = capGeometry(list[0].w, list[0].h, KEY_TOP - 0.03);
      this.disposables.push(geo);
      const mesh = new THREE.InstancedMesh(geo, this.capMaterial, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      list.forEach((pl, index) => {
        this.recs.set(pl.key.id, { pl, mesh, index, legend: legend++, dip: 0, hold: 0, flash: 0, ok: true });
        mesh.setColorAt(index, col.setRGB(1, 1, 1));
      });
      this.capMeshes.push(mesh);
      this.disposables.push(mesh);
      this.group.add(mesh);
    }

    // --- plate
    const pw = placed.maxX - placed.minX + 0.7;
    const ph = placed.maxZ - placed.minZ + 0.7;
    const plateGeo = new THREE.ExtrudeGeometry(roundedRect(pw, ph, 0.45), {
      depth: 0.34,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelOffset: -0.06,
      bevelSegments: 2,
      curveSegments: 6,
    });
    plateGeo.rotateX(-Math.PI / 2);
    plateGeo.translate((placed.minX + placed.maxX) / 2, -0.4, (placed.minZ + placed.maxZ) / 2);
    this.plateMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    this.plate = new THREE.Mesh(plateGeo, this.plateMaterial);
    this.plate.receiveShadow = true;
    this.group.add(this.plate);
    this.disposables.push(plateGeo, this.plateMaterial);

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

    // --- glows (0: target, 1: modifier)
    this.glowTexture = makeGlowTexture();
    this.disposables.push(this.glowTexture);
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    this.disposables.push(glowGeo);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        opacity: i === 0 ? 0.6 : 0.4,
      });
      const g = new THREE.Mesh(glowGeo, mat);
      g.visible = false;
      g.renderOrder = 2;
      this.glows.push(g);
      this.group.add(g);
      this.disposables.push(mat);
    }

    // --- contact dots: where each fingertip touches (visible through the hands)
    this.dotTexture = makeDotTexture();
    const dotMat = new THREE.MeshBasicMaterial({
      map: this.dotTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.dots = new THREE.InstancedMesh(glowGeo, dotMat, 10);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 4;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < 10; i++) {
      this.dots.setMatrixAt(i, m4);
      this.dots.setColorAt(i, col.setRGB(1, 1, 1));
    }
    this.group.add(this.dots);
    this.disposables.push(this.dotTexture, dotMat, this.dots);

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
    this.placeGlow(0, id);
  }

  setModifier(id: string | null): void {
    if (id === this.modifierId) return;
    const prev = this.modifierId;
    this.modifierId = id;
    this.refresh(prev);
    this.refresh(id);
    this.placeGlow(1, id);
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
    const fontChanged = !this.theme || this.theme.font !== theme.font;
    this.theme = theme;
    // Light themes: a clearly darker case, so the near-white caps stand out from the page.
    if (theme.bgLuma > 0.5) mixSRGB(this.plateMaterial.color, theme.border, theme.sub, 0.42);
    else mixSRGB(this.plateMaterial.color, theme.bgAlt, theme.border, 0.4);
    if (fontChanged) this.drawLegends();
    this.refreshAll();
    this.placeGlow(0, this.targetId);
    this.placeGlow(1, this.modifierId);
    for (let i = 0; i < 10; i++) this.dots.setColorAt(i, mixSRGB(col, theme.fingers[i], theme.text, 0.35));
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }

  /** Re-rasterise legends (e.g. after web fonts finish loading). */
  redrawLegends(): void {
    this.drawLegends();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.legendTexture?.dispose();
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
    } else if (id === this.modifierId) {
      mixSRGB(col, col, finger ?? t.main, 0.62);
      legendOnAccent = 0.7;
    }
    if (rec.flash > 0) {
      mixSRGB(col, col, rec.ok ? t.main : t.error, rec.flash);
      legendOnAccent = Math.max(legendOnAccent, rec.flash);
    }
    rec.mesh.setColorAt(rec.index, col);
    if (rec.mesh.instanceColor) rec.mesh.instanceColor.needsUpdate = true;

    if (this.legendMesh) {
      // legend: key text normally; on accent-coloured keys pick whichever of bg/text contrasts more
      col2.copy(t.keyText);
      if (finger && this.zones && legendOnAccent === 0) mixSRGB(col2, col2, finger, 0.3);
      if (legendOnAccent > 0) {
        const l = luma(col);
        const lb = luma(t.bg);
        const lt = luma(t.text);
        const pick = Math.abs(l - lb) > Math.abs(l - lt) ? t.bg : t.text;
        mixSRGB(col2, col2, pick, legendOnAccent);
      }
      this.legendMesh.setColorAt(rec.legend, col2);
      if (this.legendMesh.instanceColor) this.legendMesh.instanceColor.needsUpdate = true;
    }
  }

  private placeGlow(i: number, id: string | null): void {
    const g = this.glows[i];
    const rec = id ? this.recs.get(id) : undefined;
    if (!rec || !this.theme) {
      g.visible = false;
      return;
    }
    const pl = rec.pl;
    g.visible = true;
    g.position.set(pl.cx, KEY_TOP + 0.01, pl.cz);
    g.rotation.y = pl.rotY;
    g.scale.set(pl.w + 1.5, 1, pl.h + 1.5);
    const c = rec.pl.fingerIdx >= 0 ? this.theme.fingers[rec.pl.fingerIdx] : this.theme.main;
    (g.material as THREE.MeshBasicMaterial).color.copy(c);
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
    const canvas = this.legendCanvas;
    if (!canvas || !this.legendTexture) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px = this.pxPerUnit;
    const font = this.theme?.font ?? "system-ui, sans-serif";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of this.legendCells) {
      const texts = legendTexts(c.pl);
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
        ctx.roundRect(cx - 0.11 * px, y0 + h - 0.085 * px, 0.22 * px, 0.035 * px, 0.017 * px);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    this.legendTexture.needsUpdate = true;
  }
}

function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(0.7, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDotTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const c = s / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,0.5)");
  g.addColorStop(0.6, "rgba(255,255,255,0.38)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(c, c, s * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
