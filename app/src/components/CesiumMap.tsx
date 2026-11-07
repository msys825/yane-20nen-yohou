"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Cartesian2, Cesium3DTileFeature, Cesium3DTileset, Entity, PointPrimitiveCollection, Primitive, Viewer } from "cesium";
import { loadCesium, type Cesium } from "@/lib/loadCesium";
import { NERIMA_BLDG_LOD2_TILESET, toBuildingInfo, type BuildingInfo } from "@/lib/plateau";
import { fetchDiagnosis, fetchListing, type Diagnosis } from "@/lib/diagnosis";

const GROW_MS = 2200; // 選んだ家の南側の建物が伸びきるまでの時間
const CITY_GROW_MS = 4500; // 街全体が伸びきるまでの時間

// tools/export_forecast_points.py の出力。[経度, 緯度, 屋根の高さ] を平らに並べたもの
export type ForecastMap = { houses: number; risk: number[]; safe: number[] };

// tools/export_future_city.py の出力
export type FutureCity = {
  area: string;
  center: [number, number];
  radiusM: number;
  count: number; // ルール上、今より3m以上高く建て替えられる建物の数
  candidates: number; // 範囲の中の建物の数
  addedVolumeM3: number;
  buildings: { f: [number, number][]; b: number; h: number; m: number }[];
};

// 選んだ家の南側で、ルール上高くなりうる建物（画面の一覧と AI への説明に使う）
export type NearVolume = { bearing: number; distance: number; nowHeight: number; maxHeight: number; reason?: string };

export type Selection = { info: BuildingInfo | null; diagnosis: Diagnosis | null; volumes: NearVolume[] };

export type CameraRequest =
  | { kind: "ward"; requestedAt: number }
  | { kind: "wardOblique"; requestedAt: number } // 未来の街を見るときの、斜めに低い視点
  | { kind: "point"; lon: number; lat: number; requestedAt: number };

type Props = {
  onSelect?: (s: Selection | null) => void;
  onCompare?: (diagnoses: Diagnosis[]) => void;
  compare: { gmlIds: string[]; requestedAt: number } | null; // 比べる2軒（押すたびに requestedAt が変わる）
  selectGml: { gmlId: string; requestedAt: number } | null; // 例の家などを、地図をクリックせずに選ぶ
  showFuture: boolean; // 選んだ家の南側に建ちうる建物を表示する
  timeIso: string; // 影を計算する時刻（UTC）
  layers: { forecast: boolean; city: boolean }; // 地図のレイヤー：将来の影の予報（家の色）／まち全体の建ちうる建物
  onForecastLoaded?: (m: ForecastMap) => void;
  onCityLoaded?: (c: FutureCity) => void;
  camera: CameraRequest | null;
  pin: { lon: number; lat: number } | null; // 住所で探した場所の目印
};

// 区の中心（北緯35.747）を、南から60°見下ろす。高さ9km で区の東西（約11km）が入る
const WARD_VIEW = { lon: 139.621, lat: 35.747 - 9000 / Math.tan(Math.PI / 3) / 110950, height: 9000, pitch: -60 };

