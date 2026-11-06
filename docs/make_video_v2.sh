#!/bin/bash
# 3分動画 v2 の仮編集（台本：docs/video_script_v2.md、ナレーション：docs/narration_tts_v2.tsv）
# 使い方（作業用フォルダで）:
#   1. 仮のナレーション：python3 make_tts_v2.py narration_tts_v2.tsv narr
#      自分で録音するときは、同じ名前（narr/01.aiff 〜 11.aiff）で置けばよい
#   2. bash make_video_v2.sh <録画のフォルダ docs/video_scenes> <スライド画像のフォルダ（render_slides.js の出力）>
#   出力は video_v2.mp4（1920×1080、H.264、約2分58秒）
set -e
S=$1; SL=$2; N=narr; mkdir -p seg2
V="scale=1920:1080:flags=lanczos,fps=30,format=yuv420p"
ENC="-c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -ar 48000 -ac 2"
RAW="-an -c:v libx264 -crf 16"
ms() { awk "BEGIN{printf \"%d\", $1*1000}"; }
# 映像に、ナレーションを delay 秒後から重ねて、長さ dur の区間をつくる
seg() { out=$1; dur=$2; delay=$(ms $3); narr=$4; shift 4
  ffmpeg -v error -y "$@" -i $N/$narr.aiff -filter_complex "[0:v]$V,tpad=stop_mode=clone:stop_duration=30,trim=duration=$dur,setpts=PTS-STARTPTS[v];[1:a]adelay=${delay}:all=1,apad,atrim=duration=$dur[a]" -map "[v]" -map "[a]" $ENC seg2/$out.mp4; }
slide() { out=$1; dur=$2; delay=$3; narr=$4; img=$5
  seg $out $dur $delay $narr -loop 1 -framerate 30 -t $dur -i $SL/$img; }
# 録画の2か所を切り出して1本にする（AIの待ち時間などを削る）
cut2() { out=$1; f=$2; a1=$3; b1=$4; a2=$5; b2=$6
  ffmpeg -v error -y -i $S/$f.webm -filter_complex "[0:v]trim=$a1:$b1,setpts=PTS-STARTPTS[x];[0:v]trim=$a2:$b2,setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[v]" -map "[v]" $RAW seg2/$out.raw.mp4; }

# 1) 区全体がオレンジに伸びる（ボタン → 区全体へ → 伸びる）。少しゆっくり再生
ffmpeg -v error -y -ss 16.5 -to 27 -i $S/00_city.webm -vf "setpts=1.5*PTS" $RAW seg2/a.raw.mp4
seg 01 16 0.4 01 -i seg2/a.raw.mp4
# 2) 北町の新しい大通りへ近づく
ffmpeg -v error -y -ss 27 -i $S/00_city.webm $RAW seg2/b.raw.mp4
seg 02 11 0.3 02 -i seg2/b.raw.mp4
# 3) 北町の2軒：今（6秒）→ ボタンでオレンジが伸びる
cut2 c 01_pair 22 28 37 55
seg 03 24 0.3 03 -i seg2/c.raw.mp4
# 4) 課題　5) 切り口
slide 04 13 0.5 04 04_problem.png
slide 05 17 0.5 05 06_flip.png
# 6) 区全体の予報マップ（全戸建ての点、8秒＋移動）→ 北町の大通り沿いの家をクリックして予報を見る
cut2 f 06_forecast 18 29.5 33 41.3
seg 06 20 0.4 06 -i seg2/f.raw.mp4
# 7) 詳しい診断：冬至の影（8秒）→ AIとの相談（14秒）
ffmpeg -v error -y -ss 18.2 -to 26.2 -i $S/02_house_and_shadow.webm $RAW seg2/g1.raw.mp4
cut2 g2 03_advisor 19 25 38.5 46.5
ffmpeg -v error -y -i seg2/g1.raw.mp4 -i seg2/g2.raw.mp4 -filter_complex "[0:v]$V[x];[1:v]$V[y];[x][y]concat=n=2:v=1[v]" -map "[v]" $RAW seg2/g.raw.mp4
seg 07 22 0.4 07 -i seg2/g.raw.mp4
# 8) 見積書のチェック
cut2 h 04_quote 19 25 38 46
seg 08 14 0.4 08 -i seg2/h.raw.mp4
# 9) 答え合わせ　10) 続け方　11) まとめ
slide 09 15 0.3 09 13_pv-check.png
slide 10 16.6 0.3 10 17_business.png
slide 11 9 0.8 11 20_closing.png

(cd seg2 && ls 0*.mp4 && ls 1*.mp4) | sed 's/^/file /' > seg2/list.txt
ffmpeg -v error -y -f concat -safe 0 -i seg2/list.txt -c copy -movflags +faststart video_v2.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 video_v2.mp4
