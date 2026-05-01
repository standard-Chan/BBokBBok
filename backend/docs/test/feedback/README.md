# Feedback Test Design

## 전체 요약

- 이 문서는 `backend/src/modules/feedback`의 테스트 구조를 Kent C. Dodds 스타일로 설계한다.
- 기본 축은 `POST /api/feedback`, `GET /api/feedback/:solvedQuizId`, `GET /api/feedback/:solvedQuizId/speech-text`에 대한 Controller 통합테스트다.
- `FeedbackService.analyzeAnswer()`처럼 외부 AI 오류 매핑 분기가 많은 공개 메서드만 Service 보조 테스트로 분리한다.
- DB, Repository, 전역 `ValidationPipe`, `ApiResponseInterceptor`, `HttpExceptionFilter`는 실제 wiring을 사용하고, 외부 경계는 Gemini SDK와 Redis 의존이 묻어 있는 인증 보조만 테스트 더블로 제한한다.

## ADR

- 결정: `feedback` 모듈은 Controller 통합테스트를 기본 축으로 두고, 외부 AI 오류 매핑처럼 HTTP 하나로 커버하면 시나리오가 과도하게 비대해지는 부분만 Service 보조 테스트로 분리한다.
- 배경: 구현은 이미 완료되어 있고, 현재 위험은 private helper보다 사용자 기준의 실패 계약, guest 사용자 흐름, 소유권 검증, AI 피드백 생성 후 상태 전이 회귀다.
- 대안:
  - unit 중심: 빠르지만 `ValidationPipe`, `ParseIntPipe`, guest 쿠키 처리, 예외 필터, 응답 래퍼, DB 상태 전이를 놓친다.
  - service 중심: 외부 AI 오류 매핑은 선명하게 볼 수 있지만, 실제 API 계약과 guest 흐름을 직접 보장하지 못한다.
  - controller 중심: 사용자가 관찰하는 응답, 쿠키, 상태 코드, 영속화 결과를 한 번에 고정할 수 있다.
- 결정 이유:
  - `feedback`의 핵심 가치는 내부 문자열 조립이 아니라 "AI 피드백 생성/조회가 어떤 계약으로 동작하는가"에 있다.
  - `GET` 계열은 `@Public()`이지만 로그인 사용자와 guest 사용자 분기가 섞여 있으므로 controller 축이 가장 자연스럽다.
  - `POST /api/feedback`은 AI 결과 저장과 `solvedState=COMPLETED` 전이를 포함하므로 HTTP와 DB를 함께 보는 편이 신뢰도가 높다.
  - private helper인 `createTxtForAi()`와 `toChecklistResponse()`는 공개 응답과 저장 결과로 간접 검증 가능하므로 직접 테스트 대상에서 제외한다.
- 결과:
  - API 계약 회귀와 소유권/guest 분기 회귀를 높은 신뢰도로 잡을 수 있다.
  - 외부 AI 상태 코드 매핑은 보조 테스트로 응집시켜 controller 시나리오를 불필요하게 부풀리지 않게 된다.

## 테스트 대상 개요

- 주 대상 Controller 엔드포인트
  - `POST /api/feedback`
  - `GET /api/feedback/:solvedQuizId`
  - `GET /api/feedback/:solvedQuizId/speech-text`
- 보조 대상 Service 메서드
  - `FeedbackService.analyzeAnswer()`
- 현재 범위에서 제외하는 것
  - `createTxtForAi()` 직접 테스트
  - `toChecklistResponse()` 직접 테스트
  - `updateAiFeedback()` 단독 테스트
  - `AuthService`의 토큰 발급, Redis 갱신, OAuth 흐름 테스트

## 테스트 경계

- 기본 경계
  - `FeedbackController`, `FeedbackService`, `SpeechesService`, `UsersService`, 실제 TypeORM repository와 테스트 DB를 묶은 통합 테스트 모듈을 사용한다.
  - 전역 `ValidationPipe`, `ApiResponseInterceptor`, `HttpExceptionFilter`, `JwtAuthGuard`의 public-route 동작을 포함한다.
- 관찰 포인트
  - HTTP 상태 코드
  - `success`, `message`, `errorCode`, `data` 응답 래퍼 구조
  - guest 쿠키 발급 여부
  - `tb_solved_quiz.ai_feedback`, `tb_solved_quiz.solved_state` 영속화 결과
  - `solvedQuiz` 소유권에 따른 조회 성공/실패
- 경계를 좁히는 예외
  - `AuthService`는 `findUserByUuid()`와 `createGuestUser()`만 필요한 테스트 더블로 대체한다.
  - 이유: `feedback` 테스트의 본질은 인증 토큰 발급이 아니라 guest 식별 규칙이며, 실제 `AuthService`는 Redis 연결 책임까지 끌고 와 테스트 목적을 흐린다.

## Controller 통합테스트를 기본 축으로 두는 이유

