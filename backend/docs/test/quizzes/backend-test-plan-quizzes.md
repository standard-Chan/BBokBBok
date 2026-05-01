# Backend Test Plan: Quizzes

## 전체 요약

- `quizzes` 모듈은 조회형 API가 대부분이므로 Controller 통합테스트를 기본 축으로 잡는다.
- 핵심 범위는 목록 조회, 집계, 카테고리 조회, 상세 조회, 체크리스트 조회, 객관식 조회다.
- Service 보조 테스트는 `getSolvedWithImportance()`와 `getKeywordsByQuiz()`처럼 controller에 직접 걸리지 않는 서비스 계약만 다룬다.
- 테스트 데이터는 [backend/docs/test/data-sample.json](/mnt/c/Users/정석찬/Desktop/project/BBokBBok/backend/docs/test/data-sample.json:1) 포맷을 기준으로 적재한다.
- mock은 두지 않고 Docker PostgreSQL 기반 실제 DB와 repository 결과를 기준으로 검증한다.
- `getSolvedWithImportance()` 시나리오는 같은 샘플 JSON의 solved quiz 데이터를 우선 fixture 소스로 사용한다.

## ADR

- 결정: `GET /api/quizzes*` 공개 계약을 우선 고정하고, 비직접 HTTP 서비스 계약만 보조 테스트로 분리한다.
- 배경: 구현은 완료되어 있고, 현재 위험은 내부 helper보다 조회 결과와 응답 형식의 회귀다.
- 대안:
  - service mock 중심은 HTTP 계약 회귀를 놓친다.
  - repository unit 중심은 사용자가 실제로 만나는 결과를 충분히 보장하지 못한다.
  - controller 통합 중심은 전역 validation, interceptor, TypeORM 조회 결과를 함께 검증할 수 있다.
- 결정 이유:
  - Kent C. Dodds 방식은 구현 세부보다 사용자가 관찰하는 동작을 우선 검증하는 데 적합하다.
  - 구현 완료 이후의 테스트 보강 단계에서는 공개 계약을 먼저 고정하는 편이 비용 대비 효과가 높다.
  - `feature/docker-postgres-e2e-test` 기준 브랜치에서 실제 e2e 테스트를 확장할 계획이므로, 설계 단계부터 Docker PostgreSQL 경계를 고정하는 편이 낫다.
  - private helper는 관찰 가능한 응답과 예외를 통해 간접 검증 가능하므로 별도 대상에서 제외한다.
- 결과:
  - 테스트 작성 순서가 명확해지고, API 회귀를 빠르게 감지할 수 있다.
  - 보조 service 테스트는 controller에서 다루기 애매한 소수 계약만 담당하게 된다.

## 한눈에 보는 테스트 범위

- 엔드포인트별
  - `GET /api/quizzes`: 기본 목록, 커서 페이지네이션, 카테고리 필터, 난이도 필터, 잘못된 query validation
  - `GET /api/quizzes/aggregations`: 전체 집계, 난이도 필터 집계, 잘못된 enum validation
  - `GET /api/quizzes/categories`: 전체 카테고리 조회
  - `GET /api/quizzes/:id`: 상세 조회 성공, 존재하지 않는 퀴즈 404, 잘못된 path param 400
  - `GET /api/quizzes/:mainQuizId/checklist`: 체크리스트 조회 성공, 퀴즈 없음 404, 체크리스트 없음 404
  - `GET /api/quizzes/:mainQuizId/multiple-choices`: 객관식 조회 성공, 메인 퀴즈 없음 404
- 상태/소유권별
  - 이 모듈의 controller는 `@Public()`이라 인증/소유권 분기보다 조회 계약과 데이터 존재 여부가 핵심이다.
- Service 계약별
  - `QuizzesService.getSolvedWithImportance()`: 사용자 없음 404, 중요도별 그룹핑
  - `QuizzesService.getKeywordsByQuiz()`: 키워드 조회 성공, 퀴즈 없음 404
- 데이터 소스별
  - `data-sample.json > quizzes[]`: 카테고리, 난이도, 본문, 체크리스트, 키워드
  - `data-sample.json > multiple_choice_quizzes[]`: 객관식 문항과 선택지
  - `data-sample.json > solved quiz 섹션`: 사용자별 풀이 결과, 중요도, 메인 퀴즈 연결

## Controller 통합테스트 시나리오

### `GET /api/quizzes`

#### 1. 기본 요청이면 오름차순 목록과 기본 `limit=15` 규칙을 반환한다

- 무엇을 테스트하는가
  - query 없이 호출했을 때 커서 기반 목록 API의 기본 응답 계약
