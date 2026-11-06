# データの出典

| ファイル | 内容 | 出典・ライセンス |
|---|---|---|
| irradiance/pvgis_tmy_nerima.json | 練馬区役所付近（35.7356, 139.6517）の標準年の1時間ごとの日射量（水平面全天・法線面直達・水平面散乱） | European Commission JRC, PVGIS 5.3（PVGIS-ERA5, 2005–2023）。開発用。提出前に NEDO METPV-20 への差し替えを検討 |
| irradiance/nedo/mea44132.txt（リポジトリに含めない） | 東京（44132）の平均年の1時間ごとの日射量（水平面全天・直達・散乱） | NEDO 年間時別日射量データベース（METPV-11）。NEDO の利用条件（無断改変・商業目的の複製の禁止）のため、リポジトリと公開アプリには含めず、計算の結果だけを使う。https://www.nedo.go.jp/seika_hyoka/nissharyou.html から「METPV-11データファイル」をダウンロードし、METPV11/年間時別日射量/mea44132.txt をこの場所に置く。ファイルがなければ PVGIS を使う |
