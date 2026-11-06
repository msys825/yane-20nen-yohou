#!/bin/bash
# 3分動画の仮編集：場面の録画とスライドをつなぎ、仮のナレーション（Mac の読み上げ）を重ねる
# 使い方（作業用フォルダで）:
#   1. 仮のナレーションを作る（narration_tts.tsv の1行が1場面。読み上げやすい表記にしてある）
#        mkdir -p narr && while IFS=$'\t' read n t; do say -v Kyoko -r 165 -o narr/$n.aiff "$t"; done < narration_tts.tsv
#        （01 だけは -r 172）
#      自分で録音するときは、同じ名前（narr/01.aiff …）で置けばよい
#   2. bash make_rough_cut.sh <録画のフォルダ docs/video_scenes> <スライド画像のフォルダ（render_slides.js の出力）>
#   出力は rough_cut.mp4（1920×1080、H.264、約2分45秒）
set -e
S=$1; SL=$2; N=narr; mkdir -p seg
V="scale=1920:1080:flags=lanczos,fps=30,format=yuv420p"
ENC="-c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -ar 48000 -ac 2"
# 秒をミリ秒にする（adelay は「15.2s」の書き方だと秒として扱われないことがあるため、ミリ秒の数字で渡す）
ms() { awk "BEGIN{printf \"%d\", $1*1000}"; }
# 映像（フィルタ）に、ナレーションを delay 秒後から重ねて、長さ dur の区間をつくる
seg() { out=$1; dur=$2; delay=$(ms $3); narr=$4; shift 4
  ffmpeg -v error -y "$@" -i $N/$narr.aiff -filter_complex "[0:v]$V,tpad=stop_mode=clone:stop_duration=30,trim=duration=$dur,setpts=PTS-STARTPTS[v];[1:a]adelay=${delay}:all=1,apad,atrim=duration=$dur[a]" -map "[v]" -map "[a]" $ENC seg/$out.mp4; }
slide() { out=$1; dur=$2; delay=$3; narr=$4; img=$5
  seg $out $dur $delay $narr -loop 1 -framerate 30 -t $dur -i $SL/$img; }
# 録画の一部を切り出して1本にする（AIの待ち時間を削る）
cut2() { out=$1; f=$2; a1=$3; b1=$4; a2=$5; b2=$6
  ffmpeg -v error -y -i $S/$f.webm -filter_complex "[0:v]trim=$a1:$b1,setpts=PTS-STARTPTS[x];[0:v]trim=$a2:$b2,setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1[v]" -map "[v]" -an -c:v libx264 -crf 16 seg/$out.raw.mp4; }

# 1) そっくりな2軒：「今」（01）→ ボタンでオレンジが伸びる（02）。録画の22秒から（2軒が映ってから）、ボタンはその15.8秒後
#    01 は 172 の速さで読ませると、オレンジが出る前に言い終わる
ffmpeg -v error -y -ss 22 -i $S/01_pair.webm -an -c:v libx264 -crf 16 seg/a.raw.mp4
ffmpeg -v error -y -i seg/a.raw.mp4 -i $N/01.aiff -i $N/02.aiff -filter_complex "[0:v]$V,tpad=stop_mode=clone:stop_duration=30,trim=duration=43.5,setpts=PTS-STARTPTS[v];[1:a]adelay=300:all=1[n1];[2:a]adelay=16400:all=1[n2];[n1][n2]amix=inputs=2:normalize=0,apad,atrim=duration=43.5[a]" -map "[v]" -map "[a]" $ENC seg/01.mp4
# 2) 課題のスライド（03）
slide 02 20 0.6 03 03_problem.png
# 3) 家をクリック（04）→ 冬至の影（05、つまみの部分を少しゆっくりに）
ffmpeg -v error -y -ss 3.5 -to 18.2 -i $S/02_house_and_shadow.webm -an -c:v libx264 -crf 16 seg/c.raw.mp4
seg 03 15 0.4 04 -i seg/c.raw.mp4
ffmpeg -v error -y -ss 18.2 -i $S/02_house_and_shadow.webm -an -vf "setpts=1.4*PTS" -c:v libx264 -crf 16 seg/d.raw.mp4
seg 04 21 0.4 05 -i seg/d.raw.mp4
# 4) AIと損得の相談（06）：入力 → 答え
cut2 e 03_advisor 19 26 38.5 48.7
seg 05 21.5 0.6 06 -i seg/e.raw.mp4
# 5) セカンドオピニオン（07）：ボタン → 答え
cut2 f 04_quote 19 25 38 48.8
seg 06 20 0.6 07 -i seg/f.raw.mp4
# 6) 使ったデータ → これから（08）
ffmpeg -v error -y -loop 1 -framerate 30 -t 7 -i $SL/14_data.png -loop 1 -framerate 30 -t 7.5 -i $SL/15_roadmap.png -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -c:v libx264 -crf 16 seg/g.raw.mp4
seg 07 14.5 0.5 08 -i seg/g.raw.mp4
# 7) まとめ（09）
slide 08 9 0.6 09 16_closing.png

(cd seg && ls 0*.mp4) | sed 's/^/file /' > seg/list.txt
ffmpeg -v error -y -f concat -safe 0 -i seg/list.txt -c copy -movflags +faststart rough_cut.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 rough_cut.mp4