- 목적
  - 퀴즈 목록 화면의 가장 기본 조회 흐름을 고정한다.
- 의도
  - 전역 query 변환과 기본 페이지 크기 정책이 함께 유지되는지 보장한다.
- 준비 데이터
  - `data-sample.json` 포맷의 `quizzes[]`를 변형해 `mainQuizId`가 증가하는 퀴즈 16개 이상
- 검증 포인트
  - `success=true`
  - `data.items` 또는 pagination 결과 구조
  - 첫 15개만 반환되는지
  - 정렬이 `mainQuizId ASC`인지
  - 다음 커서 존재 여부

#### 2. `cursor`가 주어지면 해당 ID 이후 데이터만 반환한다

- 무엇을 테스트하는가
  - 커서 페이지네이션의 절단 지점
- 목적
  - 무한 스크롤이 중복 없이 다음 페이지를 읽는지 보장한다.
- 의도
  - repository QueryBuilder의 `mainQuizId > :cursor` 조건이 실제 API에 반영되는지 확인한다.
- 준비 데이터
  - 연속 ID를 가진 퀴즈 여러 개
- 검증 포인트
  - cursor 이하 ID가 응답에 포함되지 않는지
  - 다음 페이지 계산이 올바른지

#### 3. 카테고리 필터를 주면 해당 카테고리만 조회한다

- 무엇을 테스트하는가
  - `category` query 필터
- 목적
  - 카테고리 탭/필터 UI의 서버 계약을 보장한다.
- 의도
  - category 조인 조건이 누락되지 않도록 한다.
- 준비 데이터
  - `data-sample.json` 기준 서로 다른 `categoryName`을 가진 퀴즈 세트
- 검증 포인트
  - 응답의 모든 퀴즈가 요청 카테고리에 속하는지
  - 다른 카테고리 퀴즈가 섞이지 않는지

#### 4. 난이도 필터를 주면 해당 난이도만 조회한다

- 무엇을 테스트하는가
  - `difficulty` enum 필터
- 목적
  - 난이도 기반 탐색의 기본 정확성을 확보한다.
- 의도
  - enum 변환과 repository 조건이 함께 유지되는지 보장한다.
- 준비 데이터
  - 샘플 JSON 난이도 값을 엔티티 enum으로 변환한 `EASY`, `MEDIUM`, `HARD` 퀴즈 세트
- 검증 포인트
  - 응답의 모든 퀴즈가 요청 난이도인지

#### 5. 잘못된 `difficulty`나 `limit`이면 validation 오류를 반환한다

- 무엇을 테스트하는가
  - 전역 `ValidationPipe`와 DTO 제약
- 목적
  - 잘못된 query가 조용히 무시되지 않도록 한다.
- 의도
  - API 입력 계약을 구현 세부가 아니라 사용자 요청 레벨에서 고정한다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답
  - `errorCode`가 validation 계열인지

### `GET /api/quizzes/aggregations`

#### 6. 필터 없이 카테고리별 count와 total을 반환한다

- 무엇을 테스트하는가
  - 전체 집계 API의 정상 계약
- 목적
  - 목록 필터 패널이 신뢰할 수 있는 집계 데이터를 받는지 보장한다.
- 의도
  - 카테고리별 count와 총합 계산이 동시에 유지되는지 확인한다.
- 준비 데이터
  - 여러 카테고리와 퀴즈 개수 차이가 있는 `data-sample.json` 기반 fixture
- 검증 포인트
  - `data.categories[].name`
  - `data.categories[].count`
  - `data.total`
  - 카테고리 count 합과 total의 일치

#### 7. 난이도 필터가 있으면 그 범위로만 집계한다

- 무엇을 테스트하는가
  - 집계 API의 필터 반영
- 목적
  - 필터 UI와 집계가 서로 다른 기준으로 계산되는 회귀를 막는다.
- 의도
  - 동일 난이도 조건이 목록/집계 양쪽에서 일관되게 적용되는지 보장한다.
- 준비 데이터
  - 난이도가 섞인 `data-sample.json` 기반 fixture
- 검증 포인트
  - 지정 난이도 기준의 categories 및 total만 계산되는지

#### 8. 잘못된 난이도 값이면 validation 오류를 반환한다

- 무엇을 테스트하는가
  - 집계 API의 query enum 검증
- 목적
  - 잘못된 입력이 repository까지 내려가지 않게 한다.
- 의도
  - controller 앞단의 방어선을 고정한다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답

### `GET /api/quizzes/categories`

#### 9. 전체 카테고리 목록을 반환한다