- `feedback` 기능은 사용자가 HTTP로 직접 관찰하는 생성/조회 계약이 전부다.
- `OptionalCurrentUser`, guest 쿠키 생성, `ParseIntPipe`, DTO 숫자 변환, 예외 필터 응답 shape는 controller 통합테스트에서 가장 자연스럽게 드러난다.
- 생성 API는 AI 응답 저장과 상태 전이까지 완료되어야 의미가 있으므로, 단순 service mock보다 실제 DB 확인이 더 중요하다.
- 조회 API는 "존재 여부"가 아니라 "해당 사용자 소유의 solvedQuiz인지"가 핵심이어서, 요청-응답 축에서 보는 편이 명확하다.

## Service 보조 테스트를 분리하는 기준

- 아래 조건을 만족하는 공개 메서드만 분리한다.
  - 외부 API 오류 상태를 여러 비즈니스 오류로 세분화한다.
  - controller에서 모두 다루면 fixture와 mock 조합이 과도하게 커진다.
  - 같은 규칙을 HTTP 시나리오마다 반복 검증하게 된다.
- `analyzeAnswer()`
  - 429 일일 한도, 429 일반 rate limit, 400 safety, 400 invalid request, 400/403 api key, 5xx 서버 오류, 알 수 없는 오류를 서로 다른 `BusinessException`으로 매핑한다.
  - 이 분기는 controller에서 모두 다루면 `POST /api/feedback` 정상/길이/존재성 시나리오와 뒤섞여 읽기성이 급격히 떨어진다.
- 분리하지 않는 메서드
  - `generateAIFeedback()`
  - `getAIFeedback()`
  - `getSpeechText()`
  - 이유: 모두 HTTP에서 직접 관찰 가능하고, controller 축으로도 상태 변화와 소유권을 충분히 검증할 수 있다.

## 테스트 데이터와 fixture 전략

- 기본 fixture 묶음
  - 카테고리, 키워드, 체크리스트가 연결된 `mainQuiz` 1개 이상
  - 로그인 사용자 1명, 다른 사용자 1명, guest 사용자 1명
  - `speechText` 길이가 각각 49자, 50자, 1500자, 1501자인 `solvedQuiz`
  - `aiFeedback`가 없는 `solvedQuiz`, 이미 있는 `solvedQuiz`
  - 체크리스트 진행 상태가 2건 이상인 `userChecklistProgress`
- 설계 원칙
  - 길이 검증은 경계값 중심으로 만든다.
  - 소유권 검증은 같은 `mainQuiz`를 서로 다른 `userId`가 푼 데이터로 만든다.
  - guest 흐름은 "쿠키 없음", "유효한 guest 쿠키 있음", "쿠키는 있으나 DB 사용자 없음" 세 갈래로 나눈다.
  - AI 피드백 조회 응답의 `userChecklistProgress`는 `checklistCount`, `checkedCount` 계산이 드러나도록 최소 2건 이상으로 준비한다.

## mock 경계

- Controller 통합테스트
  - mock 대상
    - `GoogleGenAI` 또는 `FeedbackService.analyzeAnswer()`가 의존하는 외부 AI 호출
    - guest 사용자 식별에 필요한 최소 `AuthService` 메서드
  - mock하지 않는 대상
    - `FeedbackService`, `SpeechesService`, `UsersService`
    - TypeORM repository와 DB
    - 전역 validation/filter/interceptor
- Service 보조 테스트
  - `GoogleGenAI.models.generateContent()`만 mock한다.
  - logger는 더미 객체로 충분하다.
- 제외 이유
  - 이 모듈에서 중요한 실패는 내부 호출 횟수보다 예외 계약, 상태 전이, 영속화 결과다.

## 테스트 파일 구조 제안

- `backend/test/modules/feedback/feedback.controller.integration-spec.ts`
  - `POST /api/feedback`
  - `GET /api/feedback/:solvedQuizId`
  - `GET /api/feedback/:solvedQuizId/speech-text`
- `backend/test/modules/feedback/feedback.service.integration-spec.ts`
  - `FeedbackService.analyzeAnswer()`
- 정리 대상
  - 기존 [feedback.service.spec.ts](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/src/modules/feedback/feedback.service.spec.ts:1)는 단위 mock 테스트와 오래된 중복 시나리오가 섞여 있으므로, 새 통합 테스트 도입 후 역할을 축소하거나 이관 대상으로 본다.

## 리스크 또는 주의점

- `CreateAIFeedbackRequestDto`는 `@IsNumber()`와 변환에 의존하므로 문자열 숫자 허용 여부와 완전한 비숫자 거절 여부를 실제 앱 설정 기준으로 확인해야 한다.
- `POST /api/feedback`는 `solvedQuizId`와 `mainQuizId`의 무결성을 직접 검증하지 않는다. 현재 구현 기준으로는 `mainQuiz`와 `speechText`가 서로 다른 풀이 기록에서 조합될 가능성까지 테스트 문서에 드러내 두는 편이 좋다.
- `GET /api/feedback/:solvedQuizId`는 `aiFeedback`가 없으면 동일하게 `SOLVED_QUIZ_NOT_FOUND`를 반환하므로, "기록 없음"과 "피드백 미생성"을 구분하지 않는 현재 계약을 그대로 고정할지 추후 분리할지 판단이 필요하다.
- guest 쿠키 재사용 테스트는 cookie parser와 응답 `Set-Cookie` 확인이 포함되어야 하므로 순수 service 테스트로 대체하면 안 된다.
