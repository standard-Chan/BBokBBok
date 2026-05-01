# Backend Test Plan: Feedback

## 전체 요약

- `feedback` 모듈은 AI 피드백 생성과 조회를 HTTP로 노출하므로 Controller 통합테스트를 기본 축으로 잡는다.
- 핵심 범위는 생성 성공/실패, guest 쿠키 생성 및 재사용, 소유권 기반 조회, 응답 래퍼와 상태 전이다.
- Service 보조 테스트는 `FeedbackService.analyzeAnswer()`의 외부 AI 오류 매핑에 한정한다.
- 실제 DB와 repository를 사용하고, 외부 AI 호출과 Redis가 묻은 인증 보조만 테스트 더블로 대체한다.

## ADR

- 결정: `POST /api/feedback`와 두 개의 `GET /api/feedback/*` 계약을 먼저 고정하고, 외부 AI 상태 코드 매핑만 service 보조 테스트로 분리한다.
- 배경: 구현은 끝나 있지만, 현재 회귀 위험은 internal helper가 아니라 사용자 기준의 생성/조회 계약, guest 흐름, 소유권 규칙, AI 실패 메시지 번역이다.
- 대안:
  - service mock 중심은 상태 전이와 guest 쿠키 흐름을 놓친다.
  - unit 중심은 예외 필터와 validation 계약을 보장하지 못한다.
  - controller 중심은 실제 사용자가 마주하는 결과를 가장 직접적으로 고정한다.
- 결정 이유:
  - Kent C. Dodds 방식은 사용자가 관찰하는 동작을 우선 테스트하므로 현재 단계와 잘 맞다.
  - private helper는 결과 응답과 DB 상태로 간접 검증 가능해 별도 테스트 가치가 낮다.
  - AI 오류 매핑은 분기가 많아 service 보조 테스트로 분리하는 편이 더 읽기 쉽고 유지보수성이 높다.
- 결과:
  - API 회귀와 소유권 회귀를 빠르게 탐지할 수 있다.
  - 외부 AI 실패 계약도 세밀하게 고정되지만 controller 시나리오는 과도하게 비대해지지 않는다.

## 한눈에 보는 테스트 범위

- 엔드포인트별
  - `POST /api/feedback`: 정상 생성, body validation 실패, 퀴즈 없음, 답변 너무 짧음, 답변 너무 김, AI 저장 실패, AI 외부 오류 번역
  - `GET /api/feedback/:solvedQuizId`: 로그인 사용자 조회 성공, guest 쿠키 기반 조회 성공, guest 쿠키 신규 발급, 타 사용자 기록 조회 실패, AI 피드백 미생성 상태 조회 실패, 잘못된 path param 400
  - `GET /api/feedback/:solvedQuizId/speech-text`: 로그인 사용자 조회 성공, guest 쿠키 기반 조회 성공, 타 사용자 기록 조회 실패, 잘못된 path param 400
- 사용자 흐름별
  - 비로그인 첫 조회 시 guest 사용자 생성과 쿠키 저장
  - 비로그인 재조회 시 기존 guest 쿠키 재사용
  - 로그인 사용자는 쿠키 없이 자신의 기록 조회
- 상태 전이별
  - `POST /api/feedback` 성공 시 `tb_solved_quiz.ai_feedback` 저장
  - `POST /api/feedback` 성공 시 `tb_solved_quiz.solved_state = COMPLETED`
  - 실패 시 상태 전이 및 저장이 남지 않는지 확인
- 외부 의존성 오류별
  - Gemini 429 daily quota
  - Gemini 429 일반 rate limit
  - Gemini 400 safety / invalid request / api key
  - Gemini 403 api key
  - Gemini 5xx 서버 오류
  - 기타 예기치 못한 오류

## Controller 통합테스트 시나리오

### `POST /api/feedback`

#### 1. 유효한 요청이면 AI 피드백을 생성하고 solved quiz를 완료 상태로 바꾼다

- 무엇을 테스트하는가
  - 생성 API의 정상 전체 흐름
- 목적
  - 피드백 생성 기능의 핵심 사용자 가치를 고정한다.
- 의도
  - 퀴즈 조회, 사용자 답변 조회, 체크리스트 집계, AI 결과 저장, 상태 전이가 한 요청 안에서 이어지는지 보장한다.
- 준비 데이터
  - 키워드와 체크리스트가 연결된 `mainQuiz`
  - 50자 이상 1500자 이하 `speechText`를 가진 `solvedQuiz`
  - 체크리스트 진행 데이터 2건 이상
  - Gemini 성공 응답 mock
