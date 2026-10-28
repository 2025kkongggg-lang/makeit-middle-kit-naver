# PNG Thumbnail Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SVG thumbnails with uploadable PNG thumbnails and randomly choose between photo-led and typography-led templates.

**Architecture:** Extend the Naver image generator so it creates a square PNG thumbnail through the image API, independently of the five 16:9 body images. The selected template is stored in the draft metadata, and failed thumbnail generation omits the thumbnail instead of creating an unsupported SVG file.

**Tech Stack:** Node.js ESM, OpenAI Images API, built-in `node:zlib`, Node test runner.

**Spec:** User-approved thumbnail templates: (1) topic photo background + large title + information boxes; (2) bold typography card + strong contrast + icon.

## Global Constraints

- Generate only PNG files for Naver uploads; never create SVG thumbnails.
- Randomly select one template per draft.
- Preserve the existing five body-image flow and never publish a Naver post.
- If thumbnail creation fails, continue without a thumbnail; do not insert a substitute invalid file.

## Review Focus

- Image API returns RGB or RGBA PNG: body crop accepts both.
- Random selection yields only the two documented templates.
- Thumbnail API failure leaves no `썸네일` block with a missing file.
- Korean title is passed verbatim to the image prompt.
- Existing V5 content contract remains valid with a generated PNG thumbnail.

---

### Task 1: Define and test thumbnail contracts

**Files:**
- Modify: `앱/네이버/글만들기.mjs`
- Modify: `앱/네이버/v5-content-contract.test.mjs`

**Interfaces:**
- Produces: `썸네일템플릿고르기() -> "photo-info" | "bold-card"`
- Produces: `최종썸네일프롬프트(제목, 템플릿) -> string`

- [ ] Write failing tests for template values, PNG thumbnail metadata, and absence of SVG references.
- [ ] Run the test file and verify failures.
- [ ] Implement the minimal template selector and prompt builder.
- [ ] Run the test file and verify it passes.

### Task 2: Generate raster thumbnails and improve PNG handling

**Files:**
- Modify: `앱/네이버/글만들기.mjs`
- Modify: `앱/네이버/v5-content-contract.test.mjs`

**Interfaces:**
- Produces: `썸네일그리기({ 키, 제목, 저장경로 }) -> { 저장경로, 템플릿, 사용량 }`

- [ ] Write failing tests for a `.png` thumbnail block and RGB/RGBA PNG validation.
- [ ] Run the test file and verify failures.
- [ ] Generate a square PNG thumbnail, add it only on success, and retain its template in the draft metadata.
- [ ] Run the test file and verify it passes.

### Task 3: Verify behavior and open a reviewable change

**Files:**
- Modify: `앱/네이버/글만들기.mjs`
- Modify: `앱/네이버/v5-content-contract.test.mjs`

- [ ] Run the full Naver contract test.
- [ ] Inspect the change to verify no SVG thumbnail path remains.
- [ ] Create a pull request for review and merge only after verification.