export default function CesiumMap(props: Props) {
  const { compare, selectGml, showFuture, timeIso, layers, camera, pin } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const viewerRef = useRef<Viewer | null>(null);
  const cesiumRef = useRef<Cesium | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);
  const [readyTick, setReadyTick] = useReadyTick();
  const futureEntities = useRef<Entity[]>([]);
  const highlightEntities = useRef<Entity[]>([]);
  const labelEntities = useRef<Entity[]>([]);
  const pinEntity = useRef<Entity | null>(null);
  const growStart = useRef(0);
  const showFutureRef = useRef(showFuture);
  showFutureRef.current = showFuture;
  const timeRef = useRef(timeIso);
  timeRef.current = timeIso;
  const selectedFeature = useRef<Cesium3DTileFeature | undefined>(undefined);
  const cityData = useRef<Promise<FutureCity> | null>(null);
  const cityPrimitive = useRef<Primitive | null>(null);
  const cityGrow = useRef<{ start: number | null; scaleAt: (k: number) => unknown } | null>(null);
  const forecastPoints = useRef<PointPrimitiveCollection | null>(null);
  const selectHouseRef = useRef<((gmlId: string, info: BuildingInfo | null) => Promise<void>) | null>(null);

  const loadCity = () => {
    if (!cityData.current) cityData.current = fetch("/data/future_city/nerima.json").then((r) => r.json());
    return cityData.current;
  };

  useEffect(() => {
    let destroyed = false;
    let cleanup = () => {};

    (async () => {
      const Cesium = await loadCesium();
      if (destroyed || !containerRef.current) return;
      cesiumRef.current = Cesium;

      // 背景地図：国土地理院 淡色地図（ズーム5〜18。ない段階を読みに行くと地図が表示されなくなる）
      const baseLayer = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
          minimumLevel: 5,
          maximumLevel: 18,
          credit: new Cesium.Credit("出典：国土地理院（地理院タイル）"),
        }),
      );
      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shadows: true,
      });
      viewerRef.current = viewer;
      if (process.env.NODE_ENV === "development") (window as unknown as { __viewer: Viewer }).__viewer = viewer;
      viewer.scene.globe.depthTestAgainstTerrain = false;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#eceae4");
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(timeRef.current);
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(WARD_VIEW.lon, WARD_VIEW.lat, WARD_VIEW.height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(WARD_VIEW.pitch), roll: 0 },
      });

      const tileset = await Cesium.Cesium3DTileset.fromUrl(NERIMA_BLDG_LOD2_TILESET, { shadows: Cesium.ShadowMode.ENABLED });
      if (destroyed) return;
      tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#f4efe6')" });
      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;

      // 例の2軒（家A・家B）の名札。「そっくりな2軒」のときだけ見せる
      const listing = await fetchListing();
      for (const h of listing.filter((x) => x.label)) {
        labelEntities.current.push(
          viewer.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, h.topHeight),
            properties: { gmlId: h.gmlId },
            point: { pixelSize: 9, color: Cesium.Color.fromCssColorString("#1c7ed6"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: {
              text: h.label!,
              font: "bold 15px sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString("#1c1c1c"),
              outlineWidth: 4,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -18),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
      }

      const selectHouse = async (gmlId: string, info: BuildingInfo | null) => {
        const diagnosis = await fetchDiagnosis(gmlId);
        let volumes: NearVolume[];
        let lon = info?.lon;
        let lat = info?.lat;
        let base = 40;
        if (diagnosis) {
          lon = diagnosis.lon;
          lat = diagnosis.lat;
          base = diagnosis.baseHeight;
          volumes = diagnosis.volumes.map((v) => ({ bearing: v.bearing, distance: v.distance, nowHeight: v.nowHeight, maxHeight: v.maxHeight, reason: v.reason }));
          drawFuture([diagnosis]);
        } else if (lon && lat) {
          // 詳しい診断がない家：南側30m以内でルール上高くなりうる建物を、区全体の「未来の街」のデータから選んで描く
          const city = await loadCity();
          const near = city.buildings
            .map((b) => {
              const bx = b.f.reduce((s, p) => s + p[0], 0) / b.f.length;
              const by = b.f.reduce((s, p) => s + p[1], 0) / b.f.length;
              const dx = (bx - lon!) * 111320 * Math.cos((lat! * Math.PI) / 180);
              const dy = (by - lat!) * 110950;
              return { b, d: Math.hypot(dx, dy), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
            })
            .filter((v) => v.d > 2 && v.d < 30 && v.bearing >= 100 && v.bearing <= 260)
            .sort((a, b) => a.d - b.d);
          base = near[0]?.b.b ?? 40;
          drawFuture([]);
          drawVolumes(near.map(({ b }) => ({ footprint: b.f, baseHeight: b.b, nowHeight: b.h, maxHeight: b.m })));
          volumes = near.map(({ b, d, bearing }) => ({ bearing: Math.round(bearing), distance: Math.round(d * 10) / 10, nowHeight: b.h, maxHeight: b.m }));
        } else {
          volumes = [];
        }
        if (lon && lat)
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.0011, base + 70),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 },
            duration: 1.2,
          });
        cb.current.onSelect?.({ info, diagnosis, volumes });
      };
      selectHouseRef.current = selectHouse;

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction(async (e: { position: Cartesian2 }) => {
        // 予報の点は建物の上に重なるので、重なりの下まで見て、建物か家の目印を探す
        const picks = viewer.scene.drillPick(e.position, 8);
        const picked = picks.find(
          (p) => p instanceof Cesium.Cesium3DTileFeature || (p as { id?: { properties?: { gmlId?: unknown } } })?.id?.properties?.gmlId,
        );
        if (selectedFeature.current) selectedFeature.current.color = Cesium.Color.WHITE;
        selectedFeature.current = undefined;
        if (picked instanceof Cesium.Cesium3DTileFeature) {
          selectedFeature.current = picked;
          picked.color = Cesium.Color.fromCssColorString("#74b0ea"); // 選んだ家は青（オレンジは将来の建物だけに使う）
          const p: Record<string, unknown> = {};
          for (const id of picked.getPropertyIds()) p[id] = picked.getProperty(id);
          await selectHouse(String(p["gml_id"]), toBuildingInfo(p));
        } else if (picked?.id?.properties?.gmlId) {
          await selectHouse(picked.id.properties.gmlId.getValue(), null);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      cleanup = () => {
        handler.destroy();
        viewer.destroy();
        viewerRef.current = null;
      };
      setReadyTick();
    })();

    return () => {
      destroyed = true;
      cleanup();
    };
    // drawFuture などは ref だけを使うので、依存に入れなくても古い値を使うことはない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選んだ家の輪郭（青い線）と、南側で建ちうる最大の建物を描く
  function drawFuture(diagnoses: Diagnosis[]) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    for (const e of [...futureEntities.current, ...highlightEntities.current]) viewer.entities.remove(e);
    futureEntities.current = [];
    highlightEntities.current = [];
    for (const d of diagnoses) {
      const top = d.baseHeight + (d.height ?? 0) + 0.3;
      highlightEntities.current.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([...d.footprint, d.footprint[0]].flatMap(([lon, lat]) => [lon, lat, top])),
            width: 4,
            material: Cesium.Color.fromCssColorString("#1c7ed6"),
          },
        }),
      );
      drawVolumes(d.volumes);
    }
  }

  function drawVolumes(volumes: { footprint: [number, number][]; baseHeight: number; nowHeight: number; maxHeight: number }[]) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    if (showFutureRef.current) growStart.current = performance.now();
    for (const v of volumes) {
      // 今の高さから、ルール上の最大の高さまで伸びていく（伸びる様子で「建て替わりうる」ことを伝える）
      const extruded = new Cesium.CallbackProperty(() => {
        const t = Math.min(1, Math.max(0, (performance.now() - growStart.current) / GROW_MS));
        const ease = 1 - Math.pow(1 - t, 3);
        return v.baseHeight + v.nowHeight + (v.maxHeight - v.nowHeight) * ease;
      }, false);
      futureEntities.current.push(
        viewer.entities.add({
          show: showFutureRef.current,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(v.footprint.flat()),
            height: v.baseHeight,
            extrudedHeight: extruded,
            material: Cesium.Color.fromCssColorString("#e8590c").withAlpha(0.45),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#e8590c"),
            shadows: Cesium.ShadowMode.ENABLED,
          },
        }),
      );
    }
  }

  useEffect(() => {
    if (showFuture) growStart.current = performance.now();
    for (const e of futureEntities.current) e.show = showFuture;
  }, [showFuture]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(timeIso);
  }, [timeIso, readyTick]);

  // 例の家などを、地図をクリックせずに選ぶ
  useEffect(() => {
    if (!selectGml || !selectHouseRef.current) return;
    selectHouseRef.current(selectGml.gmlId, null);
  }, [selectGml, readyTick]);

  // カメラの移動（区全体／住所で探した場所）
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !camera) return;
    if (camera.kind === "wardOblique") {
      // 区の中心を、南から40°で斜めに見下ろす（建物の高さが分かる）
      const back = 5600;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(139.617, 35.7475 - back / 110950, back * 0.9),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-40), roll: 0 },
        duration: 2.0,
      });
    } else if (camera.kind === "ward") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(WARD_VIEW.lon, WARD_VIEW.lat, WARD_VIEW.height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(WARD_VIEW.pitch), roll: 0 },
        duration: 2.0,
      });
    } else {
      // 探した場所を、南の斜め上から見下ろす（家を見分けてクリックしやすい高さ）
      const h = 320;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat - h / Math.tan((50 * Math.PI) / 180) / 110950, h),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
        duration: 2.0,
      });
    }
  }, [camera, readyTick]);

  // 住所で探した場所の目印
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    if (pinEntity.current) viewer.entities.remove(pinEntity.current);
    pinEntity.current = null;
    if (!pin) return;
    pinEntity.current = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, 60),
      point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#1c7ed6"), outlineColor: Cesium.Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        text: "探した場所",
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#1c1c1c"),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }, [pin, readyTick]);

  // 「そっくりな2軒」：2軒の輪郭と将来の建物を描き、2軒が見える位置へ移動する
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    for (const e of labelEntities.current) e.show = !!compare;
    if (!compare || !viewer || !Cesium) return;
    (async () => {
      const diags = (await Promise.all(compare.gmlIds.map(fetchDiagnosis))).filter((d): d is Diagnosis => !!d);
      drawFuture(diags);
      const lon = diags.reduce((s, d) => s + d.lon, 0) / diags.length;
      const lat = diags.reduce((s, d) => s + d.lat, 0) / diags.length;
      const span = Math.max(...diags.map((d) => Math.hypot((d.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180), (d.lat - lat) * 110950)));
      const back = Math.max(50, span * 1.9);
      const pitch = -48;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat - back / 110950, diags[0].baseHeight + back * Math.tan((-pitch * Math.PI) / 180)),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
        duration: 1.5,
      });
      cb.current.onCompare?.(diags);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, readyTick]);

  // レイヤー：将来の影の予報（練馬区の全戸建ての点。オレンジ＝将来1割以上減りうる家、淡い青＝それ以外）
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    // 未来の街を見ている間は、点を隠す（建物と重なって見えにくいため）
    const visible = layers.forecast && !layers.city;
    if (forecastPoints.current) {
      forecastPoints.current.show = visible;
      return;
    }
    if (!layers.forecast) return;
    let cancelled = false;
    (async () => {
      const m: ForecastMap = await (await fetch("/data/forecast_points.json")).json();
      if (cancelled || forecastPoints.current) return;
      const points = new Cesium.PointPrimitiveCollection();
      // 屋根の少し上に、家ごとの点を置く
      const add = (arr: number[], color: string, size: number) => {
        const c = Cesium.Color.fromCssColorString(color);
        for (let i = 0; i < arr.length; i += 3)
          points.add({
            position: Cesium.Cartesian3.fromDegrees(arr[i], arr[i + 1], arr[i + 2] + 1.5),
            color: c,
            pixelSize: size,
            scaleByDistance: new Cesium.NearFarScalar(300, 1.6, 8000, 1),
            // 建物に隠れる点は見せない（近くで、点が建物の手前に浮いて見えないように）
            disableDepthTestDistance: 0,
          });
      };
      add(m.safe, "#9ec5e8", 2);
      add(m.risk, "#e8590c", 5); // 少ないので後から描いて上に重ねる
      points.show = visible;
      viewer.scene.primitives.add(points);
      forecastPoints.current = points;
      cb.current.onForecastLoaded?.(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [layers.forecast, layers.city, readyTick]);

  // レイヤー：まち全体の、建ちうる建物（ルール上の最大の高さまで、地面から一斉に伸びる）
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const tileset = tilesetRef.current;
    if (!viewer || !Cesium) return;
    // 未来の街を見ている間は、今の建物を青みの灰色にしてオレンジを際立たせる
    if (tileset) tileset.style = new Cesium.Cesium3DTileStyle({ color: layers.city ? "color('#d5dae1')" : "color('#f4efe6')" });
    if (cityPrimitive.current) {
      cityPrimitive.current.show = layers.city;
      if (layers.city && cityGrow.current) cityGrow.current.start = null; // もう一度伸ばす
      return;
    }
    if (!layers.city) return;
    let cancelled = false;
    (async () => {
      const city = await loadCity();
      if (cancelled || cityPrimitive.current) return;
      const ramp = ["#F59F6B", "#E8590C", "#B83C0B", "#7A2306"]; // 今より高くなる分が大きいほど濃い
      const colorOf = (grow: number) => ramp[grow < 6 ? 0 : grow < 10 ? 1 : grow < 15 ? 2 : 3];
      const instances = city.buildings.map(
        (b) =>
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(b.f.flat())),
              height: b.b,
              extrudedHeight: b.b + b.m,
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(colorOf(b.m - b.h))) },
          }),
      );
      const ground = city.buildings.reduce((s, b) => s + b.b, 0) / Math.max(1, city.buildings.length);
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(city.center[0], city.center[1], ground));
      const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
      const scaleAt = (k: number) =>
        Cesium.Matrix4.multiply(Cesium.Matrix4.multiply(enu, Cesium.Matrix4.fromScale(new Cesium.Cartesian3(1, 1, k)), new Cesium.Matrix4()), inv, new Cesium.Matrix4());
      const primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
        modelMatrix: scaleAt(0.02),
        shadows: Cesium.ShadowMode.ENABLED,
        asynchronous: true,
      });
      viewer.scene.primitives.add(primitive);
      cityPrimitive.current = primitive;
      const grow = { start: null as number | null, scaleAt };
      cityGrow.current = grow;
      // 建物が多いと表示の準備に時間がかかるので、準備ができてから伸び始める
      viewer.scene.preUpdate.addEventListener(() => {
        if (!primitive.show) return;
        if (grow.start === null) {
          if (!primitive.ready) return;
          grow.start = performance.now() + 300;
        }
        const t = Math.min(1, Math.max(0, (performance.now() - grow.start) / CITY_GROW_MS));
        primitive.modelMatrix = scaleAt(0.02 + 0.98 * (1 - Math.pow(1 - t, 3)));
      });
      cb.current.onCityLoaded?.(city);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.city, readyTick]);

  return <div ref={containerRef} className="h-full w-full" />;
}

// 地図の準備ができたことを、ほかの effect に知らせる（準備前に来た指示を、準備後にやり直すため）
function useReadyTick(): [number, () => void] {
  const [n, setN] = useState(0);
  const bump = useCallback(() => setN((x) => x + 1), []);
  return [n, bump];
}