- 검증 포인트
  - 200 응답과 `success=true`
  - `data.solvedQuizDetail`의 `mainQuizId`, `title`, `keywords`, `difficultyLevel`
  - `data.solvedQuizDetail.userChecklistProgress.checklistCount`
  - `data.solvedQuizDetail.userChecklistProgress.checkedCount`
  - `data.aiFeedbackResult`가 AI 응답과 일치하는지
  - DB의 `ai_feedback` 저장 여부
  - DB의 `solved_state=COMPLETED`

#### 2. body가 비어 있거나 숫자가 아니면 validation 오류를 반환한다

- 무엇을 테스트하는가
  - 요청 DTO와 전역 validation 계약
- 목적
  - 잘못된 요청이 service까지 내려가지 않게 한다.
- 의도
  - `mainQuizId`, `solvedQuizId` 입력 형식 회귀를 빠르게 잡는다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답
  - `errorCode=VALIDATION_FAILED`
  - `data`에 validation 메시지 배열 포함

#### 3. 존재하지 않는 `mainQuizId`면 404를 반환한다

- 무엇을 테스트하는가
  - 퀴즈 부재 분기
- 목적
  - 잘못된 퀴즈 참조를 명확히 실패시킨다.
- 의도
  - AI 호출이나 상태 업데이트 전에 퀴즈 존재 검증이 우선되는지 확인한다.
- 준비 데이터
  - 존재하지 않는 `mainQuizId`
  - 유효한 `solvedQuiz`
- 검증 포인트
  - 404 응답
  - DB의 `ai_feedback`, `solved_state` 변화 없음

#### 4. 답변이 50자 미만이면 `ANSWER_TOO_SHORT`를 반환한다

- 무엇을 테스트하는가
  - 최소 길이 검증
- 목적
  - 너무 짧은 답변이 AI로 전달되지 않게 한다.
- 의도
  - 말하기 답변 저장 단계와 피드백 생성 단계의 규칙 차이를 명확히 고정한다.
- 준비 데이터
  - 49자 이하 `speechText`를 가진 `solvedQuiz`
- 검증 포인트
  - 400 응답
  - `errorCode=ANSWER_TOO_SHORT`
  - AI 호출 없음 또는 결과 저장 없음

#### 5. 답변이 1500자를 초과하면 `ANSWER_TOO_LONG`을 반환한다

- 무엇을 테스트하는가
  - 최대 길이 검증
- 목적
  - 과도한 입력이 저장/생성 흐름을 망치지 않게 한다.
- 의도
  - 길이 상한 정책이 회귀하지 않도록 한다.
- 준비 데이터
  - 1501자 이상 `speechText`를 가진 `solvedQuiz`
- 검증 포인트
  - 400 응답
  - `errorCode=ANSWER_TOO_LONG`
  - DB 변화 없음

#### 6. 체크리스트 진행 데이터가 없으면 404를 반환한다

- 무엇을 테스트하는가
  - `UsersService.getUserChecklistProgress()` 실패 전파
- 목적
  - 필수 보조 데이터가 없는 상태를 조용히 통과시키지 않게 한다.
- 의도
  - 피드백 생성 응답 계약이 체크리스트 요약에 의존함을 고정한다.
- 준비 데이터
  - 유효한 `mainQuiz`, `solvedQuiz`
  - 체크리스트 진행 데이터 없음
- 검증 포인트
  - 404 응답
  - `ai_feedback` 저장 없음
  - `solved_state` 변경 없음

#### 7. AI 결과 저장에 실패하면 500을 반환하고 완료 상태로 바뀌지 않는다

- 무엇을 테스트하는가
  - 저장 실패 분기
- 목적
  - 생성 성공처럼 보이지만 DB에는 남지 않는 불일치를 막는다.
- 의도
  - `updateAiFeedback()` 실패 시 전체 요청이 실패 계약을 유지하는지 확인한다.
- 준비 데이터
  - 정상 fixture
  - `SolvedQuizRepository.updateAiFeedback()`가 실패하도록 유도하는 fixture 또는 spy
- 검증 포인트
  - 500 응답
  - `solved_state`가 `COMPLETED`로 남지 않는지

#### 8. 외부 AI 오류는 비즈니스 오류 계약으로 번역된다

- 무엇을 테스트하는가
  - 대표 외부 오류의 HTTP 레벨 계약
- 목적
  - 프론트가 AI 실패를 일관되게 처리할 수 있게 한다.
