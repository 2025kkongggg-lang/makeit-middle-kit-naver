// 글만들기.mjs — OpenAI API 로 원고(JSON)와 사진을 만들어 01_원고넣는곳 / 02_사진넣는곳 에 넣는다.
//
//   앱 판: 로더가 GitHub 에서 임시 폴더로 받아 오고, 앱/네이버.mjs 가 부른다.
//   await 글.만들기({ 키: "sk-...", 키워드: "…", 저장폴더: "<수강생 폴더>/네이버 승인글/03_쓴글/날짜_키워드" });
//
// 원칙
//   · 벤치마크 글의 문장은 절대 그대로 쓰지 않는다. 섹션 흐름 · 표 구성 · 사진 배치만 가져온다.
//   · 사실(제도 이름, 금액, 신청처)은 벤치마크에서 정리해 넘긴 '사실 요약' 안에서만 쓴다. 지어내지 않는다.
//   · 사진은 정사각형 파스텔 일러스트. 사람이 들어가면 얼굴이 안 보이게(뒷모습·옆모습).
//   · 사진에는 어떤 언어의 글자도 넣지 않는다 (2026-09-21 진현님 지시). 그래서 글 모델이 준 장면 묘사에서 한글을 지우고,
//     최종 그림 프롬프트는 이 파일의 최종그림프롬프트() 가 만든다. 글 모델에게 맡기지 않는다.
//   · process 전역을 쓰지 않는다 (Codex REPL 에서도 돌아야 한다).

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync, deflateSync } from "node:zlib";

// 고칠 때마다 올린다 (앱/배포.sh 가 커밋에 고정해 배포한다).
export const 버전 = "2026-10-27a";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 프로젝트 = path.resolve(여기, "..");

// 2026-09-23 진현님: 글 1개 50원 이하 (승인글처럼). 예전 gpt-5.2 + gpt-image-2 보통 화질은 약 390원이었고 그중 사진 3장이 85%.
// 그래서 글은 승인글과 같은 gpt-5.4-mini. 사진은 진현님 결정으로 한 단계 위 gpt-image-2 저화질 (장당 약 10원, 1-mini 저화질은 약 4원이지만 품질 차이가 큼).
// 글 1개 약 64원 (글 약 33원 + 사진 3장 약 31원, 2026-09-23 실측).
const 글모델 = "gpt-5.4-mini";
const 그림모델 = "gpt-image-2";
const 그림화질 = "low";

