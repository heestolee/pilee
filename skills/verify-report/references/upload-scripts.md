# Verify Report — project artifact storage 업로드 (upload 모드만)

> **default는 confirm 모드** — 업로드 안 함. 이 문서는 `--upload` 명시 시에만 따라가는 절차.

## 폴더 경로

`{org-or-project}/{repo-or-product}/{ticket-or-run}/`
- ticket/run id는 브랜치명, PR, frame, 또는 사용자 입력에서 추출
- 없으면 브랜치명 slug 사용

## 일반 파일 (< 500KB)

```bash
CONTENT=$(base64 -i .context/work/{workspace}/captures/{filename} | tr -d '\n')
gh api repos/{owner}/{artifact-repo}/contents/{artifact-path}/{filename} \
  -X PUT -f message="upload: verify report for {ticket}" \
  -f content="$CONTENT" -f branch="main"
```

동일 경로에 파일이 이미 존재하면 sha 조회 후 `-f sha="{sha}"` 추가.

## 대용량 파일 (>= 500KB) — JSON payload 방식

CLI 인자 크기 제한 회피:

```bash
B64_FILE=.context/work/{workspace}/captures/_b64.txt
PAYLOAD_FILE=.context/work/{workspace}/captures/_payload.json

base64 -i .context/work/{workspace}/captures/{filename} | tr -d '\n' > "$B64_FILE"

python3 - <<EOF
import json
with open("$B64_FILE") as f:
    content = f.read()
payload = {"message": "upload: ...", "content": content, "branch": "main"}
# 기존 파일 sha 있으면 추가 (없으면 409/422)
# payload["sha"] = "..."
with open("$PAYLOAD_FILE", "w") as f:
    json.dump(payload, f)
EOF

gh api repos/{owner}/{artifact-repo}/contents/{artifact-path}/{filename} \
  -X PUT --input "$PAYLOAD_FILE"

# 정리
rm "$B64_FILE" "$PAYLOAD_FILE"
```

## report.html 업로드 — base64 data URI 임베딩

private repo이므로 `?raw=true` URL은 브라우저 직접 로드 불가. 업로드 전 이미지 base64 임베딩:

```python
import base64
import re
import os

CAPTURES_DIR = ".context/work/{workspace}/captures"
report_path = os.path.join(CAPTURES_DIR, "report.html")

with open(report_path) as f:
    html = f.read()

# 모든 <img src="..."> 찾아서 data URI로 교체
def replace_src(match):
    src = match.group(1)
    if src.startswith("http") or src.startswith("data:"):
        return match.group(0)
    img_path = os.path.join(CAPTURES_DIR, src)
    if not os.path.exists(img_path):
        return match.group(0)
    ext = src.rsplit(".", 1)[-1].lower()
    mime = {"png": "image/png", "gif": "image/gif", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "application/octet-stream")
    with open(img_path, "rb") as imgf:
        b64 = base64.b64encode(imgf.read()).decode()
    return f'<img src="data:{mime};base64,{b64}"'

html = re.sub(r'<img\s+src="([^"]+)"', replace_src, html)

with open(os.path.join(CAPTURES_DIR, "report-embedded.html"), "w") as f:
    f.write(html)
```

업로드 시 `report-embedded.html`을 사용. 단독으로 열어도 이미지 표시됨.

## 이미지 URL 패턴

PR 본문 / context.md 용:
```
https://github.com/{owner}/{artifact-repo}/blob/main/{artifact-path}/{filename}?raw=true
```

## 업로드 한도 체크

```bash
# 업로드 전 모든 파일 크기 확인
du -h .context/work/{workspace}/captures/*.{png,gif} 2>/dev/null

# GitHub Contents API 한도: 100MB per file (실제 권장: 25MB 이하)
```

용량 초과 시 [capture-commands.md](capture-commands.md)의 GIF 압축 옵션 참조.

## update 모드 — 기존 파일 처리

기존 업로드된 파일과 같은 경로면:
1. `gh api repos/{owner}/{artifact-repo}/contents/{path}` 로 sha 조회
2. payload에 `sha` 추가
3. 동일 경로에 PUT (overwrite)

신규 파일은 그냥 PUT (sha 없음).
