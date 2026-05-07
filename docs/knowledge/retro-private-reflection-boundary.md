---
title: Retro는 private reflection이다
tags:
  - retro
  - notion
  - reflection
  - private
  - journal
  - 회고
category: knowledge
status: active
applies_to:
  - extensions/retro
  - docs/pilee-history
source:
  - pilee-history:2026-05-01#16
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 5474cf3424f95d56ba2f6ef04f7e7de1dcf9a8e4
related:
  - private-journal-public-doctrine
  - artifact-archive-reopenability
---

## Judgment

Retro는 공개 doctrine을 바로 쓰는 기능이 아니라 private reflection을 다듬고 저장하는 흐름입니다. 회고에는 개인적 서사와 감정, 하루의 맥락이 들어갈 수 있으므로 public knowledge와 같은 sanitization 기준으로 바로 공개하면 안 됩니다.

## Boundary Rule

`/retro`는 불러오기, 대화로 다듬기, private 저장소 반영을 담당합니다. 그 안에서 재사용 가능한 설계 판단이 생겼을 때만 별도로 knowledge 승격을 검토합니다.

## Automation Boundary

회고 자동화나 resolver가 private reflection을 읽을 수는 있지만, 그 결과를 그대로 public doctrine에 옮기지 않습니다. public knowledge로 승격되는 것은 감정·사건·세션 전문이 아니라 반복 가능한 운영 판단입니다. 로컬 로그는 private reflection의 탐색 기록이고, PR은 sanitized 결론의 배포 단위입니다.

## Failure Mode

회고와 knowledge를 같은 문서로 취급하면 둘 다 나빠집니다. 회고는 솔직함을 잃고, knowledge는 현재 운영 기준 대신 일기 문장을 담게 됩니다.
