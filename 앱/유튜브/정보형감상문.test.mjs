import test from "node:test";
import assert from "node:assert/strict";
import {영상ID,입력검사} from "./정보형감상문.mjs";
test("지원 URL에서 ID 추출",()=>{
  assert.equal(영상ID("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),"dQw4w9WgXcQ");
  assert.equal(영상ID("https://youtu.be/dQw4w9WgXcQ"),"dQw4w9WgXcQ");
  assert.equal(영상ID("https://youtube.com/shorts/dQw4w9WgXcQ"),"dQw4w9WgXcQ");
});
test("외부 도메인 차단",()=>assert.throws(()=>영상ID("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")));
test("사용자 감상과 영상 내용 필수",()=>{
  assert.throws(()=>입력검사({url:"https://youtu.be/dQw4w9WgXcQ",감상:"",자막:"내용"}));
  assert.throws(()=>입력검사({url:"https://youtu.be/dQw4w9WgXcQ",감상:"생각",자막:""}));
});
