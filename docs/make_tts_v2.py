"""仮のナレーション（Mac の読み上げ Kyoko）を、場面ごとの音声ファイルにする

人の声で録るまでの仮の声。読み間違えやすい言葉を読み方で書き直し、文の切れ目に短い間を入れる。
使い方（作業用フォルダで）: python3 make_tts_v2.py <narration_tts_v2.tsv> <出力フォルダ narr>
"""
import subprocess
import sys
from pathlib import Path

# 読み方の書き直し（画面や台本の文字はそのまま。読み上げだけに使う）
READING = [
    ("家A", "いえエー"), ("家B", "いえビー"),
    ("2万4千棟", "にまんよんせんとう"), ("11万5千軒", "じゅういちまんごせんけん"), ("約2,200軒", "やく、にせんにひゃっけん"),
    ("2軒", "にけん"), ("戸建て", "こだて"), ("沿道", "えんどう"), ("屋根台帳", "やねだいちょう"),
    ("点検商法", "てんけんしょうほう"), ("見積書", "みつもりしょ"), ("見積もり", "みつもり"),
    ("航空レーザー点群", "こうくうレーザーてんぐん"), ("損得", "そんとく"), ("AI", "エーアイ"),
    ("建てられる側", "たてられるがわ"), ("建てる側", "たてるがわ"), ("裏返し", "うらがえし"),
    ("1割", "いちわり"), ("20年", "にじゅうねん"), ("100万円", "ひゃくまんえん"),
]

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for line in src.read_text().splitlines():
    if not line.strip():
        continue
    n, text = line.split("\t", 1)
    for a, b in READING:
        text = text.replace(a, b)
    # 文の終わりに少し長めの間、読点に短い間
    text = text.replace("。", "。[[slnc 280]]").replace("、", "、[[slnc 60]]")
    subprocess.run(["say", "-v", "Kyoko", "-r", "178", "-o", str(out / f"{n}.aiff"), text], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out / f"{n}.aiff")],
                         capture_output=True, text=True).stdout.strip()
    print(n, round(float(dur), 1))