- 의도
  - controller에서는 대표 케이스 몇 개만 확인하고, 상세 상태 코드는 service 보조 테스트에서 더 촘촘히 고정한다.
- 준비 데이터
  - 정상 fixture
  - Gemini 오류 mock
- 검증 포인트
  - 429 daily quota -> `EXTERNAL_API_DAILY_QUOTA_EXCEEDED`
  - 429 일반 -> `EXTERNAL_API_RATE_LIMIT_EXCEEDED`
  - 400 safety -> `EXTERNAL_API_SAFETY_BLOCK`
  - 5xx -> `EXTERNAL_API_SERVER_ERROR`

### `GET /api/feedback/:solvedQuizId`

#### 9. 로그인 사용자가 자신의 기록을 조회하면 AI 피드백과 체크리스트 요약을 반환한다

- 무엇을 테스트하는가
  - 인증 사용자 기준 정상 조회
- 목적
  - 피드백 결과 화면의 기본 조회 계약을 보장한다.
- 의도
  - `importance` 포함 응답과 체크리스트 집계가 유지되는지 확인한다.
- 준비 데이터
  - 해당 사용자 소유 `solvedQuiz`
  - 저장된 `aiFeedback`
  - 체크리스트 진행 데이터
  - 유효한 인증 사용자 주입
- 검증 포인트
  - 200 응답
  - `data.solvedQuizDetail.importance`
  - `data.aiFeedbackResult`
  - `userChecklistProgress.checklistCount`, `checkedCount`

#### 10. 비로그인 사용자가 쿠키 없이 조회하면 guest 사용자를 만들고 쿠키를 내려준다

- 무엇을 테스트하는가
  - 첫 guest 조회 흐름
- 목적
  - 비회원 사용자의 결과 조회 진입점을 보장한다.
- 의도
  - `getOrCreateGuestUserId()`의 observable contract를 HTTP에서 고정한다.
- 준비 데이터
  - guest 사용자로 연결된 `solvedQuiz`
  - 요청에는 인증/쿠키 없음
  - `AuthService.createGuestUser()`가 해당 guest를 반환하도록 구성
- 검증 포인트
  - 200 또는 해당 guest 소유일 경우 정상 응답
  - `Set-Cookie: guestUser=...`

#### 11. 비로그인 사용자가 유효한 guest 쿠키로 조회하면 새 쿠키 없이 기존 사용자를 재사용한다

- 무엇을 테스트하는가
  - guest 쿠키 재사용 흐름
- 목적
  - guest 사용자 결과가 요청마다 새 사용자로 분리되지 않게 한다.
- 의도
  - cookie 기반 사용자 해석이 안정적인지 확인한다.
- 준비 데이터
  - guest 사용자의 `uuid`, `userId`
  - 해당 user 소유 `solvedQuiz`
  - `guestUser` 쿠키 포함 요청
- 검증 포인트
  - 200 응답
  - 불필요한 새 `Set-Cookie`가 없는지
  - 기존 guest 소유 데이터가 반환되는지

#### 12. 쿠키는 있지만 DB에 guest 사용자가 없으면 새 guest를 만들고 쿠키를 갱신한다

- 무엇을 테스트하는가
  - stale guest 쿠키 복구 흐름
- 목적
  - 오래된 쿠키 때문에 조회가 영구 실패하지 않게 한다.
- 의도
  - `findUserByUuid()` 실패 후 fallback 생성이 유지되는지 보장한다.
- 준비 데이터
  - 존재하지 않는 `guestUser` 쿠키
  - 새 guest 생성 mock
- 검증 포인트
  - `Set-Cookie` 재발급
  - 이후 조회 결과 계약

#### 13. 다른 사용자의 solved quiz면 404를 반환한다

- 무엇을 테스트하는가
  - 소유권 검증
- 목적
  - 피드백 결과가 사용자 간에 노출되지 않게 한다.
- 의도
  - `findByIdAndUserId()` 기반의 소유권 검증을 고정한다.
- 준비 데이터
  - 사용자 A 소유 `solvedQuiz`
  - 사용자 B 또는 다른 guest로 조회
- 검증 포인트
  - 404 응답
  - `errorCode=SOLVED_QUIZ_NOT_FOUND`

#### 14. solved quiz는 있지만 AI 피드백이 아직 없으면 404를 반환한다

- 무엇을 테스트하는가
  - 피드백 미생성 상태
- 목적
  - 생성 전 화면 진입을 명확히 차단한다.
