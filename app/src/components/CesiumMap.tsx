"use client";

import { useEffect, useRef } from "react";
import type { Cartesian2, Cesium3DTileFeature, Entity, PointPrimitiveCollection, Primitive, Viewer } from "cesium";
import { loadCesium, type Cesium } from "@/lib/loadCesium";
import { NERIMA_BLDG_LOD2_TILESET, NERIMA_CENTER, toBuildingInfo, type BuildingInfo } from "@/lib/plateau";
import { fetchDiagnosis, fetchListing, type Diagnosis } from "@/lib/diagnosis";

const GROW_MS = 2200; // 将来の建物が伸びきるまでの時間

type Props = {
  onSelect?: (info: BuildingInfo | null, diagnosis: Diagnosis | null) => void;
  onCompare?: (diagnoses: Diagnosis[]) => void;
  compare: { gmlIds: string[]; requestedAt: number } | null; // 比べる2軒（押すたびに requestedAt が変わる）
  showFuture: boolean;
  timeIso: string; // 影を計算する時刻（UTC）
  futureCity: { url: string; requestedAt: number } | null; // 「建ちうる未来の街」を表示する範囲のデータ
  onFutureCity?: (city: FutureCity | null) => void;
  forecastMap: { requestedAt: number } | null; // 区全体の予報マップ（全戸建ての簡易診断の点）を表示する
  onForecastMap?: (m: ForecastMap) => void;
};

// tools/export_forecast_points.py の出力。[経度, 緯度, 屋根の高さ] を平らに並べたもの
export type ForecastMap = { houses: number; risk: number[]; safe: number[] };

// tools/export_future_city.py の出力
export type FutureCity = {
  area: string; // 範囲の名前
  center: [number, number];
  radiusM: number;
  count: number; // ルール上、今より3m以上高く建て替えられる建物の数
  candidates: number; // 範囲の中の建物の数
  addedVolumeM3: number;
  buildings: { f: [number, number][]; b: number; h: number; m: number; z: string | null }[];
};

const CITY_GROW_MS = 4500; // 街が伸びきるまでの時間

