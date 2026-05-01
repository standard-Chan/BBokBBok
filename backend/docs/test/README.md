# Docker 기반 Backend 통합 테스트

`backend`의 Docker e2e 테스트는 테스트 전용 `Postgres` 컨테이너를 사용한다.

## 실행 순서

1. 저장소 루트에서 테스트용 인프라 실행
   `docker compose -f docker-compose.test.yml up -d`
2. `backend` 디렉터리에서 e2e 테스트 실행
   `npm run test:e2e:docker`
3. 종료 후 테스트 인프라 정리
   `docker compose -f docker-compose.test.yml down`

## 구성

- `backend/.env.test`
  테스트 전용 DB/JWT 환경변수
- `docker-compose.test.yml`
  테스트 전용 `postgres-test` 컨테이너
- `backend/test/auth-docker.e2e-spec.ts`
  `GET /api/quizzes/categories`를 통해 Postgres 연동을 실제로 검증

## 동작 방식

테스트는 `QuizModule`만 띄우고 시작 시점에 TypeORM 마이그레이션을 자동 실행한다. 각 테스트는 카테고리 데이터를 직접 적재한 뒤 HTTP 요청으로 조회 결과를 검증한다.
