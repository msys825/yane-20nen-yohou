"""PLATEAU の 3D Tiles（b3dm, Draco 圧縮）から建物の三角形を取り出す"""
from __future__ import annotations

import json
import math
import struct

import DracoPy
import numpy as np
from pyproj import Transformer

_ECEF_TO_PLANE9 = Transformer.from_crs(4978, 6677, always_xy=True)


_COMPONENT = {"BYTE": "b", "UNSIGNED_BYTE": "B", "SHORT": "h", "UNSIGNED_SHORT": "H", "INT": "i",
              "UNSIGNED_INT": "I", "FLOAT": "f", "DOUBLE": "d"}


def read_batch_table(path: str) -> dict:
    """b3dm の属性表。数値の列がバイナリで入っている場合も、リストにして返す"""
    b = open(path, "rb").read()
    _, _, _, ftj, ftb, btj, btb = struct.unpack("<4s6I", b[:28])
    if not btj:
        return {}
    ft = json.loads(b[28:28 + ftj] or b"{}")
    n = ft.get("BATCH_LENGTH", 0)
    bt = json.loads(b[28 + ftj + ftb:28 + ftj + ftb + btj])
    binary = b[28 + ftj + ftb + btj:28 + ftj + ftb + btj + btb]
    for k, v in bt.items():
        if isinstance(v, dict) and "byteOffset" in v:
            bt[k] = list(struct.unpack_from(f"<{n}{_COMPONENT[v['componentType']]}", binary, v["byteOffset"]))
    return bt


def building_triangles(path: str, batch_index: int) -> np.ndarray:
    """指定の建物の三角形 (N,3,3) を平面直角座標系第9系（x=東, y=北, z=楕円体高）で返す"""
    b = open(path, "rb").read()
    _, _, _, ftj, ftb, btj, btb = struct.unpack("<4s6I", b[:28])
    glb = b[28 + ftj + ftb + btj + btb:]
    jl = struct.unpack("<I", glb[12:16])[0]
    gj = json.loads(glb[20:20 + jl])
    bin_ = glb[20 + jl + 8:]
    rtc = np.array(gj["extensions"]["CESIUM_RTC"]["center"])
    out = []
    for mesh in gj["meshes"]:
        for prim in mesh["primitives"]:
            dr = prim["extensions"]["KHR_draco_mesh_compression"]
            bv = gj["bufferViews"][dr["bufferView"]]
            off = bv.get("byteOffset", 0)
            m = DracoPy.decode(bin_[off:off + bv["byteLength"]])
            pts = np.asarray(m.points, dtype=float)
            faces = np.asarray(m.faces, dtype=int)
            bid = next(np.asarray(a["data"]).reshape(-1) for a in m.attributes if a.get("unique_id") == dr["attributes"]["_BATCHID"])
            sel = faces[bid[faces[:, 0]] == batch_index]
            if len(sel) == 0:
                continue
            P = np.c_[pts[:, 0], -pts[:, 2], pts[:, 1]] + rtc  # glTF の y-up を z-up に直して ECEF へ
            X, Y, Z = _ECEF_TO_PLANE9.transform(P[:, 0], P[:, 1], P[:, 2])
            out.append(np.c_[X, Y, Z][sel])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))


def tile_building_triangles(path: str) -> dict[int, np.ndarray]:
    """タイル（b3dm）を1回だけ読み、中のすべての建物の三角形を {建物の番号: (N,3,3)} で返す（多くの建物を扱うとき用）"""
    b = open(path, "rb").read()
    _, _, _, ftj, ftb, btj, btb = struct.unpack("<4s6I", b[:28])
    glb = b[28 + ftj + ftb + btj + btb:]
    jl = struct.unpack("<I", glb[12:16])[0]
    gj = json.loads(glb[20:20 + jl])
    bin_ = glb[20 + jl + 8:]
    rtc = np.array(gj["extensions"]["CESIUM_RTC"]["center"])
    parts: dict[int, list[np.ndarray]] = {}
    for mesh in gj["meshes"]:
        for prim in mesh["primitives"]:
            dr = prim["extensions"]["KHR_draco_mesh_compression"]
            bv = gj["bufferViews"][dr["bufferView"]]
            off = bv.get("byteOffset", 0)
            m = DracoPy.decode(bin_[off:off + bv["byteLength"]])
            pts = np.asarray(m.points, dtype=float)
            faces = np.asarray(m.faces, dtype=int)
            bid = next(np.asarray(a["data"]).reshape(-1) for a in m.attributes if a.get("unique_id") == dr["attributes"]["_BATCHID"])
            P = np.c_[pts[:, 0], -pts[:, 2], pts[:, 1]] + rtc
            X, Y, Z = _ECEF_TO_PLANE9.transform(P[:, 0], P[:, 1], P[:, 2])
            tri = np.c_[X, Y, Z][faces]
            fb = bid[faces[:, 0]]
            order = np.argsort(fb, kind="stable")
            fb, tri = fb[order], tri[order]
            for k, start in zip(*np.unique(fb, return_index=True)):
                end = np.searchsorted(fb, k, side="right")
                parts.setdefault(int(k), []).append(tri[start:end])
    return {k: np.concatenate(v) for k, v in parts.items()}


def roof_faces_from_triangles(tris: np.ndarray) -> list[dict]:
    """LOD2 の三角形から屋根の面を傾き・方位ごとにまとめる（正解データ用）"""
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    a = np.linalg.norm(n, axis=1) / 2
    ok = a > 1e-6
    n = n[ok] / np.linalg.norm(n[ok], axis=1)[:, None]
    a = a[ok]
    zc = tris[ok][:, :, 2].mean(1)
    n[n[:, 2] < 0] *= -1
    # 建物の底面（地面に接する面）は屋根ではないので除く
    m = (n[:, 2] > 0.3) & (zc > tris[:, :, 2].min() + 1.0)
    tilt = np.degrees(np.arccos(np.clip(n[m, 2], -1, 1)))
    az = (np.degrees(np.arctan2(n[m, 0], n[m, 1])) + 360) % 360
    groups: list[dict] = []
    for t, z, ar in sorted(zip(tilt, az, a[m]), key=lambda x: -x[2]):
        for g in groups:
            dz = min(abs(g["azimuth"] - z), 360 - abs(g["azimuth"] - z))
            if abs(g["tilt"] - t) < 4 and (g["tilt"] < 3 or dz < 20):
                g["area_m2"] += ar
                break
        else:
            groups.append({"tilt": float(t), "azimuth": float(z), "area_m2": float(ar)})
    # 傾いた屋根を真上から見た面積が平らな面と同じくらいあれば、平らな面は屋根の外周を表す補助的な面とみなして除く
    flat = [g for g in groups if g["tilt"] < 3]
    sloped_proj = sum(g["area_m2"] * math.cos(math.radians(g["tilt"])) for g in groups if g["tilt"] >= 3)
    if flat and sloped_proj >= 0.7 * sum(g["area_m2"] for g in flat):
        groups = [g for g in groups if g["tilt"] >= 3]
    return sorted(groups, key=lambda g: -g["area_m2"])