- 무엇을 테스트하는가
  - 카테고리 마스터 조회
- 목적
  - 카테고리 선택 UI의 데이터 소스를 검증한다.
- 의도
  - 최소한 `quizCategoryId`, `name` 계약이 유지되는지 확인한다.
- 준비 데이터
  - `data-sample.json` 기준 category fixture
- 검증 포인트
  - 응답 배열 길이
  - 각 항목의 필수 필드 존재

### `GET /api/quizzes/:id`

#### 10. 존재하는 퀴즈 ID면 상세 정보를 반환한다

- 무엇을 테스트하는가
  - 단건 조회 정상 흐름
- 목적
  - 퀴즈 상세 화면의 기본 데이터를 보장한다.
- 의도
  - `findById()` 결과가 응답으로 그대로 살아오는지 검증한다.
- 준비 데이터
  - `data-sample.json`의 `mainQuiz`, `categoryName`, `checklist`를 반영한 퀴즈 1개
- 검증 포인트
  - `mainQuizId`, `title`, `content`, `difficultyLevel`
  - 연관 `quizCategory`, `checklistItems` 포함 여부

#### 11. 존재하지 않는 퀴즈 ID면 404를 반환한다

- 무엇을 테스트하는가
  - 상세 조회 부재 분기
- 목적
  - 잘못된 링크 접근 시 명확한 실패를 보장한다.
- 의도
  - controller의 `NotFoundException` 변환 책임을 고정한다.
- 준비 데이터
  - 존재하지 않는 ID
- 검증 포인트
  - 404 응답
  - 오류 메시지

#### 12. 숫자가 아닌 path param이면 400을 반환한다

- 무엇을 테스트하는가
  - `ParseIntPipe` 오류 처리
- 목적
  - route 파라미터 형식 계약을 보장한다.
- 의도
  - 잘못된 문자열이 service까지 전달되지 않도록 한다.
- 준비 데이터
  - 없음
- 검증 포인트
  - 400 응답

### `GET /api/quizzes/:mainQuizId/checklist`

#### 13. 체크리스트가 있는 퀴즈면 정렬된 체크리스트를 반환한다

- 무엇을 테스트하는가
  - 체크리스트 조회 정상 흐름
- 목적
  - 학습 체크리스트 화면의 데이터 계약을 보장한다.
- 의도
  - `sortOrder ASC` 정렬과 DTO 매핑이 유지되는지 검증한다.
- 준비 데이터
  - `data-sample.json`의 `checklist` 배열을 반영한 퀴즈 1개
- 검증 포인트
  - `mainQuizId`, `title`, `content`, `difficultyLevel`
  - `checklistItems[].sortOrder` 오름차순

#### 14. 퀴즈가 없으면 404를 반환한다

- 무엇을 테스트하는가
  - 체크리스트 조회의 퀴즈 부재 분기
- 목적
  - 잘못된 참조가 조용히 빈 배열로 처리되지 않게 한다.
- 의도
  - 데이터 부재를 예외로 취급하는 서비스 계약을 고정한다.
- 준비 데이터
  - 존재하지 않는 ID
- 검증 포인트
  - 404 응답

#### 15. 퀴즈는 있지만 체크리스트가 없으면 404를 반환한다

- 무엇을 테스트하는가
  - 체크리스트 자체 부재 분기
- 목적
  - 빈 데이터와 미구성 상태를 명확히 구분한다.
- 의도
  - 사용자에게 “아직 체크리스트가 없다”는 도메인 상태를 정확히 전달하게 한다.
- 준비 데이터
  - 체크리스트 없는 퀴즈 1개
- 검증 포인트
  - 404 응답
  - 체크리스트 부재 메시지

### `GET /api/quizzes/:mainQuizId/multiple-choices`

#### 16. 메인 퀴즈가 있으면 객관식 문항과 선택지를 DTO로 반환한다

- 무엇을 테스트하는가
  - 객관식 조회 정상 흐름
- 목적
  - 객관식 풀이 화면의 서버 응답 계약을 보장한다.
- 의도
  - 문항/선택지 정렬과 `explanation ?? null` 매핑을 고정한다.
- 준비 데이터
  - `data-sample.json`의 `multiple_choice_quizzes[]` 또는 `quizzes[].multipleChoices[]`를 반영한 객관식 2문항 이상
  - 설명이 있는 선택지와 없는 선택지 혼합
- 검증 포인트
  - `mainQuizId`
  - `totalCount`
  - `multipleChoices[].multipleChoiceId`
  - `options[].multipleQuizOptionId`
  - 설명이 없는 옵션이 `null`로 반환되는지

