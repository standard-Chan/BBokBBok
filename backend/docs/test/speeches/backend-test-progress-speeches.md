# Speeches Test Progress

## 전체 대상 범위

- `speeches` 모듈 controller 통합테스트 4개 엔드포인트
- `SpeechesService` 보조 통합테스트 2개 계약

## 전체 API 수

- 4

## 배치 분할 기준

- 배치 1: `POST /api/speeches/stt`, `PATCH /api/speeches/:mainQuizId`
- 배치 2: `GET /api/speeches/:mainQuizId`, `POST /api/speeches/text/:mainQuizId`
- 배치 3: `SpeechesService.clovaSpeechLongStt()`, `SpeechesService.getSolvedQuizInfo()`

## 완료된 배치

- 배치 1 완료
- 배치 2 완료
- 배치 3 완료

## 각 배치에서 작성된 테스트 파일

- 배치 1: `backend/src/test/modules/speeches/speeches.controller.integration.spec.ts`
- 배치 2: `backend/src/test/modules/speeches/speeches.controller.integration.spec.ts`
- 배치 3: `backend/src/test/modules/speeches/speeches.service.integration.spec.ts`

## 아직 남은 배치

- 없음

## 마지막 실행 결과

- `npm test -- speeches` 통과
- `npx prettier --check src/test/modules/speeches/speeches.controller.integration.spec.ts src/test/modules/speeches/speeches.service.integration.spec.ts` 통과
- `npm test` 전체 실행 시 `src/modules/quizzes/quizzes.service.spec.ts`의 기존 DI 누락으로 실패

## 남은 실패 또는 blocker

- `backend` 전체 테스트는 이번 변경과 무관하게 `QuizzesService` 테스트 모듈의 `QuizCategoryRepository` provider 누락으로 실패
- `npm run format:check`는 저장소 전반의 기존 Prettier 불일치로 실패
- `eslint` 전체 실행은 현재 환경에서 장시간 완료되지 않아 결과를 확정하지 못함

## 다음 시작 지점

- 필요 시 `quizzes.service.spec.ts`의 테스트 모듈 provider 구성과 저장소 전반 포맷 상태를 별도 정리
