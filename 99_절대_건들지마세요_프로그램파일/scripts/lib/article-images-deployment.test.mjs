import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const programRoot = dirname(dirname(here));
const repositoryRoot = dirname(programRoot);

test("원격 로더 목록에 승인글 이미지 helper가 포함된다", async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "앱", "목록.json"), "utf8"));
  assert.equal(
    manifest.파일.includes("99_절대_건들지마세요_프로그램파일/scripts/lib/article-images.mjs"),
    true,
  );
});

test("승인글 생성기는 이미지 분리 helper를 실제로 사용한다", async () => {
  const source = await readFile(join(programRoot, "scripts", "adsense-create-drafts.mjs"), "utf8");
  assert.match(source, /prepareArticleImages/);
  assert.match(source, /applyArticleImages/);
  assert.match(source, /featuredImageInserted/);
  assert.match(source, /bodyImageInserted/);
});