export default function CesiumMap({
  onSelect,
  onCompare,
  compare,
  showFuture,
  timeIso,
  futureCity,
  onFutureCity,
  forecastMap,
  onForecastMap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCompareRef = useRef(onCompare);
  onCompareRef.current = onCompare;
  const viewerRef = useRef<Viewer | null>(null);
  const cesiumRef = useRef<Cesium | null>(null);
  const futureEntities = useRef<Entity[]>([]);
  const timeRef = useRef(timeIso);
  timeRef.current = timeIso;
  const highlightEntities = useRef<Entity[]>([]);
  const growStart = useRef(0); // 将来の建物が伸び始めた時刻（performance.now）
  const onFutureCityRef = useRef(onFutureCity);
  onFutureCityRef.current = onFutureCity;
  const cityPrimitive = useRef<Primitive | null>(null);
  const cityData = useRef<Promise<FutureCity> | null>(null);
  const forecastPoints = useRef<PointPrimitiveCollection | null>(null);
  const onForecastMapRef = useRef(onForecastMap);
  onForecastMapRef.current = onForecastMap;
  // 区全体の「建ちうる未来の街」のデータ（一度だけ読む）
  const loadCity = () => {
    if (!cityData.current) cityData.current = fetch("/data/future_city/nerima.json").then((r) => r.json());
    return cityData.current;
  };
  const cityTick = useRef<(() => void) | null>(null);

  useEffect(() => {
    let destroyed = false;
    let cleanup = () => {};

    (async () => {
      const Cesium = await loadCesium();
      if (destroyed || !containerRef.current) return;
      cesiumRef.current = Cesium;

      // 背景地図：国土地理院 淡色地図
      const baseLayer = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
          // 淡色地図はズーム5〜18。ない段階を読みに行くと地図が表示されなくなる
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

      const tileset = await Cesium.Cesium3DTileset.fromUrl(NERIMA_BLDG_LOD2_TILESET, {
        shadows: Cesium.ShadowMode.ENABLED,
      });
      if (destroyed) return;
      tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#f4efe6')" });
      viewer.scene.primitives.add(tileset);

      // 診断データがある家に目印を置く
      const listing = await fetchListing();
      for (const h of listing) {
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, h.topHeight),
          point: {
            pixelSize: 9,
            // 家A・家B（比べる2軒）は同じ色にする（色で答えを先に見せないため）
            color: h.change <= -0.1 && !h.label ? Cesium.Color.fromCssColorString("#d9480f") : Cesium.Color.fromCssColorString("#1c7ed6"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.NONE,
          },
          properties: { gmlId: h.gmlId },
          label: h.label
            ? {
                text: h.label,
                font: "bold 15px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString("#1c1c1c"),
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -18),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              }
            : undefined,
        });
      }

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(NERIMA_CENTER.lon, NERIMA_CENTER.lat - 0.007, 700),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
      });

      let selected: Cesium3DTileFeature | undefined;
      const selectHouse = async (gmlId: string, info: BuildingInfo | null) => {
        if (forecastPoints.current) forecastPoints.current.show = false; // 家を選んだら予報マップの点は隠す
        const diagnosis = await fetchDiagnosis(gmlId);
        if (!diagnosis && info?.lon && info?.lat) {
          // 詳しい診断がない家：南側30m以内でルール上高くなりうる建物を、区全体の「未来の街」のデータから選んで描く
          const city = await loadCity();
          const lat0 = info.lat;
          const lon0 = info.lon;
          const volumes = city.buildings
            .map((b) => {
              const bx = b.f.reduce((s, p) => s + p[0], 0) / b.f.length;
              const by = b.f.reduce((s, p) => s + p[1], 0) / b.f.length;
              const dx = (bx - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
              const dy = (by - lat0) * 110950;
              return { b, d: Math.hypot(dx, dy), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
            })
            .filter((v) => v.d > 2 && v.d < 30 && v.bearing >= 100 && v.bearing <= 260)
            .map(({ b }) => ({ footprint: b.f, baseHeight: b.b, nowHeight: b.h, maxHeight: b.m }));
          drawFuture([]);
          drawVolumes({ volumes } as unknown as Diagnosis);
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon0, lat0 - 0.0011, (volumes[0]?.baseHeight ?? 35) + 70),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 },
            duration: 1.2,
          });
          onSelectRef.current?.(info, null);
          return;
        }
        if (diagnosis) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(diagnosis.lon, diagnosis.lat - 0.0011, diagnosis.baseHeight + 70),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 },
            duration: 1.2,
          });
        }
        drawFuture(diagnosis ? [diagnosis] : []);
        onSelectRef.current?.(info, diagnosis);
      };

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction(async (e: { position: Cartesian2 }) => {
        // 予報マップの点は建物の上に重なるので、重なりの下まで見て、建物か家の目印を探す
        const picks = viewer.scene.drillPick(e.position, 8);
        const picked = picks.find(
          (p) => p instanceof Cesium.Cesium3DTileFeature || (p as { id?: { properties?: { gmlId?: unknown } } })?.id?.properties?.gmlId,
        );
        if (selected) selected.color = Cesium.Color.WHITE;
        selected = undefined;
        if (picked instanceof Cesium.Cesium3DTileFeature) {
          selected = picked;
          picked.color = Cesium.Color.fromCssColorString("#74b0ea"); // 選んだ家は青（オレンジは将来の建物だけに使う）
          const props: Record<string, unknown> = {};
          for (const id of picked.getPropertyIds()) props[id] = picked.getProperty(id);
          await selectHouse(String(props["gml_id"]), toBuildingInfo(props));
        } else if (picked?.id?.properties?.gmlId) {
          await selectHouse(picked.id.properties.gmlId.getValue(), null);
        } else {
          drawFuture([]);
          onSelectRef.current?.(null, null);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      cleanup = () => {
        handler.destroy();
        viewer.destroy();
        viewerRef.current = null;
      };
    })();

    return () => {
      destroyed = true;
      cleanup();
    };
  // drawFuture は ref だけを使うので、依存に入れなくても古い値を使うことはない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選んだ家の輪郭（青い線）と、南側で建ちうる最大の建物（半透明の箱）を描く
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
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(
              [...d.footprint, d.footprint[0]].flatMap(([lon, lat]) => [lon, lat, top]),
            ),
            width: 4,
            material: Cesium.Color.fromCssColorString("#1c7ed6"),
          },
        }),
      );
      drawVolumes(d);
    }
  }

  function drawVolumes(diagnosis: Diagnosis) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    if (showFutureRef.current) growStart.current = performance.now();
    for (const v of diagnosis.volumes) {
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

  const showFutureRef = useRef(showFuture);
  showFutureRef.current = showFuture;
  useEffect(() => {
    if (showFuture) growStart.current = performance.now();
    for (const e of futureEntities.current) e.show = showFuture;
  }, [showFuture]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(timeIso);
  }, [timeIso]);

  // 「そっくりな2軒を比べる」：2軒の輪郭と将来の建物を描き、2軒が見える位置へ移動する
  useEffect(() => {
    if (!compare) return;
    (async () => {
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium) return;
      const diags = (await Promise.all(compare.gmlIds.map(fetchDiagnosis))).filter((d): d is Diagnosis => !!d);
      drawFuture(diags);
      // 2軒の真ん中を、南の上空から見下ろす。2軒が離れているほど引いて、両方が画面に入るようにする
      const lon = diags.reduce((s, d) => s + d.lon, 0) / diags.length;
      const lat = diags.reduce((s, d) => s + d.lat, 0) / diags.length;
      const span = Math.max(
        ...diags.map((d) => Math.hypot((d.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180), (d.lat - lat) * 110950)),
      );
      const back = Math.max(50, span * 1.9);
      const pitch = -48;
      const height = back * Math.tan((-pitch * Math.PI) / 180);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat - back / 110950, diags[0].baseHeight + height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
        duration: 1.5,
      });
      onCompareRef.current?.(diags);
    })();
  // drawFuture は ref だけを使うので、依存に入れなくても古い値を使うことはない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare]);

  // 「建ちうる未来の街」：範囲の中の建物を、ルール上の最大の高さまで、地面から一斉に伸ばして見せる
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    const tileset = viewer.scene.primitives.get(0) as { style?: unknown } | undefined;
    const setCityLook = (on: boolean) => {
      // 未来の街を見ている間は、診断データの点を隠し、今の建物を青みの灰色にしてオレンジを際立たせる
      for (const e of viewer.entities.values) if (e.point) e.show = !on;
      if (tileset && "style" in tileset)
        tileset.style = new Cesium.Cesium3DTileStyle({ color: on ? "color('#d5dae1')" : "color('#f4efe6')" });
    };
    const clear = () => {
      setCityLook(false);
      if (cityTick.current) viewer.scene.preUpdate.removeEventListener(cityTick.current);
      cityTick.current = null;
      if (cityPrimitive.current) viewer.scene.primitives.remove(cityPrimitive.current);
      cityPrimitive.current = null;
    };
    if (!futureCity) {
      clear();
      return;
    }
    let cancelled = false;
    (async () => {
      const city: FutureCity = await (await fetch(futureCity.url)).json();
      if (cancelled) return;
      clear();
      drawFuture([]);
      // 色：今より高くなる分が大きいほど濃いオレンジ（1つの色の濃淡）
      const ramp = ["#F59F6B", "#E8590C", "#B83C0B", "#7A2306"];
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
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(colorOf(b.m - b.h))),
            },
          }),
      );
      const ground = city.buildings.reduce((s, b) => s + b.b, 0) / Math.max(1, city.buildings.length);
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(city.center[0], city.center[1], ground));
      const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
      const scaleAt = (k: number) => {
        const sc = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(1, 1, k));
        return Cesium.Matrix4.multiply(Cesium.Matrix4.multiply(enu, sc, new Cesium.Matrix4()), inv, new Cesium.Matrix4());
      };
      const primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
        modelMatrix: scaleAt(0.02),
        shadows: Cesium.ShadowMode.ENABLED,
        asynchronous: true,
      });
      viewer.scene.primitives.add(primitive);
      cityPrimitive.current = primitive;
      setCityLook(true);
      // 斜め上から、建物の広がり全体を見下ろす（南から北を向く）
      const lons = city.buildings.map((b) => b.f[0][0]);
      const lats = city.buildings.map((b) => b.f[0][1]);
      const extent = Math.max(
        (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos((city.center[1] * Math.PI) / 180),
        (Math.max(...lats) - Math.min(...lats)) * 110950,
      );
      const back = extent * 0.5;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(city.center[0], city.center[1] - back / 110950, ground + back * 0.9),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-40), roll: 0 },
        duration: 2.0,
      });
      // 建物が多いと表示の準備に時間がかかるので、準備ができ、カメラが着いてから伸び始める
      const flyEnd = performance.now() + 2600;
      let start: number | null = null;
      const tick = () => {
        if (start === null) {
          if (!primitive.ready || performance.now() < flyEnd) return;
          start = performance.now() + 300;
        }
        const t = Math.min(1, Math.max(0, (performance.now() - start) / CITY_GROW_MS));
        const ease = 1 - Math.pow(1 - t, 3);
        primitive.modelMatrix = scaleAt(0.02 + 0.98 * ease);
      };
      viewer.scene.preUpdate.addEventListener(tick);
      cityTick.current = tick;
      onFutureCityRef.current?.(city);
    })();
    return () => {
      cancelled = true;
    };
  // drawFuture は ref だけを使うので、依存に入れなくても古い値を使うことはない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [futureCity]);

  // 区全体の予報マップ：練馬区の全戸建てを点で表示（オレンジ＝将来1割以上減りうる家、淡い青＝それ以外）
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    if (!forecastMap) {
      if (forecastPoints.current) viewer.scene.primitives.remove(forecastPoints.current);
      forecastPoints.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const m: ForecastMap = await (await fetch("/data/forecast_points.json")).json();
      if (cancelled) return;
      if (forecastPoints.current) viewer.scene.primitives.remove(forecastPoints.current);
      drawFuture([]);
      for (const e of viewer.entities.values) if (e.point) e.show = false;
      const points = new Cesium.PointPrimitiveCollection();
      const add = (arr: number[], color: string, size: number) => {
        const c = Cesium.Color.fromCssColorString(color);
        for (let i = 0; i < arr.length; i += 3)
          points.add({
            position: Cesium.Cartesian3.fromDegrees(arr[i], arr[i + 1], arr[i + 2]),
            color: c,
            pixelSize: size,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
      };
      add(m.safe, "#b9d3ea", 2);
      add(m.risk, "#e8590c", 6); // 少ないので後から描いて上に重ねる
      viewer.scene.primitives.add(points);
      forecastPoints.current = points;
      // 区全体を、斜め上から見下ろす
      viewer.camera.flyTo({
        // 区の中心（北緯35.747）を、南から60°見下ろす。高さ9km で区の東西（約11km）が入る
        destination: Cesium.Cartesian3.fromDegrees(139.621, 35.747 - 9000 / Math.tan(Math.PI / 3) / 110950, 9000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
        duration: 2.0,
      });
      onForecastMapRef.current?.(m);
    })();
    return () => {
      cancelled = true;
    };
  // drawFuture は ref だけを使うので、依存に入れなくても古い値を使うことはない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastMap]);

  return <div ref={containerRef} className="h-full w-full" />;
}
