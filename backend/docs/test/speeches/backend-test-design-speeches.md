# Backend Test Design: Speeches

## 전체 요약

- `speeches` 모듈은 `POST /api/speeches/stt`, `PATCH /api/speeches/:mainQuizId`, `GET /api/speeches/:mainQuizId`, `POST /api/speeches/text/:mainQuizId` 네 개의 HTTP 진입점을 중심으로 통합테스트를 설계한다.
- 기본 축은 Controller 통합테스트다. 이유는 guest 쿠키 발급, 전역 validation, 파일 업로드, 공통 응답 래퍼, DB 저장 결과가 모두 HTTP 레벨에서 관찰되기 때문이다.
- Service 보조 테스트는 `clovaSpeechLongStt()`의 외부 STT 오류 매핑과 `getSolvedQuizInfo()`처럼 controller 바깥 소비 지점이 있는 계약에 한정한다.
- DB와 repository wiring은 실제로 사용하고, 외부 STT API와 guest 생성에 필요한 인증 보조만 테스트 더블로 둔다.

## ADR

- 결정: `speeches` 모듈은 controller 통합테스트를 기본 축으로 두고, 외부 API 오류 매핑과 HTTP 밖 계약만 service 보조 테스트로 분리한다.
- 배경: 구현은 이미 존재하고, 현재 회귀 위험은 private helper보다 사용자 기준의 업로드/수정/조회/텍스트 저장 계약에 있다.
- 대안:
  - unit 중심 접근은 `FileInterceptor`, `ParseIntPipe`, `ValidationPipe`, guest cookie 재사용, 공통 예외 포맷을 놓친다.
  - service 중심 접근은 HTTP 요청 형식과 실제 응답 래퍼를 충분히 보장하지 못한다.
  - controller 중심 접근은 사용자가 실제로 관찰하는 성공/실패 계약과 DB side effect를 한 번에 고정한다.
- 결정 이유:
  - Kent C. Dodds 스타일은 구현 세부보다 사용자가 관찰하는 결과를 우선 검증하므로 현재 단계와 가장 잘 맞는다.
  - `speeches`는 인증 강제 대신 optional user + guest fallback을 쓰므로, 순수 service 테스트만으로는 핵심 흐름을 놓치기 쉽다.
  - STT 외부 API 상태 코드 매핑은 분기가 많고 HTTP만으로 모두 유도하기 무거워 service 보조 테스트가 더 적합하다.
  - private helper(`checkValidation()`, `parseUserAgent()`, `buildFormData()`)는 공개 메서드의 응답, 예외, 저장 결과로 간접 검증 가능하므로 별도 테스트 대상에서 제외한다.
- 결과:
  - API 계약 회귀와 guest 사용자 흐름 회귀를 빠르게 감지할 수 있다.
  - 외부 STT 오류 번역 규칙도 놓치지 않으면서 controller 시나리오가 과도하게 비대해지지 않는다.

## 테스트 대상 개요

- 공개 엔드포인트
  - `POST /api/speeches/stt`: 음성 파일을 STT로 변환하고 `tb_solved_quiz`에 저장
  - `PATCH /api/speeches/:mainQuizId`: 기존 `solvedQuiz`의 `speechText` 수정
  - `GET /api/speeches/:mainQuizId`: 특정 퀴즈에 대한 사용자별 음성 답변 목록 조회
  - `POST /api/speeches/text/:mainQuizId`: 텍스트 답변을 직접 저장
- 주요 도메인 규칙
  - 로그인 사용자가 없으면 guest user를 만들거나 guest cookie를 재사용한다.
  - STT 업로드는 MIME 타입과 파일 크기 제한을 가진다.
  - 수정은 `solvedQuiz.userId` 소유권이 맞아야 한다.
  - 텍스트 직접 저장은 사용자 존재, 퀴즈 존재, 최소/최대 글자수 규칙을 통과해야 한다.
- 외부/간접 소비 지점
  - `SpeechesService.getSolvedQuizInfo()`는 `feedback` 모듈에서 재사용된다.

## 테스트 경계

- 포함
  - Nest 애플리케이션 부트스트랩
  - global prefix `/api`
  - `ValidationPipe`
  - `HttpExceptionFilter`
  - `ApiResponseInterceptor`
  - cookie parser 및 guest cookie 읽기/쓰기
  - TypeORM repository와 실제 DB 저장/조회
- 제외
  - 실제 CLOVA Speech 네트워크 호출
  - 실제 OAuth/로그인 플로우
  - logger의 호출 횟수 자체
- 권장 경계
  - controller 통합테스트는 Supertest 기반으로 실제 multipart/body/cookie 요청을 보낸다.
  - service 보조 테스트는 `SpeechesService`를 실제 repository와 함께 띄우되, `fetch`만 mock한다.

## Controller 통합테스트를 기본 축으로 두는 이유

