import type { Cartesian2, Cartesian3, Cartographic, Ray, Viewer } from "cesium";
import type { Cesium } from "@/lib/loadCesium";

// トラックパッドの操作を、ふつうの地図サービスに合わせる
// - 二本指でスライド：視点の移動
// - 二本指を広げる・狭める（ブラウザには Ctrl 付きのホイールとして届く）：ズーム
// - Shift を押しながら二本指でスライド：上下で角度、左右で向き
// マウスのホイールは、これまでどおり Cesium のズームのまま
const MIN_RANGE = 15; // ズームで、これより近くには寄らない（m）
const MIN_PITCH = -89; // 真上から見下ろす
const MAX_PITCH = -5; // ほぼ水平

export function installTrackpadControls(
  Cesium: Cesium,
  viewer: Viewer,
  element: HTMLElement,
  groundAtLonLat: (lon: number, lat: number) => number, // 地面の高さ（楕円体高、m）
): () => void {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const groundM = (c: Cartographic) => groundAtLonLat(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude));
  let lastTrackpadAt = 0;

  // 地面の高さ h の面と、視線の交わり
  const hitAtHeight = (ray: Ray, h: number): Cartesian3 | undefined => {
    const r = Cesium.Ellipsoid.WGS84.radii;
    const e = new Cesium.Ellipsoid(r.x + h, r.y + h, r.z + h);
    const t = Cesium.IntersectionTests.rayEllipsoid(ray, e);
    return t ? Cesium.Ray.getPoint(ray, t.start) : undefined;
  };
  // 画面の点の下にある地面の位置。地図の描画を待たずに、地面の高さの表から求める
  const pickAt = (pos: Cartesian2): Cartesian3 | undefined => {
    const ray = camera.getPickRay(pos);
    if (!ray) return undefined;
    let p = hitAtHeight(ray, groundM(camera.positionCartographic));
    if (p) p = hitAtHeight(ray, groundM(Cesium.Cartographic.fromCartesian(p))) ?? p; // 当たった所の高さで、もう一度
    return p;
  };

  // カメラが地面より下に入らないように。入るなら、動かす前に戻す
  const groundClearance = () => {
    const c = camera.positionCartographic;
    return c.height - groundM(c);
  };
  const guarded = (action: () => void) => {
    const pos = Cesium.Cartesian3.clone(camera.position);
    const dir = Cesium.Cartesian3.clone(camera.direction);
    const up = Cesium.Cartesian3.clone(camera.up);
    action();
    if (groundClearance() < MIN_RANGE) {
      camera.setView({ destination: pos, orientation: { direction: dir, up } });
    }
  };

  const canvasPos = (e: WheelEvent) => {
    const r = scene.canvas.getBoundingClientRect();
    return new Cesium.Cartesian2(e.clientX - r.left, e.clientY - r.top);
  };
  const centerPos = () => new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);

  // マウスのホイールか（1目盛りずつ、縦だけ、120の倍数）。トラックパッドは細かく、横にも動く
  const looksLikeMouse = (e: WheelEvent) => {
    if (e.deltaMode !== 0) return true;
    if (e.deltaX !== 0) return false;
    const w = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    return typeof w === "number" && w !== 0 && w % 120 === 0;
  };

  const zoom = (e: WheelEvent) => {
    const target = pickAt(canvasPos(e));
    if (!target) return;
    const toTarget = Cesium.Cartesian3.subtract(target, camera.positionWC, new Cesium.Cartesian3());
    const dist = Cesium.Cartesian3.magnitude(toTarget);
    // 広げる（deltaY が負）で寄る。動かす割合は、指の量に比例させる
    const k = 1 - Math.exp(e.deltaY * 0.01);
    let step = dist * k;
    if (dist - step < MIN_RANGE) step = Math.max(0, dist - MIN_RANGE);
    if (step === 0) return;
    Cesium.Cartesian3.normalize(toTarget, toTarget);
    camera.move(toTarget, step);
  };

  const pan = (dx: number, dy: number) => {
    const center = pickAt(centerPos());
    const dist = center ? Cesium.Cartesian3.distance(center, camera.positionWC) : camera.positionCartographic.height;
    const fovy = (camera.frustum as { fovy?: number }).fovy ?? Math.PI / 3;
    const mpp = (2 * dist * Math.tan(fovy / 2)) / scene.canvas.clientHeight; // 画面の1px が何mか
    // 地面に沿った右と前（カメラの向きから上下の成分を除く）
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(camera.positionWC, new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.clone(camera.rightWC);
    Cesium.Cartesian3.subtract(right, Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(right, up), new Cesium.Cartesian3()), right);
    Cesium.Cartesian3.normalize(right, right);
    const forward = Cesium.Cartesian3.cross(up, right, new Cesium.Cartesian3());
    // 指と一緒に地図が動く：指を上へ（deltaY が正）→ 地図が上へ → カメラは手前へ
    const move = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(right, dx * mpp, new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(forward, -dy * mpp, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    camera.position = Cesium.Cartesian3.add(camera.position, move, new Cesium.Cartesian3());
  };

  const orbit = (dx: number, dy: number) => {
    const center = pickAt(centerPos());
    if (!center) return;
    const range = Cesium.Cartesian3.distance(center, camera.positionWC);
    // 中心から見たカメラの向き・角度を求めて、少し回す
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const inv = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4());
    const local = Cesium.Matrix4.multiplyByPoint(inv, camera.positionWC, new Cesium.Cartesian3());
    const heading = Math.atan2(-local.x, -local.y); // カメラが向いている方位
    const pitch = -Math.asin(Math.min(1, Math.max(-1, local.z / range)));
    const newHeading = heading + Cesium.Math.toRadians(dx * 0.2);
    // 指を上へ（deltaY が正）→ 水平に近づく
    const newPitch = Cesium.Math.clamp(pitch + Cesium.Math.toRadians(dy * 0.15), Cesium.Math.toRadians(MIN_PITCH), Cesium.Math.toRadians(MAX_PITCH));
    camera.lookAt(center, new Cesium.HeadingPitchRange(newHeading, newPitch, range));
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  };

  const onWheel = (e: WheelEvent) => {
    const now = performance.now();
    const recentTrackpad = now - lastTrackpadAt < 300;
    const mouse = !recentTrackpad && looksLikeMouse(e);
    if (!mouse) lastTrackpadAt = now;

    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }

    if (e.ctrlKey) {
      guarded(() => zoom(e));
    } else if (e.shiftKey) {
      // マウスで Shift を押すと、OS が縦のホイールを横に変えることがある
      if (mouse && dy === 0) [dx, dy] = [0, dx];
      guarded(() => orbit(dx, dy));
    } else if (mouse) {
      return; // マウスのホイールは Cesium のズームに任せる
    } else {
      guarded(() => pan(dx, dy));
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // canvas より先に受け取って、Cesium にホイールを渡さない
  element.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => element.removeEventListener("wheel", onWheel, { capture: true });
}