- 의도
  - 현재 구현이 "기록 없음"과 동일 오류를 주는 계약을 그대로 고정한다.
- 준비 데이터
  - `aiFeedback=null`인 해당 사용자 소유 `solvedQuiz`
- 검증 포인트
  - 404 응답
  - `errorCode=SOLVED_QUIZ_NOT_FOUND`

#### 15. 숫자가 아닌 `solvedQuizId`면 400을 반환한다

- 무엇을 테스트하는가
  - `ParseIntPipe` 검증
- 목적
  - 잘못된 path param이 service까지 내려가지 않게 한다.
- 의도
  - 조회 API의 입력 계약을 고정한다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답
  - validation/HTTP 400 계열 오류

### `GET /api/feedback/:solvedQuizId/speech-text`

#### 16. 로그인 사용자가 자신의 speech text를 조회하면 원문을 반환한다

- 무엇을 테스트하는가
  - 인증 사용자 기준 speech text 조회
- 목적
  - 피드백 이전/이후 원문 확인 기능의 계약을 보장한다.
- 의도
  - 응답이 `speechText` 한 필드로 유지되는지 고정한다.
- 준비 데이터
  - 해당 사용자 소유 `solvedQuiz`
- 검증 포인트
  - 200 응답
  - `data.speechText`

#### 17. guest 쿠키 기준으로도 자신의 speech text를 조회할 수 있다

- 무엇을 테스트하는가
  - guest 소유 speech text 조회
- 목적
  - 비회원 흐름에서도 원문 확인이 가능하도록 보장한다.
- 의도
  - 피드백 결과 조회와 동일한 guest 식별 규칙이 유지되는지 확인한다.
- 준비 데이터
  - guest 사용자 소유 `solvedQuiz`
  - 유효한 `guestUser` 쿠키
- 검증 포인트
  - 200 응답
  - `data.speechText`

#### 18. 다른 사용자의 solved quiz면 404를 반환한다

- 무엇을 테스트하는가
  - speech text 조회의 소유권 검증
- 목적
  - 원문 답변도 다른 사용자에게 노출되지 않게 한다.
- 의도
  - `getAIFeedback()`와 동일한 소유권 경계가 유지되는지 확인한다.
- 준비 데이터
  - 타 사용자 소유 `solvedQuiz`
- 검증 포인트
  - 404 응답
  - `errorCode=SOLVED_QUIZ_NOT_FOUND`

#### 19. 숫자가 아닌 `solvedQuizId`면 400을 반환한다

- 무엇을 테스트하는가
  - path param 검증
- 목적
  - 잘못된 요청 형식 방어를 고정한다.
- 의도
  - 두 GET 엔드포인트가 동일한 입력 계약을 유지하는지 확인한다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답

## Service 보조 테스트 시나리오

### `FeedbackService.analyzeAnswer()`

#### 1. 정상 JSON 응답이면 파싱된 객체를 반환한다

- 무엇을 테스트하는가
  - 외부 AI 성공 응답 파싱
- 목적
  - controller 테스트가 다루지 않는 순수 파싱 계약을 고정한다.
- 의도
  - `response.text` 기반 JSON 파싱이 유지되는지 확인한다.
- 준비 데이터
  - JSON 문자열을 반환하는 Gemini mock
- 검증 포인트
  - 반환 객체 일치

#### 2. 응답 text가 비어 있으면 내부 서버 오류를 비즈니스 오류로 변환한다

- 무엇을 테스트하는가
  - 빈 응답 처리
- 목적
  - 성공처럼 보이는 비정상 응답을 조용히 통과시키지 않게 한다.
- 의도
  - 빈 응답도 명시적 실패 계약으로 고정한다.
- 준비 데이터
  - `text`가 비어 있는 Gemini mock
- 검증 포인트
  - `INTERNAL_SERVER_ERROR`

#### 3. 잘못된 JSON이면 내부 서버 오류 계열로 변환한다

- 무엇을 테스트하는가
  - 파싱 실패 처리
- 목적
  - 외부 응답 포맷 깨짐에 대한 방어를 보장한다.
- 의도
  - 구현이 JSON 파싱 예외를 그대로 노출하지 않도록 한다.
- 준비 데이터
  - `invalid-json` 응답
- 검증 포인트
  - `INTERNAL_SERVER_ERROR`

#### 4. 429 daily quota면 `EXTERNAL_API_DAILY_QUOTA_EXCEEDED`

- 무엇을 테스트하는가
  - 일일 한도 초과 매핑
- 목적
  - 재시도 불가 성격의 429를 일반 rate limit과 구분한다.
