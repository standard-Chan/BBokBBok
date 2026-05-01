# Docker 기반 Backend 통합 테스트

`backend`의 e2e 테스트는 테스트 전용 `Postgres + Redis` 컨테이너를 사용한다.

## 실행 순서

1. 저장소 루트에서 테스트용 인프라 실행
   `docker compose -f docker-compose.test.yml up -d`
2. `backend` 디렉터리에서 e2e 테스트 실행
   `npm run test:e2e:docker`
3. 종료 후 테스트 인프라 정리
   `docker compose -f docker-compose.test.yml down`

## 구성

- `backend/.env.test`
  테스트 전용 DB/Redis/JWT 환경변수
- `docker-compose.test.yml`
  테스트 전용 `postgres-test`, `redis-test` 컨테이너
- `backend/test/auth-docker.e2e-spec.ts`
  `POST /api/auth/login/test`와 `POST /api/auth/refresh`를 통해 Postgres와 Redis 연동을 실제로 검증

## 동작 방식

애플리케이션은 `DB_MIGRATIONS_RUN=true`일 때 시작 시점에 TypeORM 마이그레이션을 자동 실행한다. 따라서 테스트 시작 전에 별도 migration 명령을 수동 실행할 필요는 없다.
