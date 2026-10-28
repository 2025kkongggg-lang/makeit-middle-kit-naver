import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { V5구성점검, 글자썸네일SVG, PNG를16대9로자르기, 소제목표식제거 } from "./글만들기.mjs";
import { 임시저장완료문제 } from "../네이버.mjs";
import { 링크단축키, 링크제목선택키 } from "./naver-typing.mjs";

const 태그 = Array.from({ length: 10 }, (_, i) => `#태그${i + 1}`);
const 사진 = Array.from({ length: 5 }, (_, i) => ({ 종류: "사진", 역할: "본문", 파일: `body-${i + 1}.png`, 비율: "16:9" }));

test("V5 원고는 1:1 글자 썸네일, 본문 이미지 5장, 태그와 검증된 내부링크를 모두 갖춰야 한다", () => {
  const 점검 = V5구성점검({
    블록: [
      { 종류: "썸네일", 파일: "thumbnail.svg", 비율: "1:1", 글자전용: true },
      ...사진,
      { 종류: "내부링크", URL: "https://blog.naver.com/example/123", 검증됨: true },
      { 종류: "태그", 태그 },
    ],
  });
  assert.deepEqual(점검, { 통과: true, 누락: [] });
});

test("예전 3장 사진 원고는 V5 완료로 처리하지 않는다", () => {
  const 점검 = V5구성점검({ 블록: 사진.slice(0, 3) });
  assert.equal(점검.통과, false);
  assert.deepEqual(점검.누락, ["1:1 글자 썸네일", "본문 16:9 이미지 5장", "태그 10~15개", "검증된 내부링크"]);
});

test("소제목에 붙은 내부 표식은 네이버에 쓰기 전에 제거한다", () => {
  const 원고 = 소제목표식제거({ 블록: [{ 종류: "소제목", 글: "[소제목] 신청 방법과 준비 서류" }] });
  assert.equal(원고.블록[0].글, "신청 방법과 준비 서류");
});

test("내부링크가 없더라도 글 본문 임시저장은 완료로 처리한다", () => {
  assert.deepEqual(임시저장완료문제(["검증된 내부링크를 찾지 못했어요"]), []);
});

test("윈도우 네이버 편집기에서는 Ctrl+K로 내부링크를 만든다", () => {
  assert.equal(링크단축키("Win32"), "ctrl+k");
  assert.equal(링크단축키("MacIntel"), "super+k");
  assert.equal(링크제목선택키("Win32"), "shift+home");
  assert.equal(링크제목선택키("MacIntel"), "super+shift+arrowleft");
});

test("썸네일은 1:1 SVG 안에 제목 글자만 넣는다", () => {
  const svg = 글자썸네일SVG("장수축하금 지원대상 쉽게 확인하기");
  assert.match(svg, /width="1080" height="1080"/);
  assert.match(svg, /장수축하금/);
  assert.doesNotMatch(svg, /<image\b/i);
});

function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const length = Buffer.alloc(4); const crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }

test("가로 PNG를 정확히 16:9로 중앙 자르기한다", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "v5-crop-"));
  const file = path.join(folder, "landscape.png");
  const width = 16, height = 12, ihdr = Buffer.alloc(13), rows = Buffer.alloc((width * 4 + 1) * height);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  await writeFile(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
  await PNG를16대9로자르기(file);
  const png = await readFile(file);
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 9);
  await rm(folder, { recursive: true, force: true });
});
