# Quizzes Test Design

## 전체 요약

- 이 문서는 `backend/src/modules/quizzes`의 테스트 구조를 Kent C. Dodds 스타일로 재정리한다.
- 기본 축은 `GET /api/quizzes` 계열 Controller 통합테스트다.
- `QuizzesService`의 공개 메서드 중 HTTP로 직접 드러나지 않거나, 오류 분리를 더 선명하게 해야 하는 부분만 Service 보조 테스트로 분리한다.
- 테스트 데이터는 [backend/docs/test/data-sample.json](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/test/data-sample.json:1) 포맷을 기준으로 구성한다.
- DB, Repository, 전역 `ValidationPipe`, 응답 래퍼(`ApiResponseInterceptor`)는 실제 wiring을 사용하고, test 전용 DB는 Docker PostgreSQL로 고정한다.
- `getSolvedWithImportance()` 보조 테스트에 필요한 `solvedQuiz`와 사용자 데이터도 같은 샘플 JSON의 solved quiz 섹션을 우선 사용한다.

## ADR

- 결정: `QuizzesController`의 공개 API를 기본 축으로 하는 통합테스트를 먼저 설계하고, `getSolvedWithImportance()` 같은 비직접 HTTP 표면은 Service 보조 테스트로 다룬다.
- 배경: `quizzes` 모듈은 대부분 읽기 전용 조회 API이며, 카테고리/난이도 필터, 커서 페이지네이션, 체크리스트 존재 여부, 객관식 매핑, 404/400 계약이 핵심이다. 구현은 이미 존재하고, 현재 테스트는 오래된 service unit 성격 코드가 섞여 있어 실제 사용자 관점 신뢰를 충분히 대변하지 못한다.
- 대안:
  - unit 중심: 빠르지만 QueryBuilder, ValidationPipe, `ParseIntPipe`, 응답 래핑, repository 매핑 계약을 놓친다.
  - service 중심: HTTP 계약을 직접 보장하지 못하고, `@Query()` 변환과 `@Param()` 파싱 회귀를 잡기 어렵다.
  - controller 중심: 실제 사용자가 관찰하는 조회 결과와 예외를 가장 직접적으로 검증한다.
- 결정 이유:
  - `quizzes`의 핵심 가치는 HTTP 조회 계약 안정성이다.
  - 복잡한 쓰기 트랜잭션이나 외부 API 호출이 없어서 controller 통합테스트 비용이 상대적으로 낮다.
  - 이미 `backend/test/*.e2e-spec.ts` 계열에서 Docker PostgreSQL을 사용하는 방향이 보이므로, 같은 경계에서 테스트를 설계하는 편이 구현 일관성이 높다.
  - 구현 완료 후 테스트를 보강하는 단계에서는 내부 helper보다 공개 계약을 먼저 고정하는 편이 회귀 방지 효과가 크다.
  - private helper와 단순 DTO 매핑은 관찰 가능한 결과로 간접 검증 가능하므로 직접 테스트 대상에서 제외한다.
- 결과:
  - 라우팅, 전역 validation, 응답 shape, DB 조회 결과를 한 번에 검증하는 신뢰도 높은 테스트 스위트를 얻는다.
  - 오래된 service mock 테스트에 비해 유지보수성이 높아지고, repository 구현 변경에도 실제 API 계약 기준으로 회귀를 포착할 수 있다.

## 테스트 대상 개요

- 주 대상 Controller 엔드포인트
  - `GET /api/quizzes`
  - `GET /api/quizzes/aggregations`
  - `GET /api/quizzes/categories`
  - `GET /api/quizzes/:id`
  - `GET /api/quizzes/:mainQuizId/checklist`
  - `GET /api/quizzes/:mainQuizId/multiple-choices`
- 보조 대상 Service 메서드
  - `QuizzesService.getSolvedWithImportance()`
  - `QuizzesService.getKeywordsByQuiz()`
- 현재 범위에서 제외하는 것
  - private helper 직접 테스트
  - repository 메서드 자체의 단독 unit 테스트
  - `users` 모듈 controller 전체 흐름. 다만 `getSolvedWithImportance()`는 `quizzes` 소속 서비스 계약이므로 보조 테스트 범위에 포함한다.

