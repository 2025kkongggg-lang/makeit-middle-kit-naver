#!/usr/bin/env python3
"""옛 2주차 저장소 — 2026-09-28 부터 makeit-edu/makeit-middle-kit 한 저장소로 합쳤다.

이 저장소는 예전에 이 주소로 설치한 폴더를 새 저장소로 넘겨 주는 길잡이만 한다.
  · 앱/로더.mjs   = 새 저장소 로더를 그대로 (저장소 이름도 새 것).
                    예전 설치의 대본이 이 로더를 부르면 새 저장소의 프로그램·대본(판 4)을 받아 와 폴더 대본을 스스로 새것으로 바꾼다.
  · README.md     = 새 저장소 README 에 안내 한 줄을 붙인 것 (설치 코드도 새 저장소를 가리킨다).
  · docs/index.html = 새 저장소의 네이버 안내서 (docs/naver/index.html).

쓰는 법: python3 앱/빌드.py ../makeit-middle-kit
"""
import sys
from pathlib import Path

W2 = Path(__file__).resolve().parent.parent
W1 = Path(sys.argv[1] if len(sys.argv) > 1 else W2.parent / "makeit-middle-kit").resolve()
if not (W1 / "앱" / "로더.mjs").exists():
    sys.exit(f"새 저장소를 못 찾음: {W1}")

(W2 / "앱/로더.mjs").write_text((W1 / "앱/로더.mjs").read_text(encoding="utf8"), encoding="utf8")
readme = (W1 / "README.md").read_text(encoding="utf8")
안내 = "> **이 저장소는 `makeit-edu/makeit-middle-kit` 로 합쳐졌습니다.** 코덱스는 아래 설치 코드를 그대로 실행하면 됩니다 (새 저장소에서 설치됩니다).\n\n"
first_nl = readme.index("\n") + 1
(W2 / "README.md").write_text(readme[:first_nl] + "\n" + 안내 + readme[first_nl:], encoding="utf8")
(W2 / "docs/index.html").write_text((W1 / "docs/naver/index.html").read_text(encoding="utf8"), encoding="utf8")
print(f"길잡이 갱신: 로더·README·안내서를 {W1.name} 에서 가져옴")