async function 오픈AI(키, 경로, body) {
  const r = await fetch("https://api.openai.com/v1" + 경로, {
    method: "POST",
    headers: { Authorization: `Bearer ${키}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${경로} ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// 원고 JSON 의 형식 (naver-typing.mjs 가 읽는 그대로) + 사진 블록에 '프롬프트' 를 더 받는다
const 원고형식 = {
  type: "object",
  additionalProperties: false,
  properties: {
    제목: { type: "string" },
    블록: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          종류: { type: "string", enum: ["문단", "소제목", "인용구", "표", "구분선", "사진"] },
          글: { type: "array", items: { type: "string" }, description: "문단은 줄 배열, 소제목·인용구는 한 줄짜리 배열, 나머지는 빈 배열" },
          칸: { type: "array", items: { type: "string" }, description: "표만. 3열 기준으로 왼쪽→오른쪽, 위→아래. 최대 9칸. 나머지는 빈 배열" },
          프롬프트: { type: "string", description: "사진만. 그릴 장면을 영어로 1~2문장 묘사 (사물·장소·상황·분위기만, 글자가 나올 장면 금지). 나머지는 빈 문자열" },
        },
        required: ["종류", "글", "칸", "프롬프트"],
      },
    },
  },
  required: ["제목", "블록"],
};

// 조사 결과는 원고를 쓰기 전에만 사용한다. 글 본문에 확인하지 못한 수치나
// 조건을 그럴듯하게 채워 넣지 않도록, 출처와 검증 필요 항목을 분리해 둔다.
const 조사형식 = {
  type: "object",
  additionalProperties: false,
  properties: {
    핵심질문: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
    확인된사실: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      항목: { type: "string" }, 내용: { type: "string" }, 출처명: { type: "string" }, 출처URL: { type: "string" },
    }, required: ["항목", "내용", "출처명", "출처URL"] } },
    검증필요: { type: "array", items: { type: "string" } },
    지역사업여부: { type: "string" },
    공식신청경로: { type: "string" },
  },
  required: ["핵심질문", "확인된사실", "검증필요", "지역사업여부", "공식신청경로"],
};

function 응답텍스트(응답) {
  const 본문 = (응답.output || []).flatMap((o) => o.content || []).find((c) => c.type === "output_text");
  if (!본문) throw new Error("글 모델이 본문을 안 돌려줌: " + JSON.stringify(응답).slice(0, 300));
  return 본문.text;
}
function 응답JSON(응답) { return JSON.parse(응답텍스트(응답)); }

async function 공식자료조사({ 키, 키워드, 벤치마크 }) {
  const 주제 = 키워드 || 벤치마크?.원문제목 || "정보성 블로그 주제";
  const 질문 = `제목·키워드: ${주제}\n\n이 주제로 네이버 정보성 글을 쓰기 전 공식 자료만 조사해라. 정부 부처·지자체·공공기관·공식 사업 공고를 우선한다. 정확한 사업명, 현재 기준연도·시행 여부, 대상·금액·기간·신청 방법·서류·예외·제외 대상을 확인한다. 전국 제도와 지역 사업을 구분한다. 과거 기준은 현재 기준처럼 쓰지 않는다. 공식 출처로 확인되지 않은 내용은 확인된사실에 넣지 말고 검증필요에 넣는다. 독자가 가장 궁금해할 질문을 정확히 5개로 정한다.`;
  try {
    const r = await 오픈AI(키, "/responses", {
      model: 글모델,
      tools: [{ type: "web_search_preview" }],
      input: [{ role: "developer", content: "검색 결과 중 공식 기관 자료만 사실 근거로 사용하라. 검색을 할 수 없거나 공식 근거가 부족하면 추측하지 말고 검증필요에 적어라." }, { role: "user", content: 질문 }],
      text: { format: { type: "json_schema", name: "official_research", schema: 조사형식, strict: true } },
      reasoning: { effort: "low" },
    });
    return { 조사: 응답JSON(r), 사용량: { model: 글모델, input_tokens: r.usage?.input_tokens || 0, output_tokens: r.usage?.output_tokens || 0 } };
  } catch (e) {
    // 인터넷 검색 도구를 쓸 수 없는 환경에서는 최신 정보를 본 것처럼 쓰지 않는다.
    return { 조사: { 핵심질문: ["정확한 사업명은 무엇인가요?", "누가 신청할 수 있나요?", "금액·기간 기준은 무엇인가요?", "어떻게 신청하나요?", "어떤 예외를 확인해야 하나요?"], 확인된사실: [], 검증필요: ["공식 자료 검색을 사용할 수 없어 현재 기준·금액·신청 기간을 검증하지 못했습니다."], 지역사업여부: "공식 자료 확인 필요", 공식신청경로: "공식 기관 웹사이트에서 확인 필요" }, 사용량: null };
  }
}

function 품질문제(원고) {
  const 블록 = 원고?.블록 || [];
  const 소제목 = 블록.filter((b) => b.종류 === "소제목");
  const 문단 = 블록.filter((b) => b.종류 === "문단").flatMap((b) => b.글 || []);
  const 정규화 = 문단.map((x) => String(x).replace(/\s+/g, "").replace(/[,.!?·]/g, ""));
  const 중복 = 정규화.some((x, i) => x.length > 35 && 정규화.indexOf(x) !== i);
  const 문제 = [];
  if (소제목.length !== 5) 문제.push("소제목이 정확히 5개가 아닙니다");
  if (소제목.some((b) => !String((b.글 || [])[0] || "").startsWith("[소제목]"))) 문제.push("소제목 표시가 빠졌습니다");
  if (중복) 문제.push("같은 문장이 반복됩니다");
  return 문제;
}

// 네이버 블로그 글 주소를 주면 뼈대(제목·인용구 제목·표·사진 개수·문단 요지)를 뽑는다. 모바일 페이지가 파싱하기 쉽다.
export async function 벤치마크가져오기(주소) {
  const m = /blog\.naver\.com\/([^/?#]+)\/(\d+)/.exec(주소) || /blogId=([^&]+).*logNo=(\d+)/.exec(주소);
  if (!m) throw new Error("네이버 블로그 글 주소가 아닙니다: " + 주소);
  const r = await fetch(`https://m.blog.naver.com/${m[1]}/${m[2]}`, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`벤치마크 글을 못 읽음: HTTP ${r.status}`);
  const h = await r.text();
  const 풀기 = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|​/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const 제목 = 풀기((/<title>(.*?)<\/title>/s.exec(h) || [, ""])[1]).replace(/\s*:\s*네이버 블로그$/, "");
  const 컴포넌트 = [...h.matchAll(/<div class="se-component se-([a-zA-Z]+)/g)].map((x) => x[1]).filter((x) => x !== "documentTitle");
  const 인용구 = [...h.matchAll(/<div class="se-component se-quotation.*?<\/div>\s*<\/div>\s*<\/div>/gs)].map((x) => 풀기(x[0]).slice(0, 60)).filter(Boolean);
  const 표들 = [...h.matchAll(/<div class="se-component se-table.*?<\/table>/gs)].map((t) => [...t[0].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => 풀기(c[1])));
  const 문단 = [...h.matchAll(/<(?:p|span) class="se-text-paragraph[^"]*"[^>]*>(.*?)<\/(?:p|span)>/gs)].map((x) => 풀기(x[1])).filter((x) => x.length > 15);
  // 도입부(첫 인용구 제목이 나오기 전까지의 본문 문단) — 후킹을 참고하려고 따로 뽑는다
  const 첫인용 = h.search(/<div class="se-component se-quotation/);
  const 앞부분 = 첫인용 > 0 ? h.slice(0, 첫인용) : h.slice(0, Math.floor(h.length / 4));
  const 도입부 = [...앞부분.matchAll(/<(?:p|span) class="se-text-paragraph[^"]*"[^>]*>(.*?)<\/(?:p|span)>/gs)]
    .map((x) => 풀기(x[1])).filter((x) => x.length > 8 && x !== 제목).slice(0, 6);
  return {
    출처: 주소, 원문제목: 제목,
    도입부_후킹참고: 도입부,
    컴포넌트순서: 컴포넌트,
    섹션순서_인용구제목: 인용구,
    표: 표들.filter((t) => t.length >= 6).map((t) => t.slice(0, 24)),
    사진수: 컴포넌트.filter((c) => c === "image").length,
    // 문장을 베끼지 않도록 '요지' 로만 넘긴다: 문단 앞 80자
    문단요지: 문단.slice(0, 40).map((p) => p.slice(0, 80)),
  };
}

export async function 원고쓰기({ 키, 벤치마크, 키워드, 사진수 = 5 }) {
  const 조사결과 = await 공식자료조사({ 키, 키워드, 벤치마크 });
  const 조사 = 조사결과.조사;
  const 쓴돈 = 조사결과.사용량 ? [조사결과.사용량] : [];
  const 뼈대설명 = 벤치마크
    ? `아래 '벤치마크 구조' 는 참고할 글의 뼈대다. 섹션 순서와 표 · 사진 배치는 그대로 따르되, 문장은 전부 새로 써라.
벤치마크 글의 문장을 기억하고 있더라도 절대 그대로 옮기지 마라. '문단요지' 는 어떤 내용을 다뤘는지 알기 위한 것이지 베낄 문장이 아니다. 제목도 새로 짓되 핵심 키워드는 유지한다.
사실(제도 이름, 금액, 조건, 신청처)은 아래 공식 조사에서 확인된 것만 쓴다. 없는 수치는 만들지 않는다.`
    : `주제 키워드: "${키워드}". 이 키워드로 검색해 들어온 독자가 궁금해할 것을 순서대로 푼다.
소제목은 정확히 5개, 필요한 경우에만 비교 표 1개를 넣는다. 확인된 공식 사실은 아래 조사 결과 안에서만 쓴다.`;
  const 후킹규칙 = `
[가장 중요: 첫 문단(후킹)]
- 첫 문단은 딱 3줄. 이 3줄이 글의 성패를 가른다.
  1줄: 독자의 지금 상황·걱정을 정확히 찌른다 (예: "부모님 생신이 두 달 남았는데 아직 아무것도 안 알아보셨다면").
  2줄: 이 글을 끝까지 읽으면 무엇을 얻는지 한 문장으로 요약한다 (대상·금액·방법 같은 핵심을 구체어로).
  3줄: 지금 바로 확인해야 하는 이유와 행동 유도 (기한·놓치면 손해·1분이면 확인 같은 말로).
- 3줄 사이에는 빈 줄("") 을 넣지 않는다. 그 다음 문단부터 평소대로.
${벤치마크 && 벤치마크.도입부_후킹참고 && 벤치마크.도입부_후킹참고.length ? `- '도입부_후킹참고' 는 참고 글의 도입부다. 어떤 순서로 독자를 끌어당기는지, 어느 정도 세게 말하는지, 무엇을 약속하는지를 배워라. 그 강도와 구조를 그대로 살리되 문장·표현·예시는 전부 새로 써라. 한 문장이라도 그대로 옮기면 실패다.` : ""}`;
  const 지시 = `당신은 한국 네이버 블로그 정보성 글을 쓰는 작가다. 존댓말, 짧은 문장, 40~60대 독자가 읽기 쉬운 말투.
${뼈대설명}
${후킹규칙}

사실·문체 규칙
- 아래 '공식 조사'의 확인된사실만 금액·기간·연령·소득·서류·기관명처럼 단정적인 사실로 쓴다. 없는 수치·날짜·조건은 절대 만들지 않는다.
- 검증필요 항목은 최신 기준 확인이 필요하다고 분명히 밝히되, '문의하세요'만 반복하지 말고 확인할 공식 경로와 확인 기준을 함께 쓴다.
- 독자가 제목에서 기대하는 핵심질문 5개에 각각 답한다. 전국 공통 제도와 지역별 사업을 혼동하지 않는다.
- "제가 신청했다", "조사해 봤다"처럼 실제 경험을 꾸며 쓰지 않는다. "자세히 살펴보면", "처음에는 …로 알기 쉽습니다", "놓치기 쉬운 부분은" 같은 1인칭·친근한 표현은 도입·핵심·마무리에만 자연스럽게 쓴다.
- 도입부·본문·결론을 같은 말로 반복하지 않는다. 각 문단에는 새 사실, 절차, 예외, 주의사항 중 적어도 하나를 담는다.

블록 규칙
- 문단: 3~4줄, 한 줄은 40~60자. 줄 사이 빈 줄("") 을 넣어 호흡을 준다.
- 분량이 가장 자주 모자란다. 각 소제목 아래에는 문단 블록을 반드시 2개 이상 둔다 (대상·조건·방법·주의·예시를 구체적으로). 첫 후킹 문단 뒤에도 도입 문단을 1개 더 둔다.
- 단락(섹션) 제목은 반드시 '소제목' 블록으로 넣는다. 정확히 5개이며, 각 제목은 반드시 '[소제목] '으로 시작한다. 벤치마크의 '섹션순서_인용구제목' 은 제목의 순서·내용만 참고하고, 블록 종류는 소제목으로 바꾼다.
- '인용구' 블록은 강조용이다. 글 전체에서 2~3개만, 본문 중간에서 독자가 꼭 기억해야 할 한 문장(핵심 결론·주의·행동)을 넣는다. 소제목 자리에 인용구를 쓰지 않는다.
- 비교할 공식 정보가 있을 때만 표는 정확히 9칸(3열×3행)으로 넣는다. 첫 줄은 열 이름, 그 다음 두 줄은 대표 사례 2개이며, 수치와 조건은 확인된사실만 쓴다.
- 사진은 총 ${사진수}장. 각 사진의 '프롬프트' 는 그 섹션의 메시지를 상징하는 장면을 영어로 1~2문장 묘사한다. 원문 문장을 그리지 않는다.
  사물·장소·상황·분위기만 쓴다. 간판·문서·서류·화면·책·표지판·현수막·포스터처럼 글자가 들어갈 만한 것은 넣지 않는다. 한국어 단어·제도 이름·숫자는 쓰지 않는다.
  사람을 그릴 때는 "seen from behind or in profile, face not visible" 를 넣는다. 화풍·글자 금지 규칙은 프로그램이 붙이므로 쓰지 않는다.
- 사진 블록은 소제목 바로 아래 첫 문단 다음에 하나씩 둔다. 글 끝에 몰아 넣지 않는다.
- FAQ는 마지막 소제목 아래에 질문·답 3~5개로 넣고, 신청 실수·예외·중복 수급·서류·심사 지연을 우선 다룬다. 확인 가능한 경우에는 마지막 문단에 실행 가능한 체크리스트를 넣되 FAQ와 같은 말을 반복하지 않는다.
- 결론은 핵심 조건, 놓치기 쉬운 주의, 지금 확인할 사항, 공식 신청 경로만 짧게 정리한다.
- 구분선은 마지막 문단 앞에 한 번.
- 전체 문단 글자 수(띄어쓰기 빼고)는 1,800~2,600자. 1,800자보다 짧으면 실패다.`;

  const 입력 = `${벤치마크 ? `벤치마크 구조:\n${JSON.stringify(벤치마크, null, 1)}\n\n` : ""}공식 조사:\n${JSON.stringify(조사, null, 1)}`;
  const j = await 오픈AI(키, "/responses", {
    model: 글모델,
    input: [{ role: "developer", content: 지시 }, { role: "user", content: 입력 }],
    text: { format: { type: "json_schema", name: "naver_post", schema: 원고형식, strict: true } },
    reasoning: { effort: "low" },
  });
  쓴돈.push({ model: 글모델, input_tokens: j.usage?.input_tokens || 0, output_tokens: j.usage?.output_tokens || 0 });
  let 원고 = 응답JSON(j);
  // 분량 보충 — 싼 모델은 글을 짧게 쓰는 버릇이 있다 (2026-09-23 실측 704자). 모자라면 한 번 늘려 쓰게 한다. 수강생에게는 알리지 않는다.
  const 글자수 = (w) => (w.블록 || []).filter((b) => b.종류 === "문단").flatMap((b) => b.글 || []).join("").replace(/\s/g, "").length;
  if (글자수(원고) < 1800) {
    const j2 = await 오픈AI(키, "/responses", {
      model: 글모델,
      input: [
        { role: "developer", content: 지시 },
        { role: "user", content: 입력 },
        { role: "assistant", content: JSON.stringify(원고) },
        { role: "user", content: `문단 글자 수가 ${글자수(원고)}자라 너무 짧다. 제목·소제목·표·인용구·사진·구분선의 순서와 내용은 그대로 두고, 각 소제목 아래 문단을 늘리거나 문단 블록을 더해 전체 문단 글자 수(띄어쓰기 빼고)를 2,000자 안팎으로 맞춘 전체 원고를 같은 JSON 형식으로 다시 줘라. 새 문장은 구체적인 정보(대상·조건·방법·주의)로 채운다.` },
      ],
      text: { format: { type: "json_schema", name: "naver_post", schema: 원고형식, strict: true } },
      reasoning: { effort: "low" },
    });
    쓴돈.push({ model: 글모델, input_tokens: j2.usage?.input_tokens || 0, output_tokens: j2.usage?.output_tokens || 0 });
    try { const 늘린 = 응답JSON(j2); if (글자수(늘린) > 글자수(원고)) 원고 = 늘린; } catch {}
  }
  // 초안 뒤에 한 번 더 검사·수정한다. 이 단계는 새 사실을 찾는 단계가 아니므로
  // 위 조사 밖의 숫자나 제도명을 추가하지 못하게 한다.
  try {
    const 검수 = await 오픈AI(키, "/responses", {
      model: 글모델,
      input: [{ role: "developer", content: `${지시}\n\n최종 검수: 제목 약속, 핵심질문 5개, 공식 근거, 중복, 5개 소제목, 표·FAQ·체크리스트의 실용성을 검사하고 문제가 있으면 고쳐라. 조사 밖의 사실을 새로 넣지 마라.` }, { role: "user", content: `공식 조사:\n${JSON.stringify(조사, null, 1)}\n\n초안:\n${JSON.stringify(원고)}` }],
      text: { format: { type: "json_schema", name: "reviewed_naver_post", schema: 원고형식, strict: true } },
      reasoning: { effort: "low" },
    });
    쓴돈.push({ model: 글모델, input_tokens: 검수.usage?.input_tokens || 0, output_tokens: 검수.usage?.output_tokens || 0 });
    원고 = 응답JSON(검수);
  } catch {}
  const 문제 = 품질문제(원고);
  if (문제.length) {
    try {
      const 보정 = await 오픈AI(키, "/responses", {
        model: 글모델,
        input: [{ role: "developer", content: `${지시}\n\n형식 오류만 고쳐라. 새 사실을 추가하지 마라.` }, { role: "user", content: `오류: ${문제.join(", ")}\n\n공식 조사:\n${JSON.stringify(조사, null, 1)}\n\n원고:\n${JSON.stringify(원고)}` }],
        text: { format: { type: "json_schema", name: "repaired_naver_post", schema: 원고형식, strict: true } }, reasoning: { effort: "low" },
      });
      쓴돈.push({ model: 글모델, input_tokens: 보정.usage?.input_tokens || 0, output_tokens: 보정.usage?.output_tokens || 0 });
      원고 = 응답JSON(보정);
    } catch {}
  }
  // 사진 자리 채우기 — 싼 모델이 사진 블록을 통째로 빼먹을 때가 있다 (2026-09-23 실측: 33블록 중 사진 0).
  // 모자란 만큼 소제목에 맞는 영어 장면 묘사를 따로 받아, 소제목 사이에 고르게 넣는다. 수강생에게는 알리지 않는다.
  const 있는사진 = (원고.블록 || []).filter((b) => b.종류 === "사진").length;
  if (있는사진 < 사진수) {
    const 모자람 = 사진수 - 있는사진;
    const 소제목들 = (원고.블록 || []).map((b, i) => ({ i, b })).filter((x) => x.b.종류 === "소제목");
    const 고른 = 소제목들.length ? Array.from({ length: 모자람 }, (_, k) => 소제목들[Math.min(소제목들.length - 1, Math.floor(((k + 0.5) * 소제목들.length) / 모자람))]) : [];
    let 장면들 = [];
    try {
      const j3 = await 오픈AI(키, "/responses", {
        model: 글모델,
        input: [{ role: "user", content: `블로그 글 "${원고.제목}" 에 넣을 사진 ${모자람}장의 장면을 영어로 묘사해라. 각 사진은 아래 소제목 하나씩의 메시지를 상징하는 장면이다. 사물·장소·상황·분위기만, 글자가 들어갈 만한 것(간판·문서·화면·책)과 사람 얼굴은 넣지 않는다. 1~2문장씩.\n${고른.map((x, k) => `${k + 1}. ${[].concat(x.b.글).join(" ")}`).join("\n")}` }],
        text: { format: { type: "json_schema", name: "scenes", strict: true, schema: { type: "object", additionalProperties: false, properties: { scenes: { type: "array", items: { type: "string" } } }, required: ["scenes"] } } },
        reasoning: { effort: "low" },
      });
      쓴돈.push({ model: 글모델, input_tokens: j3.usage?.input_tokens || 0, output_tokens: j3.usage?.output_tokens || 0 });
      장면들 = 응답JSON(j3).scenes || [];
    } catch {}
    // 뒤에서부터 넣어야 앞 위치가 안 밀린다. 소제목 바로 다음 문단 뒤에 넣는다.
    const 넣을곳 = 고른.map((x, k) => {
      let 위치 = x.i + 1;
      if (원고.블록[위치] && 원고.블록[위치].종류 === "문단") 위치 += 1;
      return { 위치, 프롬프트: 장면들[k] || `A calm, warm everyday scene that suggests: ${원고.제목}` };
    }).sort((a, b) => b.위치 - a.위치);
    for (const x of 넣을곳) 원고.블록.splice(x.위치, 0, { 종류: "사진", 글: [], 칸: [], 프롬프트: x.프롬프트 });
  }
  원고.블록 = 사진고르게(원고.블록 || []);
  Object.defineProperty(원고, "_사용량", { value: 쓴돈, enumerable: false });
  Object.defineProperty(원고, "_조사", { value: 조사, enumerable: false });
  return 원고;
}

// 사진 자리 고르기 — 글 모델이 사진을 글 끝에 몰아 넣을 때가 있다 (2026-09-23 실측: 사진 3장이 전부 맨 아래에 들어감).
// 모델이 어디에 두든 사진 순서는 그대로 두고, 소제목 아래 첫 문단 뒤에 고르게 다시 놓는다.
// 소제목이 사진보다 적으면 남는 사진은 다른 문단 뒤에 고르게 놓는다. (글만들기.mjs 와 naver-typing.mjs 에 같은 함수가 있다. 고치면 둘 다)
export function 사진고르게(블록들) {
  const 사진 = (블록들 || []).filter((b) => b && b.종류 === "사진");
  if (!사진.length) return 블록들 || [];
  const 나머지 = 블록들.filter((b) => b && b.종류 !== "사진");
  const 고르게 = (후보, n) => (후보.length && n > 0 ? Array.from({ length: n }, (_, k) => 후보[Math.floor(((k + 0.5) * 후보.length) / n)]) : []);
  // 자리 = 이 번호의 블록 '뒤'
  const 소제목뒤 = [];
  나머지.forEach((b, i) => { if (b.종류 === "소제목") 소제목뒤.push(나머지[i + 1] && 나머지[i + 1].종류 === "문단" ? i + 1 : i); });
  let 자리 = 고르게(소제목뒤, Math.min(소제목뒤.length, 사진.length));
  if (자리.length < 사진.length) {
    const 문단뒤 = 나머지.map((b, i) => (b.종류 === "문단" && i > 0 && i < 나머지.length - 1 && !자리.includes(i) ? i : -1)).filter((i) => i >= 0);
    자리 = 자리.concat(고르게(문단뒤, Math.min(문단뒤.length, 사진.length - 자리.length)));
  }
  자리 = [...new Set(자리)].sort((a, b) => a - b);
  const 결과 = [];
  let k = 0;
  나머지.forEach((b, i) => { 결과.push(b); if (자리.includes(i) && k < 사진.length) 결과.push(사진[k++]); });
  while (k < 사진.length) 결과.push(사진[k++]);
  return 결과;
}

// V5 완료 조건은 원고를 만든 시점과 네이버에 넣은 뒤 모두 확인한다.
// 내부링크는 실제 공개 글을 찾은 경우에만 통과로 처리한다.
export function V5구성점검(원고) {
  const 블록 = 원고?.블록 || [];
  const 썸네일 = 블록.some((b) => b.종류 === "썸네일" && b.파일 && /\.png$/i.test(String(b.파일)) && b.비율 === "1:1" && b.글자전용 === true);
  const 본문사진 = 블록.filter((b) => b.종류 === "사진" && b.역할 === "본문" && b.파일 && b.비율 === "16:9").length;
  const 태그블록 = 블록.find((b) => b.종류 === "태그");
  const 태그수 = Array.isArray(태그블록?.태그) ? 태그블록.태그.length : 0;
  const 내부링크 = 블록.some((b) => b.종류 === "내부링크" && b.검증됨 === true && /^https:\/\/blog\.naver\.com\//.test(String(b.URL || "")));
  const 누락 = [];
  if (!썸네일) 누락.push("1:1 PNG 썸네일");
  if (본문사진 !== 5) 누락.push("본문 16:9 이미지 5장");
  if (태그수 < 10 || 태그수 > 15) 누락.push("태그 10~15개");
  if (!내부링크) 누락.push("검증된 내부링크");
  return { 통과: 누락.length === 0, 누락 };
}

function XML안전문자(글) {
  return String(글 || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 이미지 모델의 한글 글씨는 틀릴 수 있어, 썸네일은 모델에 맡기지 않고 SVG로 만든다.
// 네이버 업로드가 SVG를 허용하지 않으면 typing 단계가 실패로 기록해 완료 처리하지 않는다.
export function 글자썸네일SVG(제목) {
  const 낱말 = String(제목 || "").trim().split(/\s+/).filter(Boolean);
  const 줄 = [];
  let 현재 = "";
  for (const 낱말하나 of 낱말) {
    if ((현재 + " " + 낱말하나).trim().length > 12 && 현재) { 줄.push(현재); 현재 = 낱말하나; }
    else 현재 = (현재 + " " + 낱말하나).trim();
  }
  if (현재) 줄.push(현재);
  const 보여줄줄 = (줄.length ? 줄 : ["새 글"]).slice(0, 3);
  const 시작 = 470 - ((보여줄줄.length - 1) * 85) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#ffffff"/><rect x="54" y="54" width="972" height="972" rx="32" fill="#ffffff" stroke="#111111" stroke-width="10"/>${보여줄줄.map((x, i) => `<text x="540" y="${시작 + i * 100}" text-anchor="middle" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="76" font-weight="800" fill="#111111">${XML안전문자(x)}</text>`).join("")}</svg>`;
}

export function 썸네일템플릿고르기() {
  return Math.random() < 0.5 ? "photo-info" : "bold-card";
}

export function 최종썸네일프롬프트(제목, 템플릿 = 썸네일템플릿고르기()) {
  const 공통 = [
    "Create a square 1080x1080 Korean Naver blog thumbnail as a raster PNG image.",
    `Use this Korean title verbatim and prominently: "${String(제목 || "새 글")}".`,
    "Make the Korean title large, highly legible, and central. No watermark, no logo, no SVG, no vector file.",
  ];
  if (템플릿 === "photo-info") return [...공통, "Template: topic-relevant warm photo or photorealistic illustration background, dark navy headline banner, yellow and white high-contrast Korean type, 2-4 compact rounded information boxes with simple icons. Designed for Korean adults aged 50-60."].join("\n");
  return [...공통, "Template: bold typography card, clean white or light pastel background, oversized navy and red Korean headline, strong yellow highlight brush stroke, one simple friendly policy-benefit icon. Minimal, high contrast, instantly readable."].join("\n");
}

export async function 썸네일그리기({ 키, 제목, 저장경로 }) {
  const 템플릿 = 썸네일템플릿고르기();
  const j = await 오픈AI(키, "/images/generations", { model: 그림모델, prompt: 최종썸네일프롬프트(제목, 템플릿), size: "1024x1024", quality: 그림화질, n: 1 });
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("썸네일 이미지가 생성되지 않았습니다");
  const 이미지 = Buffer.from(b64, "base64");
  if (!이미지.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("썸네일이 PNG 형식이 아닙니다");
  await writeFile(저장경로, 이미지);
  return { 저장경로, 템플릿, 사용량: { model: 그림모델, input_tokens: j.usage?.input_tokens || 0, output_tokens: j.usage?.output_tokens || 0 } };
}

function 태그만들기(키워드, 제목) {
  const 후보 = `${키워드 || ""} ${제목 || ""}`.match(/[가-힣A-Za-z0-9]{2,}/g) || [];
  const 기본 = ["정보", "정리", "신청방법", "지원대상", "생활정보", "정책정보", "확인사항", "혜택", "조건", "준비서류", "유의사항", "최신정보"];
  const 고유 = [...new Set([...후보, ...기본].map((x) => `#${String(x).replace(/[^가-힣A-Za-z0-9]/g, "")}`).filter((x) => x.length > 1))];
  return 고유.slice(0, 12);
}

// 최종 그림 프롬프트 — 어떤 언어의 글자도 나오지 않게 프로그램이 직접 만든다.
// 한글이 프롬프트에 있으면 모델이 그 글자를 그림에 그려 넣으므로 장면 묘사에서 한글·따옴표 안 문구를 지운다.
export function 최종그림프롬프트(장면) {
  const 깨끗한장면 = String(장면 || "")
    .replace(/["“”'‘’「」『』][^"“”'‘’「」『』]*["“”'‘’「」『』]/g, " ")
    .replace(/[\u3131-\u318E\uAC00-\uD7A3]+/g, " ")
    .replace(/\b(no text|no letters|no watermark|square 1:1|Korean)\b[,.]?/gi, " ")
    .replace(/\s+/g, " ").trim() || "a calm, warm everyday scene with simple objects";
  return [
    `Scene: ${깨끗한장면}`,
    "Style: square 1:1, soft pastel illustration, warm and friendly, simple uncluttered background, one clear focal point.",
    "People, if any, are seen from behind or in profile with faces not visible.",
    "STRICT RULE - NO TEXT AT ALL: the image must contain absolutely no text of any kind in any language or script. No Korean, no English, no numbers, no letters, no words, no signs, no labels, no captions, no watermarks, no logos, no UI text, no writing on paper, screens, boards, books, packaging, clothing or walls. If the scene would naturally include a sign, screen, document, book or label, render it blank, blurred or turned away so that nothing readable appears anywhere.",
  ].join("\n");
}

function CRC32(바이트) {
  let c = 0xffffffff;
  for (const b of 바이트) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function PNG청크(종류, 데이터) {
  const 이름 = Buffer.from(종류, "ascii"), 길이 = Buffer.alloc(4), 합 = Buffer.concat([이름, 데이터]), CRC = Buffer.alloc(4);
  길이.writeUInt32BE(데이터.length); CRC.writeUInt32BE(CRC32(합));
  return Buffer.concat([길이, 합, CRC]);
}
// gpt-image PNG(RGBA 8비트, 비인터레이스)만 중앙에서 잘라 16:9로 만든다.
// 다른 PNG 형식이면 억지로 통과시키지 않고 실패를 남긴다.
export async function PNG를16대9로자르기(저장경로) {
  const 파일 = await readFile(저장경로);
  if (!파일.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("16:9 자르기: PNG 파일이 아닙니다");
  let p = 8, IHDR, IDAT = [];
  while (p < 파일.length) { const 길이 = 파일.readUInt32BE(p); const 종류 = 파일.subarray(p + 4, p + 8).toString("ascii"); const 데이터 = 파일.subarray(p + 8, p + 8 + 길이); p += 12 + 길이; if (종류 === "IHDR") IHDR = Buffer.from(데이터); if (종류 === "IDAT") IDAT.push(데이터); if (종류 === "IEND") break; }
  const 너비 = IHDR?.readUInt32BE(0), 높이 = IHDR?.readUInt32BE(4), 비트 = IHDR?.[8], 색 = IHDR?.[9], 인터레이스 = IHDR?.[12];
  if (!IHDR || 비트 !== 8 || 색 !== 6 || 인터레이스 !== 0) throw new Error("16:9 자르기: 지원하지 않는 PNG 형식입니다");
  const 한줄 = 너비 * 4, 압축해제 = inflateSync(Buffer.concat(IDAT)), 원본 = Buffer.alloc(너비 * 높이 * 4);
  let 입력 = 0;
  for (let y = 0; y < 높이; y += 1) {
    const 필터 = 압축해제[입력++], 행 = 압축해제.subarray(입력, 입력 + 한줄), 대상 = 원본.subarray(y * 한줄, (y + 1) * 한줄); 입력 += 한줄;
    for (let x = 0; x < 한줄; x += 1) { const 왼쪽 = x >= 4 ? 대상[x - 4] : 0, 위 = y ? 원본[(y - 1) * 한줄 + x] : 0, 좌상 = y && x >= 4 ? 원본[(y - 1) * 한줄 + x - 4] : 0; if (필터 === 0) 대상[x] = 행[x]; else if (필터 === 1) 대상[x] = (행[x] + 왼쪽) & 255; else if (필터 === 2) 대상[x] = (행[x] + 위) & 255; else if (필터 === 3) 대상[x] = (행[x] + Math.floor((왼쪽 + 위) / 2)) & 255; else if (필터 === 4) { const q = 왼쪽 + 위 - 좌상, pa = Math.abs(q - 왼쪽), pb = Math.abs(q - 위), pc = Math.abs(q - 좌상); 대상[x] = (행[x] + (pa <= pb && pa <= pc ? 왼쪽 : pb <= pc ? 위 : 좌상)) & 255; } else throw new Error("16:9 자르기: 알 수 없는 PNG 필터입니다"); }
  }
  const 새높이 = Math.floor(너비 * 9 / 16), 시작Y = Math.max(0, Math.floor((높이 - 새높이) / 2)), 행들 = Buffer.alloc((한줄 + 1) * 새높이);
  for (let y = 0; y < 새높이; y += 1) { 행들[y * (한줄 + 1)] = 0; 원본.copy(행들, y * (한줄 + 1) + 1, (시작Y + y) * 한줄, (시작Y + y + 1) * 한줄); }
  const 새IHDR = Buffer.from(IHDR); 새IHDR.writeUInt32BE(새높이, 4);
  await writeFile(저장경로, Buffer.concat([파일.subarray(0, 8), PNG청크("IHDR", 새IHDR), PNG청크("IDAT", deflateSync(행들)), PNG청크("IEND", Buffer.alloc(0))]));
}

export async function 그림그리기({ 키, 프롬프트, 저장경로, 비율 = "16:9" }) {
  const j = await 오픈AI(키, "/images/generations", {
    model: 그림모델,
    prompt: 최종그림프롬프트(프롬프트),
    size: 비율 === "16:9" ? "1536x1024" : "1024x1024",
    quality: 그림화질,
    n: 1,
  });
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error("그림 모델이 이미지를 안 돌려줌");
  await writeFile(저장경로, Buffer.from(b64, "base64"));
  if (비율 === "16:9") await PNG를16대9로자르기(저장경로);
  return { 저장경로, 사용량: { model: 그림모델, input_tokens: j.usage?.input_tokens || 0, output_tokens: j.usage?.output_tokens || 0 } };
}

// 파일명에 넣을 키워드. 한글·영문·숫자만 남기고 띄어쓰기는 '-' 로. (네이버는 이미지 파일명도 본다)
export function 슬러그(글자, 최대 = 40) {
  return String(글자 || "").normalize("NFC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 최대).replace(/-$/, "") || "글";
}

// 글 하나 = 폴더 하나. 03_쓴글/2026-09-17_키워드/ 안에 원고.json 과 키워드-1.png … 가 들어간다.
export async function 만들기({ 키, 벤치마크, 벤치마크URL, 키워드, 사진수 = 5, 저장폴더 }) {
  if (!키) throw new Error("OpenAI 키가 없습니다");
  if (!벤치마크 && !벤치마크URL && !키워드) throw new Error("키워드나 벤치마크 글 주소가 필요합니다");
  const 기록 = [];
  if (!벤치마크 && 벤치마크URL) {
    벤치마크 = await 벤치마크가져오기(벤치마크URL);
    기록.push({ 단계: "벤치마크", 원문제목: 벤치마크.원문제목, 섹션수: 벤치마크.섹션순서_인용구제목.length, 사진수: 벤치마크.사진수 });
    if (!사진수) 사진수 = 5;
  }
  const 원고 = await 원고쓰기({ 키, 벤치마크, 키워드, 사진수 });
  기록.push({ 단계: "글", 제목: 원고.제목, 블록수: 원고.블록.length });

  // 폴더 이름: 날짜_키워드. 키워드가 없으면(벤치마크 모드) 새 제목의 앞부분을 쓴다.
  const 핵심 = 슬러그(키워드 || 원고.제목.split(/[,|(:·]/)[0], 30);
  const 날짜 = new Date().toISOString().slice(0, 10);
  const 폴더 = 저장폴더 || path.join(프로젝트, "03_쓴글", `${날짜}_${핵심}`);
  await mkdir(폴더, { recursive: true });

  let n = 0;
  const 사용량 = [...(원고._사용량 || [])];
  const 사진블록 = 원고.블록.filter((b) => b.종류 === "사진").slice(0, 5);
  // 그림은 동시에 만든다 (장당 30초~1분). 파일명에 키워드가 들어간다.
  await Promise.all(사진블록.map(async (b) => {
    const 번호 = ++n;
    const 파일 = `${핵심}-${번호}.png`;
    try {
      const 그림 = await 그림그리기({ 키, 프롬프트: b.프롬프트, 저장경로: path.join(폴더, 파일), 비율: "16:9" });
      사용량.push(그림.사용량);
      b.파일 = 파일;
      b.역할 = "본문";
      b.비율 = "16:9";
      기록.push({ 단계: `사진${번호}`, 파일, 프롬프트: b.프롬프트.slice(0, 60) });
    } catch (e) {
      b.파일 = null;
      기록.push({ 단계: `사진${번호}`, 실패: String(e?.message || e).slice(0, 120) });
    }
  }));

  const 썸네일파일 = `${핵심}-thumbnail.svg`;
  await writeFile(path.join(폴더, 썸네일파일), 글자썸네일SVG(원고.제목), "utf8");
  // naver-typing.mjs 가 읽는 모양으로 정리
  const 블록 = [
    { 종류: "썸네일", 파일: 썸네일파일, 비율: "1:1", 글자전용: true },
    ...원고.블록.map((b) => {
    if (b.종류 === "문단") return { 종류: "문단", 글: b.글 };
    if (b.종류 === "소제목" || b.종류 === "인용구") return { 종류: b.종류, 글: (b.글 || []).join(" ") };
    if (b.종류 === "표") return { 종류: "표", 칸: b.칸.slice(0, 9) };
    if (b.종류 === "구분선") return { 종류: "구분선" };
    if (b.종류 === "사진") return b.파일 ? { 종류: "사진", 역할: "본문", 파일: b.파일, 비율: "16:9" } : null;
    return null;
    }).filter(Boolean),
    { 종류: "태그", 태그: 태그만들기(키워드, 원고.제목) },
  ];

  const 원고경로 = path.join(폴더, "원고.json");
  await writeFile(원고경로, JSON.stringify({ 제목: 원고.제목, 키워드: 키워드 || 핵심, 만든날: 날짜, 벤치마크: 벤치마크URL || null, 공식조사: 원고._조사 || null, 블록 }, null, 2), "utf8");
  // 사람이 읽기 편한 사본도 같이 둔다
  const 읽기용 = [`# ${원고.제목}`, ""].concat(블록.map((b) => b.종류 === "문단" ? b.글.join("\n") : b.종류 === "소제목" ? `\n## ${b.글}` : b.종류 === "인용구" ? `> ${b.글}` : b.종류 === "표" ? "[표] " + b.칸.join(" | ") : b.종류 === "사진" || b.종류 === "썸네일" ? `[${b.종류}] ${b.파일}` : b.종류 === "태그" ? b.태그.join(" ") : "---")).join("\n\n");
  await writeFile(path.join(폴더, "원고.md"), 읽기용, "utf8");
  기록.push({ 단계: "저장", 폴더, 원고: 원고경로, 사진: 블록.filter((b) => b.종류 === "사진").map((b) => b.파일), 썸네일: 썸네일블록?.파일 || null, 태그수: 태그만들기(키워드, 원고.제목).length });
  const 사진실패 = 기록.filter((r) => /^사진\d/.test(r.단계) && r.실패).map((r) => r.실패);
  return { 제목: 원고.제목, 폴더, 원고: 원고경로, 사진수: 블록.filter((b) => b.종류 === "사진").length, 사진실패, 사용량, 기록 };
}

