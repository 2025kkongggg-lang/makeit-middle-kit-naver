import test from "node:test";
import assert from "node:assert/strict";
import {prepareArticleImages} from "./article-images.mjs";

const title = "프로젝트 일정 관리 방법";
const meta = {slug: "project-schedule-guide", imageScene: "A quiet planning desk."};

function successfulGenerate({role}) {
  return Promise.resolve({
    role,
    extension: "jpg",
    estimatedUsd: role === "featured" ? 0.006 : 0.007,
    estimatedKrw: role === "featured" ? 9.3 : 10.8,
  });
}

function successfulUpload({role}) {
  return Promise.resolve({
    id: role === "featured" ? 101 : 202,
    sourceUrl: `https://example.com/${role}.jpg`,
    altText: `${role} alt`,
    caption: `${role} caption`,
  });
}

test("대표이미지와 본문 이미지가 모두 성공하면 서로 다른 미디어와 합산 비용을 반환한다", async () => {
  const result = await prepareArticleImages({
    title,
    meta,
    usdKrw: 1543,
    generate: successfulGenerate,
    upload: successfulUpload,
  });

  assert.equal(result.featured.id, 101);
  assert.equal(result.body.id, 202);
  assert.notEqual(result.featured.id, result.body.id);
  assert.deepEqual(result.failures, []);
  assert.equal(result.estimatedUsd, 0.013);
  assert.equal(result.estimatedKrw, 20.1);
});

test("대표이미지 생성이 실패해도 본문 이미지를 만든다", async () => {
  const result = await prepareArticleImages({
    title,
    meta,
    usdKrw: 1543,
    generate: ({role}) => role === "featured" ? Promise.reject(new Error("featured failed")) : successfulGenerate({role}),
    upload: successfulUpload,
  });

  assert.equal(result.featured, null);
  assert.equal(result.body.id, 202);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {role: "featured", stage: "generate", message: "featured failed"});
  assert.equal(result.estimatedUsd, 0.007);
});

test("본문 이미지 업로드가 실패해도 대표이미지를 유지하고 생성 비용은 계산한다", async () => {
  const result = await prepareArticleImages({
    title,
    meta,
    usdKrw: 1543,
    generate: successfulGenerate,
    upload: ({role}) => role === "body" ? Promise.reject(new Error("body upload failed")) : successfulUpload({role}),
  });

  assert.equal(result.featured.id, 101);
  assert.equal(result.body, null);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {role: "body", stage: "upload", message: "body upload failed"});
  assert.equal(result.estimatedUsd, 0.013);
});

test("두 이미지 생성이 모두 실패해도 결과를 반환한다", async () => {
  const result = await prepareArticleImages({
    title,
    meta,
    usdKrw: 1543,
    generate: ({role}) => Promise.reject(new Error(`${role} failed`)),
    upload: successfulUpload,
  });

  assert.equal(result.featured, null);
  assert.equal(result.body, null);
  assert.equal(result.failures.length, 2);
  assert.equal(result.estimatedUsd, 0);
  assert.equal(result.estimatedKrw, 0);
});