## 테스트 경계

- 기본 경계
  - 실제 `AppModule` 또는 최소 동등한 통합 테스트 모듈을 띄운다.
  - 실제 PostgreSQL 테스트 DB와 TypeORM repository를 사용한다.
  - PostgreSQL은 Docker 컨테이너로 실행되는 test 전용 인스턴스를 사용한다.
  - 전역 `ValidationPipe`, `ParseIntPipe`, `ApiResponseInterceptor`, 예외 필터를 포함한다.
- 관찰 포인트
  - HTTP 상태 코드
  - `success`, `message`, `errorCode`, `data` 래퍼 구조
  - `data` 내부의 페이지네이션/집계/상세 응답 shape
  - DB에 저장된 seed 데이터와 조회 결과 정합성
- mock 경계
  - 없음
  - 이유: 이 모듈은 외부 네트워크 SDK를 호출하지 않고, 핵심 위험이 내부 조회 조합과 응답 계약에 있기 때문이다.

## Controller 통합테스트를 기본 축으로 두는 이유

- `quizzes` 기능은 모두 읽기 API로 노출되며, 사용자가 직접 관찰하는 것은 HTTP 응답뿐이다.
- `@Query()`의 enum 변환, 기본 `limit=15`, `cursor` 숫자 변환, `ParseIntPipe` 오류 같은 회귀는 controller 통합테스트에서 가장 자연스럽게 잡힌다.
- `MainQuizRepository.getAggregations()`, `findOneWithChecklist()`, `findById()`의 결과가 응답 DTO와 예외로 어떻게 번역되는지가 핵심이므로, service mock보다는 실제 wiring 검증 가치가 더 크다.
- 공개 API 수가 적고 모두 GET이어서 fixture 비용이 과도하지 않다.

## Service 보조 테스트를 분리하는 기준

- 아래에 해당하는 메서드만 분리한다.
  - controller 엔드포인트가 직접 존재하지 않는 메서드
  - 같은 규칙을 검증하려면 다른 모듈 controller까지 테스트가 퍼지는 메서드
  - 분기 수는 적지만, 서비스 계약 자체를 빠르게 고정할 가치가 있는 메서드
- `getSolvedWithImportance()`
  - `users` 모듈에서 소비되므로 `quizzes` controller 테스트만으로는 범위가 흐려진다.
  - 사용자 미존재 분기와 중요도별 그룹핑 결과를 보조 테스트로 고정한다.
- `getKeywordsByQuiz()`
  - 현재 controller에 직접 노출되지 않으므로 서비스 계약 수준에서 존재/부재 분기만 보조 검증한다.
- 분리하지 않는 메서드
  - `getQuizzes()`, `getAggregations()`, `findOne()`, `getQuizChecklist()`, `getMultipleChoicesByMainQuizId()`
  - 이유: 모두 HTTP에서 곧바로 관찰 가능하고 service-only 테스트를 추가하면 중복이 커진다.

## 테스트 데이터와 fixture 전략

- 기본 전략
  - [backend/docs/test/data-sample.json](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/test/data-sample.json:1)의 `quizzes`, `multiple_choice_quizzes`, solved quiz 관련 구조를 fixture의 기준 포맷으로 삼는다.
  - JSON 전체를 그대로 복제하기보다, 시나리오별로 필요한 최소 조각만 잘라 삽입한다.
  - Docker PostgreSQL 초기화 후 테스트마다 truncate + 재삽입 전략을 사용해 데이터 독립성을 확보한다.
- 권장 fixture 묶음
  - `quizzes[].mainQuiz` 기준의 `mainQuiz` 2~3개
  - `quizzes[].categoryName` 기준의 카테고리 2개 이상
  - `quizzes[].difficulty`를 엔티티 enum 값에 맞게 변환한 난이도별 퀴즈 세트
  - `quizzes[].checklist` 기준의 체크리스트가 있는 퀴즈 1개, 체크리스트 없는 퀴즈 1개
  - `quizzes[].multipleChoices[].options` 기준의 객관식 문항/선택지 세트 1개 이상
  - `quizzes[].keywords` 기준의 키워드 세트 1개 이상
  - 샘플 JSON의 solved quiz 섹션을 반영한 `solvedQuiz` 세트와 사용자 1명
