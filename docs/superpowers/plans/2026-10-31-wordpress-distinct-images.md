# WordPress Distinct Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워드프레스 승인글마다 서로 다른 대표이미지 1장과 본문 이미지 1장을 만들되 이미지 실패 시에도 임시글을 저장한다.

**Architecture:** 이미지 역할별 프롬프트·미디어 정보·본문 삽입 규칙을 작은 순수 함수 모듈로 분리해 테스트한다. 기존 승인글 생성기는 두 이미지를 독립적으로 생성·업로드하고 성공한 결과만 임시글 payload와 비용 합계에 반영한다.

**Tech Stack:** Node.js ESM, `node:test`, WordPress REST API, OpenAI Images API

**Spec:** `docs/superpowers/specs/2026-10-31-wordpress-distinct-images-design.md`

## Global Constraints

- 대표이미지는 워드프레스 대표이미지로만 사용하고 본문 HTML에 넣지 않는다.
- 본문 이미지는 대표이미지와 다른 요청·파일명·미디어 ID를 사용해 본문 중간에 한 번 넣는다.
- 이미지 생성 또는 업로드 실패는 글 임시저장을 막지 않는다.
- 기존 임시글은 수정하지 않는다.
- 공개 발행은 하지 않는다.

## Review Focus

- 대표이미지만 성공한 경우: 대표이미지는 연결되고 본문에는 이미지가 없어야 한다.
- 본문 이미지만 성공한 경우: 대표이미지 없이 본문 이미지 한 장이 저장돼야 한다.
- 두 이미지가 모두 실패한 경우: 이미지 없이 임시글이 저장돼야 한다.
- 두 이미지가 모두 성공한 경우: 서로 다른 미디어 ID를 사용하고 대표이미지 ID가 본문에 없어야 한다.
- 비용 집계: 성공한 이미지 생성 비용만 더하고 실패한 이미지 비용은 더하지 않아야 한다.

---

### Task 1: 이미지 역할과 본문 삽입 규칙

**Files:**
- Create: `99_절대_건들지마세요_프로그램파일/scripts/lib/article-images.mjs`
- Create: `99_절대_건들지마세요_프로그램파일/scripts/lib/article-images.test.mjs`

**Interfaces:**
- Produces: `buildRolePrompt({role, meta})`, `mediaFilename({role, slug, extension})`, `buildBodyImageBlock({media})`, `insertBodyImage(html, block)`, `contentHasMedia(html, mediaId)`

- [ ] Write failing tests for distinct role prompts and filenames, body insertion, and media detection.
- [ ] Run the focused test and confirm it fails because the module does not exist.
- [ ] Implement the minimum pure helper module.
- [ ] Run the focused test and confirm it passes.

### Task 2: 두 이미지의 독립 생성과 실패 허용

**Files:**
- Modify: `99_절대_건들지마세요_프로그램파일/scripts/adsense-create-drafts.mjs`
- Create: `99_절대_건들지마세요_프로그램파일/scripts/lib/article-image-workflow.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `prepareArticleImages({generate, upload, title, meta, usdKrw})` returning `{featured, body, failures, cost}`.

- [ ] Write failing tests for both success, each partial failure, both failure, and cost aggregation.
- [ ] Run the focused test and confirm it fails before implementation.
- [ ] Implement independent per-role generation/upload with failure capture.
- [ ] Run the focused test and confirm it passes.

### Task 3: 워드프레스 임시글 생성기에 연결

**Files:**
- Modify: `99_절대_건들지마세요_프로그램파일/scripts/adsense-create-drafts.mjs`

**Interfaces:**
- Consumes: Task 2 workflow.
- Produces: result fields for featured/body insertion and failures.

- [ ] Add a failing integration-style test for featured-only assignment and one body insertion.
- [ ] Replace shared-image reuse with the independent image workflow.
- [ ] Preserve draft creation for all image-failure combinations.
- [ ] Update cost and result records to use only successful images.
- [ ] Run the focused and full `node --test` suites.

### Task 4: 전체 검증

- [ ] Run the complete `node --test` suite with zero failures.
- [ ] Review the diff for public publishing, existing-post mutation, and secret output.