- 이 모듈의 핵심 가치는 “요청을 받았을 때 어떤 응답을 주고 어떤 기록을 남기느냐”다.
- guest user 생성과 기존 guest cookie 재사용은 controller 레벨에서만 온전히 드러난다.
- `POST /stt`는 multipart 업로드, path/body parsing, 공통 예외 필터까지 함께 봐야 의미가 있다.
- `PATCH`, `GET`, `POST /text`는 소유권, 정렬, 응답 DTO, 에러 래퍼를 함께 검증해야 회귀 탐지가 빠르다.

## Service 보조 테스트를 분리하는 기준

- 아래 조건에 해당하는 메서드만 controller 바깥에서 보조 테스트한다.
  - 외부 API 상태 코드와 응답 body.result 분기가 많다.
  - HTTP만으로 유도하기 번거로운 실패 상태가 있다.
  - 다른 모듈에서 직접 재사용되는 계약이다.
- `SpeechesService`에서 보조 테스트 후보
  - `clovaSpeechLongStt()`
    - CLOVA 401, 404, 429, `result=FAILED`, 네트워크 실패, 환경변수 누락 매핑
  - `getSolvedQuizInfo()`
    - `feedback` 모듈이 의존하는 solved quiz 조회 계약
- 보조 테스트가 불필요한 메서드
  - `getByQuizAndUser()`
  - `updateSpeechText()`
  - `createSpeechText()`
  - 위 세 메서드는 주요 가치가 HTTP에서 충분히 관찰되고, service 단독 테스트를 추가해도 중복 이익이 작다.

## 테스트 데이터와 fixture 전략

- 공통 fixture
  - 로그인 사용자 1명
  - guest 사용자 1명 이상
  - `mainQuiz` 2개 이상
  - 각 사용자 소유 `solvedQuiz` 여러 건
- `POST /stt`용 fixture
  - 유효한 `audio/webm` 또는 `audio/wav` 파일 버퍼
  - 지원하지 않는 MIME 파일 1개
  - 8MB 초과 파일 1개
- `PATCH`/`GET`용 fixture
  - 동일 `mainQuizId`에 대해 createdAt이 다른 `solvedQuiz` 2건 이상
  - 타 사용자 소유 `solvedQuiz` 1건
- `POST /text`용 fixture
  - 50자 이상 1500자 이하 정상 답변
  - 49자 이하 짧은 답변
  - 1501자 이상 긴 답변
- 데이터 원칙
  - createdAt 순서 검증이 필요한 시나리오는 명시적으로 시간 값을 벌려서 seed한다.
  - 한 시나리오가 검증할 값만 남기고, fixture는 최소한으로 유지한다.

## mock 경계

- mock 대상
  - 글로벌 `fetch`
  - 필요 시 `AuthService.findUserByUuid()` / `AuthService.createGuestUser()`
- mock하지 않는 대상
  - `SolvedQuizRepository`
  - `MainQuizRepository`
  - `UserRepository`
  - 예외 필터, interceptor, validation pipe
- mock 원칙
  - 외부 STT 결과는 성공 1개와 대표 실패 유형만 controller에서 다룬다.
  - 세부 오류 분기 대부분은 service 보조 테스트로 내린다.
  - guest 흐름은 쿠키 유무와 DB 사용자 존재 여부를 기준으로 검증하고, 단순 호출 횟수 검증에 치우치지 않는다.

## 테스트 파일 구조 제안

- `backend/test/modules/speeches/speeches.controller.integration-spec.ts`
  - `POST /api/speeches/stt`
  - `PATCH /api/speeches/:mainQuizId`
  - `GET /api/speeches/:mainQuizId`
  - `POST /api/speeches/text/:mainQuizId`
- `backend/test/modules/speeches/speeches.service.integration-spec.ts`
  - `SpeechesService.clovaSpeechLongStt()`
  - `SpeechesService.getSolvedQuizInfo()`
- `backend/test/modules/speeches/fixtures/`
  - 오디오 파일 fixture builder
  - 사용자/퀴즈/solved quiz seed helper

## 리스크 또는 주의점

- `PATCH /api/speeches/:mainQuizId`는 현재 구현상 path의 `mainQuizId`를 실제 검증에 사용하지 않는다.
  - 테스트를 작성하기 전에 “path와 body의 불일치를 막을지, 현재 동작을 그대로 고정할지”를 팀에서 결정하는 편이 좋다.
- `POST /api/speeches/stt`의 파일 크기 초과는 Multer 레이어와 service 자체 검사 둘 다 관여할 수 있다.
  - 통합테스트에서는 observable status와 error message를 기준으로 고정하고, 내부 어느 레이어에서 막았는지는 과도하게 묶지 않는 편이 낫다.
- guest cookie 시나리오는 테스트 간 상태 오염이 쉽다.
  - 각 테스트마다 쿠키와 사용자 seed를 독립적으로 초기화해야 한다.
- `getSolvedQuizInfo()`는 `speeches` controller가 아니라 `feedback`에서 소비된다.
  - `speeches` 문서에서 보조 테스트로 다루되, 최종 구현 시 `feedback` 통합테스트와 중복 범위를 조정해야 한다.
