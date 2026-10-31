import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRolePrompt,
  mediaFilename,
  buildBodyImageBlock,
  insertBodyImage,
  contentHasMedia,
} from "./article-images.mjs";

const meta = {
  slug: "project-schedule-guide",
  imageScene: "A calm desk with a blank calendar and neutral planning tools.",
  focusKeyword: "프로젝트 일정",
  featuredImageAlt: "프로젝트 일정 대표 이미지",
  featuredImageCaption: "프로젝트 일정 핵심 정리",
};

test("대표이미지와 본문 이미지는 서로 다른 프롬프트와 파일명을 사용한다", () => {
  const featuredPrompt = buildRolePrompt({role: "featured", meta});
  const bodyPrompt = buildRolePrompt({role: "body", meta});

  assert.notEqual(featuredPrompt, bodyPrompt);
  assert.match(featuredPrompt, /thumbnail/i);
  assert.match(bodyPrompt, /body image/i);
  assert.equal(mediaFilename({role: "featured", slug: meta.slug, extension: "jpg"}), "project-schedule-guide-thumbnail.jpg");
  assert.equal(mediaFilename({role: "body", slug: meta.slug, extension: "jpg"}), "project-schedule-guide-body.jpg");
});

test("본문 이미지 블록은 본문 중간에 한 번 삽입되고 미디어 ID로 확인된다", () => {
  const media = {
    id: 42,
    sourceUrl: "https://example.com/body.jpg",
    altText: "프로젝트 일정 본문 이미지",
    caption: "프로젝트 일정의 실행 단계를 보여주는 이미지입니다.",
  };
  const html = [
    "<!-- wp:paragraph --><p>첫 문단</p><!-- /wp:paragraph -->",
    "<!-- wp:heading --><h2>핵심 단계</h2><!-- /wp:heading -->",
    "<!-- wp:paragraph --><p>둘째 문단</p><!-- /wp:paragraph -->",
    "<!-- wp:paragraph --><p>셋째 문단</p><!-- /wp:paragraph -->",
  ].join("\n\n");

  const block = buildBodyImageBlock({media});
  const result = insertBodyImage(html, block);

  assert.equal(contentHasMedia(result, media.id), true);
  assert.equal((result.match(/wp-image-42/g) || []).length, 1);
  assert.equal(contentHasMedia(result, 99), false);
  assert.match(result, /makeit-adsense-body-image/);
});
