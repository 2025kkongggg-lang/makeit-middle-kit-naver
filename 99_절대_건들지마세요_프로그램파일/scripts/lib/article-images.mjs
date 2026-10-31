function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "article-image";
}

export function buildRolePrompt({role, meta = {}}) {
  const slugTopic = safeSlug(meta.slug).replace(/-/g, " ");
  const scene = /[\u3131-\uD79D]/.test(String(meta.imageScene || ""))
    ? `A calm editorial scene about ${slugTopic}, shown with ordinary objects and places only.`
    : normalizeSpaces(meta.imageScene) || `A calm editorial scene about ${slugTopic}, shown with ordinary objects and places only.`;
  const common = [
    `Scene: ${scene}`,
    "Style: clean, trustworthy, calm educational mood, realistic lighting, simple uncluttered background.",
    "STRICT RULE - NO TEXT AT ALL: no letters, words, numbers, signs, labels, captions, watermarks, logos, UI text, books, documents, screens or readable packaging.",
    "Do not include real person faces, copyrighted characters, brand marks, fake official documents, before-and-after imagery, or clickbait elements.",
  ];

  if (role === "featured") {
    return [
      "Create one original editorial thumbnail image for a blog article.",
      ...common,
      "Composition: landscape 3:2 thumbnail, one centered focal subject, generous clean margins, simple at small size.",
    ].join("\n");
  }
  if (role === "body") {
    return [
      "Create one original editorial body image for a blog article, visually distinct from its thumbnail.",
      ...common,
      "Composition: landscape 3:2 supporting scene, wider environmental view, secondary details, no centered thumbnail layout.",
    ].join("\n");
  }
  throw new Error(`지원하지 않는 이미지 역할입니다: ${role}`);
}

export function mediaFilename({role, slug, extension}) {
  if (role !== "featured" && role !== "body") throw new Error(`지원하지 않는 이미지 역할입니다: ${role}`);
  const suffix = role === "featured" ? "thumbnail" : "body";
  const safeExtension = String(extension || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${safeSlug(slug)}-${suffix}.${safeExtension}`;
}

export function buildBodyImageBlock({media}) {
  const caption = normalizeSpaces(media?.caption);
  const escapedCaption = escapeHtml(caption);
  const escapedAlt = escapeHtml(media?.altText);
  const escapedSrc = escapeHtml(media?.sourceUrl);
  const id = Number(media?.id);
  if (!id || !escapedSrc) throw new Error("본문 이미지 미디어 정보가 올바르지 않습니다.");

  return [
    `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"none","className":"makeit-adsense-body-image"} -->`,
    `<figure class="wp-block-image size-large makeit-adsense-body-image"><img src="${escapedSrc}" alt="${escapedAlt}" class="wp-image-${id}">${caption ? `<figcaption class="wp-element-caption">${escapedCaption}</figcaption>` : ""}</figure>`,
    "<!-- /wp:image -->",
  ].join("\n");
}

export function insertBodyImage(html, imageBlock) {
  const blocks = String(html || "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!imageBlock) return blocks.join("\n\n").trim();
  if (blocks.length === 0) return imageBlock;
  const insertIndex = blocks.length <= 4
    ? Math.min(2, blocks.length)
    : Math.min(Math.max(3, Math.floor(blocks.length / 2)), blocks.length - 1);
  blocks.splice(insertIndex, 0, imageBlock);
  return blocks.join("\n\n").trim();
}

export function contentHasMedia(content, mediaId) {
  const id = Number(mediaId);
  if (!id) return false;
  const html = String(content || "");
  const classPattern = new RegExp(`\\bwp-image-${id}(?!\\d)`);
  const blockIdPattern = new RegExp(`"id"\\s*:\\s*${id}(?!\\d)`);
  return classPattern.test(html) || blockIdPattern.test(html);
}

export function verifyStoredImages({content, featuredMediaId, expectedFeaturedId, expectedBodyId}) {
  const expectedFeatured = Number(expectedFeaturedId || 0);
  const expectedBody = Number(expectedBodyId || 0);
  return {
    featuredImageInserted: Boolean(expectedFeatured && Number(featuredMediaId || 0) === expectedFeatured),
    bodyImageInserted: Boolean(expectedBody && contentHasMedia(content, expectedBody)),
  };
}

export async function prepareArticleImages({generate, upload, title, meta = {}, usdKrw = 0}) {
  const result = {
    featured: null,
    body: null,
    failures: [],
    estimatedUsd: 0,
    estimatedKrw: 0,
  };

  for (const role of ["featured", "body"]) {
    let generatedImage;
    try {
      generatedImage = await generate({
        role,
        title,
        meta,
        usdKrw,
        prompt: buildRolePrompt({role, meta}),
      });
      const estimatedUsd = Number(generatedImage?.estimatedUsd || 0);
      const estimatedKrw = Number(
        generatedImage?.estimatedKrw ?? (estimatedUsd * Number(usdKrw || 0)),
      );
      result.estimatedUsd += estimatedUsd;
      result.estimatedKrw += estimatedKrw;
    } catch (error) {
      result.failures.push({
        role,
        stage: "generate",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    try {
      result[role] = await upload({
        role,
        title,
        meta,
        generatedImage,
        filename: mediaFilename({role, slug: meta.slug, extension: generatedImage.extension}),
      });
    } catch (error) {
      result.failures.push({
        role,
        stage: "upload",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  result.estimatedUsd = Number(result.estimatedUsd.toFixed(6));
  result.estimatedKrw = Number(result.estimatedKrw.toFixed(1));
  return result;
}

export function applyArticleImages({html, featured = null, body = null}) {
  const original = String(html || "").trim();
  const nextHtml = body ? insertBodyImage(original, buildBodyImageBlock({media: body})) : original;
  return {
    html: nextHtml,
    featuredMediaId: Number(featured?.id || 0),
    bodyMediaId: Number(body?.id || 0),
    bodyImageInserted: Boolean(body),
  };
}