#### 17. 메인 퀴즈가 없으면 404 비즈니스 오류를 반환한다

- 무엇을 테스트하는가
  - 객관식 조회의 참조 무결성 실패
- 목적
  - 잘못된 퀴즈 접근 시 명확한 에러 계약을 보장한다.
- 의도
  - `BusinessException(ERROR_MESSAGES.MAIN_QUIZ_NOT_FOUND)` 경로를 사용자 관점에서 검증한다.
- 준비 데이터
  - 존재하지 않는 ID
- 검증 포인트
  - 404 응답
  - `errorCode=MAIN_QUIZ_NOT_FOUND`

## Service 보조 테스트 시나리오

### `QuizzesService.getSolvedWithImportance()`

#### 1. 사용자가 없으면 404를 던진다

- 무엇을 테스트하는가
  - 사용자 존재 확인 분기
- 목적
  - 다른 모듈에서 이 서비스를 호출해도 기본 실패 계약이 유지되게 한다.
- 의도
  - `USER_NOT_FOUND`를 조용히 빈 결과로 삼키지 않도록 한다.
- 준비 데이터
  - 존재하지 않는 `userId`
- 검증 포인트
  - `NotFoundException`

#### 2. 중요도별로 `high`, `normal`, `low` 그룹에 매핑한다

- 무엇을 테스트하는가
  - 중요도 기반 결과 그룹핑
- 목적
  - 사용자 통계 화면이 기대하는 shape를 고정한다.
- 의도
  - mapper 로직을 private helper 테스트가 아니라 공개 서비스 계약으로 검증한다.
- 준비 데이터
  - 샘플 JSON의 solved quiz 데이터를 기반으로 한 중요도 혼합 `solvedQuiz` 3건 이상
- 검증 포인트
  - 각 그룹 배열에 올바른 퀴즈가 들어가는지
  - `category`, `mainQuizTitle`, `createdAt` 매핑 여부

### `QuizzesService.getKeywordsByQuiz()`

#### 3. 키워드가 있으면 그대로 반환한다

- 무엇을 테스트하는가
  - 퀴즈 키워드 조회 정상 흐름
- 목적
  - 현재 controller 미연결 메서드라도 서비스 계약을 최소 보장한다.
- 의도
  - 향후 controller 연결 시 회귀를 줄인다.
- 준비 데이터
  - keyword가 연결된 퀴즈 1개
- 검증 포인트
  - 반환 배열의 키워드 내용

#### 4. 퀴즈 키워드가 없으면 404를 던진다

- 무엇을 테스트하는가
  - 키워드 부재 분기
- 목적
  - 빈 배열과 미존재 상태를 구분하는 현재 계약을 고정한다.
- 의도
  - service 내부의 `NotFoundException` 경로를 명시적으로 문서화한다.
- 준비 데이터
  - 키워드가 없는 ID 또는 repository가 `null`을 돌려주는 데이터
- 검증 포인트
  - 404 예외

## 우선순위 또는 작성 순서

1. `GET /api/quizzes` 기본 목록, 필터, validation
2. `GET /api/quizzes/aggregations` 정상/validation
3. `GET /api/quizzes/:id` 정상/404/400
4. `GET /api/quizzes/:mainQuizId/checklist` 정상/두 가지 404
5. `GET /api/quizzes/:mainQuizId/multiple-choices` 정상/404
6. `GET /api/quizzes/categories`
7. `QuizzesService.getSolvedWithImportance()`
8. `QuizzesService.getKeywordsByQuiz()`
9. Docker PostgreSQL 초기화/정리 유틸과 `data-sample.json` fixture loader 공통화

## 완료 기준

- 공개 `GET /api/quizzes*` 엔드포인트별 정상 1건 이상, 대표 실패 1건 이상이 모두 문서 기준으로 테스트 코드화된다.
- query validation, path param parsing, 404 비즈니스 오류가 최소 한 번씩 실제 통합테스트로 검증된다.
- 객관식/체크리스트/집계 응답의 핵심 shape와 정렬 또는 count 규칙이 검증된다.
- `getSolvedWithImportance()`와 `getKeywordsByQuiz()`의 서비스 계약이 보조 테스트로 고정된다.
- 테스트 데이터 적재가 `data-sample.json` 포맷에서 재사용 가능하도록 정리된다.
- solved quiz 샘플도 같은 loader에서 재사용 가능하도록 정리된다.
- 기존 오래된 mock 성격 테스트와 새 통합테스트의 역할이 중복되지 않도록 정리 방침이 결정된다.
