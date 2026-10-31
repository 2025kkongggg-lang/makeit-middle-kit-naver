import test from "node:test";
import assert from "node:assert/strict";
import {applyArticleImages} from "./article-images.mjs";

const baseHtml = [
  "<!-- wp:paragraph --><p>도입부</p><!-- /wp:paragraph -->",
  "<!-- wp:heading --><h2>첫 번째 핵심</h2><!-- /wp:heading -->",
  "<!-- wp:paragraph --><p>본문 설명</p><!-- /wp:paragraph -->",
  "<!-- wp:heading --><h2>두 번째 핵심</h2><!-- /wp:heading -->",
  "<!-- wp:paragraph --><p>마무리 설명</p><!-- /wp:paragraph -->",
].join("\n\n");

const featured = {
  id: 100,
  sourceUrl: "https://example.com/thumbnail.jpg",
  altText: "대표이미지",
  caption: "대표이미지 캡션",
};
const body = {
  id: 200,
  sourceUrl: "https://example.com/body.jpg",
  altText: "본문 이미지",
  caption: "본문 이미지 캡션",
};

test("대표이미지는 본문에 넣지 않고 본문 이미지만 한 번 삽입한다", () => {
  const result = applyArticleImages({html: baseHtml, featured, body});

  assert.equal(result.featuredMediaId, 100);
  assert.equal(result.bodyMediaId, 200);
  assert.equal(result.html.includes("wp-image-100"), false);
  assert.equal((result.html.match(/wp-image-200/g) || []).length, 1);
  assert.equal(result.bodyImageInserted, true);
});

test("이미지가 모두 없어도 원문을 그대로 반환한다", () => {
  const result = applyArticleImages({html: baseHtml, featured: null, body: null});

  assert.equal(result.featuredMediaId, 0);
  assert.equal(result.bodyMediaId, 0);
  assert.equal(result.bodyImageInserted, false);
  assert.equal(result.html, baseHtml);
});
