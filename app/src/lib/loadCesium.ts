import type * as CesiumNS from "cesium";

export type Cesium = typeof CesiumNS;

declare global {
  interface Window {
    Cesium?: Cesium;
    CESIUM_BASE_URL?: string;
  }
}

let loading: Promise<Cesium> | null = null;

// public/cesium/Cesium.js を script タグで読み込み、window.Cesium を返す
export function loadCesium(): Promise<Cesium> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (loading) return loading;

  window.CESIUM_BASE_URL = "/cesium";
  loading = new Promise<Cesium>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/cesium/Widgets/widgets.css";
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium が読み込めませんでした")));
    script.onerror = () => reject(new Error("Cesium.js の読み込みに失敗しました"));
    document.head.appendChild(script);
  });
  return loading;
}
