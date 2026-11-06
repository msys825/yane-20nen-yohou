// PLATEAU 3D都市モデル（東京都練馬区 2025年度）の配信URL
// 出典：国土交通省 Project PLATEAU（CC BY 4.0）
export const NERIMA_BLDG_LOD2_TILESET =
  "https://assets.cms.plateau.reearth.io/assets/e2/1a7f05-4810-4330-a66d-24956da0040b/13120_nerima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13120_nerima-ku_lod2_no_texture/tileset.json";

// 練馬区役所付近
export const NERIMA_CENTER = { lon: 139.6517, lat: 35.7356 };

export type BuildingInfo = {
  id: string;
  gmlId?: string;
  lon?: number; // 建物の位置（3D Tiles の _x, _y）
  lat?: number;
  usage?: string;
  detailedUsage?: string;
  storeys?: number;
  height?: number;
  zone?: string;
  floorAreaRate?: number;
  coverageRate?: number;
  heightDistrict?: string;
  roofArea?: number;
  address?: string;
  lod?: number;
};

type Attrs = Record<string, unknown>;

// 3D Tiles の属性（attributes）から、診断に使う項目を取り出す
export function toBuildingInfo(props: Attrs): BuildingInfo {
  const a = (props["attributes"] ?? {}) as Attrs;
  const detail = ((a["uro:BuildingDetailAttribute"] as Attrs[] | undefined) ?? [{}])[0] ?? {};
  const kv = (a["uro:KeyValuePairAttribute"] as Attrs[] | undefined) ?? [];
  const kvValue = (key: string) =>
    kv.find((k) => k["uro:key"] === key)?.["uro:codeValue"] as string | undefined;
  const num = (v: unknown) =>
    typeof v === "number" && v !== 9999 && v !== -9999 ? v : undefined;

  return {
    id: String(props["uro:BuildingIDAttribute_uro:buildingID"] ?? props["gml_id"] ?? ""),
    gmlId: props["gml_id"] as string | undefined,
    lon: num(props["_x"]),
    lat: num(props["_y"]),
    usage: props["bldg:usage"] as string | undefined,
    detailedUsage: detail["uro:detailedUsage"] as string | undefined,
    storeys: num(props["bldg:storeysAboveGround"]),
    height: num(props["bldg:measuredHeight"]),
    zone: detail["uro:districtsAndZonesType"] as string | undefined,
    floorAreaRate: num(detail["uro:specifiedFloorAreaRate"]),
    coverageRate: num(detail["uro:specifiedBuildingCoverageRate"]),
    heightDistrict: kvValue("高度地区"),
    roofArea: num(detail["uro:buildingRoofEdgeArea"]),
    address: props["bldg:address"] as string | undefined,
    lod: num(props["_lod"]),
  };
}
