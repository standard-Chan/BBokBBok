# Backend Test Plan Overview

## 목적

- 테스트가 없는 비즈니스 로직을 우선 식별하고, 테스트 코드 작성 전에 모듈별 대상과 시나리오를 고정한다.
- 실제 테스트 코드는 `backend/test` 아래에 작성하고, `backend/src`와 동일한 디렉토리 구조를 유지한다.
- 현재 `src` 내부의 기존 `*.spec.ts`는 재사용 여부를 판단한 뒤 `backend/test` 구조로 단계적으로 이관한다.

## 1차 범위

- `service + repository + database` 통합테스트
  - 비즈니스 규칙
  - 권한 검증
  - 상태 전이
  - 외부 의존성 오케스트레이션
  - DTO/응답 매핑
- `controller` 통합테스트
  - 요청/응답 계약
  - guest 사용자 흐름
  - 인증 사용자 분기
  - path param 파싱
- `custom repository`
  - 커스텀 조회 쿼리
  - 집계/조인/정렬/필터링
  - 서비스가 의존하는 데이터 shape 보장

## 이번 단계에서 제외

- guard 자체의 단위 테스트
- interceptor 단위 테스트
- exception filter 단위 테스트
- DTO validation 전용 테스트
- migration 로직 자체 테스트
- 단순 `save/find/delete` 래퍼만 있는 repository 메서드

## 문서 구성

- [backend-test-plan-auth.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-auth.md)
- [backend-test-plan-users.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-users.md)
- [backend-test-plan-quizzes.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-quizzes.md)
- [backend-test-plan-speeches.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-speeches.md)
- [backend-test-plan-feedback.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-feedback.md)
- [backend-test-plan-repositories.md](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/backend-test-plan-repositories.md)

## 공통 테스트 작성 원칙

- Kent C. Dodds 스타일을 기본 원칙으로 사용한다.
- 구현 세부사항보다 사용자가 관찰 가능한 결과를 검증한다.
- private 메서드와 내부 helper를 직접 테스트하지 않는다.
- mock은 구현 내부가 아니라 외부 경계에만 둔다.
- `FeedbackService.analyzeAnswer()` 같은 내부 로직은 직접 mock하지 않고, `GoogleGenAI` 같은 외부 SDK만 대체한다.
- DB, repository, entity 관계는 가능한 실제 구성으로 묶어 검증한다.
- assertion은 호출 횟수 중심보다 응답, 상태 전이, 영속화 결과 중심으로 작성한다.
- 외부 네트워크 호출은 금지하고, `GoogleGenAI`, `fetch`, `Redis`, `JwtService` 등 외부 경계만 테스트 더블로 대체한다.

## 테스트 데이터 원칙

- 기본 카탈로그성 데이터는 seed를 재사용한다.
- 테스트별로 변하는 데이터만 케이스 안에서 생성한다.
  - `user`
  - `solvedQuiz`
  - `userChecklistProgress`
  - `aiFeedback`
- 각 테스트는 독립적으로 읽히도록 fixture 이름을 도메인 의미 중심으로 작성한다.

## 테스트 코드 배치 원칙

- HTTP 통합테스트
  - `backend/test/modules/<module>/<module>.integration-spec.ts`
- service 통합테스트
  - `backend/test/modules/<module>/<service>.integration-spec.ts`
- repository 테스트
  - `backend/test/datasources/repositories/<repository>.spec.ts`
- 기존 `src/**/*.spec.ts`
  - 바로 삭제하지 않는다.
  - 신규 테스트 작성 후 중복 여부를 보고 이관한다.

## 구현 우선순위

1. `users`, `quizzes`
2. `auth`, `speeches`, `feedback`
3. `repositories`

## 완료 기준

- 각 서비스/엔드포인트별로 테스트할 시나리오가 문서에 고정되어 있다.
- 각 커스텀 repository 메서드별로 테스트할 쿼리 특성이 문서에 고정되어 있다.
- 실제 테스트 코드 작성 시 추가 의사결정이 필요하지 않을 정도로 fixture 전략, mock 경계, 성공/실패 분기가 정리되어 있다.