- 설계 원칙
  - 한 테스트는 한 가지 검색 축만 드러나게 구성한다.
  - 페이지네이션 테스트는 정렬 기준 `mainQuizId ASC`가 드러나도록 ID 간격을 의도적으로 둔다.
  - 객관식 테스트는 `explanation`이 있는 옵션과 없는 옵션을 함께 넣어 `null` 매핑을 검증한다.
  - 샘플 JSON의 서술형 텍스트는 길고 식별 가능하므로, 응답 본문 매칭 시 제목/카테고리/난이도/선택지 일부를 기준으로 검증하면 가독성이 좋다.
  - `getSolvedWithImportance()`는 샘플 JSON에 정의된 중요도, 사용자, 메인 퀴즈 연결 관계를 그대로 재사용하고 필요한 최소 케이스만 덧붙인다.

## mock 경계

- Controller 통합테스트
  - mock 없음
- Service 보조 테스트
  - 가능하면 mock 없음
  - 단, 테스트 속도를 위해 controller 부팅이 불필요한 경우 테스트 모듈 단위로 repository 실제 구현만 연결한다.
- 제외 이유
  - 이 모듈에서 중요한 실패는 외부 의존성이 아니라 내부 조회 결과와 응답 번역 실패다.
  - 호출 횟수 검증보다 결과 데이터와 예외 계약 검증이 더 중요하다.

## 테스트 파일 구조 제안

- `backend/test/modules/quizzes/quizzes.controller.integration-spec.ts`
  - `GET /api/quizzes`
  - `GET /api/quizzes/aggregations`
  - `GET /api/quizzes/categories`
  - `GET /api/quizzes/:id`
  - `GET /api/quizzes/:mainQuizId/checklist`
  - `GET /api/quizzes/:mainQuizId/multiple-choices`
- `backend/test/modules/quizzes/quizzes.service.integration-spec.ts`
  - `getSolvedWithImportance()`
  - `getKeywordsByQuiz()`
- 브랜치 기준
  - 실제 테스트 구현은 사용자가 언급한 `feature/docker-postgres-e2e-test` 브랜치를 기준으로 분기한 작업 브랜치에서 진행하는 것을 전제로 한다.
  - 따라서 문서의 파일 구조와 경계도 `*.e2e-spec.ts` + Docker PostgreSQL 전개를 기준으로 유지한다.
- 정리 대상
  - 기존 [quizzes.service.spec.ts](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/src/modules/quizzes/quizzes.service.spec.ts:1)는 현재 구현 시그니처와 맞지 않는 오래된 mock 테스트 성격이 강하므로, 새 통합테스트 도입 후 역할을 재정의하거나 제거 여부를 별도 판단한다.

## 리스크 또는 주의점

- `GET /api/quizzes/:id`와 `GET /api/quizzes/:mainQuizId/checklist`는 path 구조가 인접해 있으므로 잘못된 문자열 path에서 `ParseIntPipe` 오류가 정확히 나는지 확인해야 한다.
- `GET /api/quizzes/aggregations`는 DTO validation보다 repository 집계 로직의 정합성이 더 중요하므로, 총합과 카테고리별 count 합이 함께 맞는지 검증해야 한다.
- `QuizCategoryRepository.findAll()`은 정렬을 보장하지 않으므로 categories API 테스트는 필요 시 정렬을 기대하지 말고 집합 기준으로 검증해야 한다.
- `getKeywordsByQuiz()`는 현재 controller 미연결 상태이므로, 장기적으로는 실제 진입점이 생기면 service 보조 테스트보다 controller 축으로 이동하는 것이 맞다.
- 샘플 JSON의 난이도 문자열과 실제 DB enum 표현이 다를 수 있으므로, fixture 적재 시 변환 규칙을 테스트 유틸에 명시해야 한다.
- solved quiz 샘플의 키 이름과 실제 엔티티 컬럼명이 다를 수 있으므로, fixture loader에서 사용자 ID, `mainQuizId`, `importance`, 생성 시각 매핑 규칙을 분리해 두는 편이 안전하다.