- 의도
  - 프론트의 안내 메시지 분기를 가능하게 한다.
- 준비 데이터
  - `status=429`, message에 `daily` 포함
- 검증 포인트
  - `errorCode=EXTERNAL_API_DAILY_QUOTA_EXCEEDED`

#### 5. 429 일반 오류면 `EXTERNAL_API_RATE_LIMIT_EXCEEDED`

- 무엇을 테스트하는가
  - 일반 rate limit 매핑
- 목적
  - 일시적 재시도 가능 오류를 구분한다.
- 의도
  - 429 세부 분기가 회귀하지 않게 한다.
- 준비 데이터
  - `status=429`, message에 `daily` 없음
- 검증 포인트
  - `errorCode=EXTERNAL_API_RATE_LIMIT_EXCEEDED`

#### 6. 400 safety면 `EXTERNAL_API_SAFETY_BLOCK`

- 무엇을 테스트하는가
  - 안전 필터 차단 매핑
- 목적
  - 부적절한 답변에 대한 명시적 안내를 보장한다.
- 의도
  - 단순 invalid request와 구분한다.
- 준비 데이터
  - `status=400`, message에 `safety` 포함
- 검증 포인트
  - `errorCode=EXTERNAL_API_SAFETY_BLOCK`

#### 7. 400 api key 또는 403이면 `EXTERNAL_API_KEY_INVALID`

- 무엇을 테스트하는가
  - 인증/권한 오류 매핑
- 목적
  - 서버 설정 문제를 일반 사용자 입력 오류와 분리한다.
- 의도
  - 400 api key와 403을 같은 계약으로 묶는 현재 구현을 고정한다.
- 준비 데이터
  - `status=400`, message에 `api key`
  - 또는 `status=403`
- 검증 포인트
  - `errorCode=EXTERNAL_API_KEY_INVALID`

#### 8. 400 기타면 `EXTERNAL_API_INVALID_REQUEST`

- 무엇을 테스트하는가
  - 일반 잘못된 요청 매핑
- 목적
  - 외부 파라미터 오류를 명확히 구분한다.
- 의도
  - 400 세부 분기 누락을 막는다.
- 준비 데이터
  - `status=400`, 특수 키워드 없음
- 검증 포인트
  - `errorCode=EXTERNAL_API_INVALID_REQUEST`

#### 9. 5xx면 `EXTERNAL_API_SERVER_ERROR`

- 무엇을 테스트하는가
  - 외부 서버 장애 매핑
- 목적
  - 일시적 외부 장애를 일관되게 안내한다.
- 의도
  - 500, 503, 504 계열을 하나의 계약으로 묶는 현재 정책을 고정한다.
- 준비 데이터
  - `status=500` 이상
- 검증 포인트
  - `errorCode=EXTERNAL_API_SERVER_ERROR`

#### 10. 알 수 없는 오류면 `INTERNAL_SERVER_ERROR`

- 무엇을 테스트하는가
  - fallback 분기
- 목적
  - 분류되지 않은 예외도 일관된 응답으로 닫는다.
- 의도
  - raw error leak를 방지한다.
- 준비 데이터
  - status 없는 예외
- 검증 포인트
  - `errorCode=INTERNAL_SERVER_ERROR`

## 우선순위 또는 작성 순서

1. `POST /api/feedback` 정상 생성, 짧은 답변, 긴 답변, 퀴즈 없음
2. `GET /api/feedback/:solvedQuizId` 로그인 사용자 성공, 타 사용자 실패, AI 미생성 실패
3. `GET /api/feedback/:solvedQuizId` guest 쿠키 신규 발급, 쿠키 재사용, stale 쿠키 복구
4. `GET /api/feedback/:solvedQuizId/speech-text` 성공/실패 시나리오
5. `FeedbackService.analyzeAnswer()` 상태 코드 매핑 전체
6. 마지막으로 validation/path param 400 계열과 저장 실패/롤백 성격 시나리오 보강

## 완료 기준

- 세 엔드포인트의 정상/대표 실패/소유권/guest 흐름이 모두 문서화되어 있다.
- `POST /api/feedback`의 저장 결과와 `solved_state` 전이가 검증 범위에 포함되어 있다.
- Gemini 오류 매핑이 service 보조 테스트 시나리오로 빠짐없이 정리되어 있다.
- 실제 테스트 코드 작성 시 fixture 종류, mock 경계, 검증 포인트를 추가로 결정할 필요가 없을 정도로 범위가 고정되어 있다.
