---
name: test-integration-kentC
description: Create Kent C. Dodds style backend integration-test design documents when implementation is already complete but no tests exist yet. Use for backend services or APIs where controller-level integration tests should be the default axis, service-level tests should be added only for branch-heavy logic, and the required outputs are a design document plus a test plan document, both in Korean, each with a top summary and an ADR section explaining the intent and rationale.
---

# test-integration-kentC

## Overview

Use this skill when all of the following are true:
- The backend implementation is already complete.
- There are little or no tests yet.
- The user wants Kent C. Dodds style test design.
- The best next step is to design integration tests first, not write unit tests first.

This skill produces documents only.
Do not write test code while using this skill.

## Core stance

- Default to controller or API integration tests.
- Test what the user can observe before testing internal helpers.
- Prefer real repository and database wiring when planning integration tests.
- Mock only external boundaries such as third-party SDKs, network APIs, queues, or Redis.
- Add service-level tests only when controller-level tests would become too heavy or too blurry for a branch-heavy rule.
- Do not plan private method tests.

## Good triggers

Use this skill for requests like:
- "구현은 끝났고 테스트가 하나도 없는데 통합테스트 설계부터 하자"
- "Kent C Dodds 방식으로 백엔드 테스트 문서 작성해줘"
- "controller 중심으로 통합테스트 계획을 세우고 싶다"
- "기능은 완성됐고 이제 테스트 설계 문서와 계획 문서를 만들고 싶다"

## Bad triggers

Do not use this skill when:
- The feature is not implemented yet.
- The user wants RED-phase failing tests first.
- The user wants GREEN implementation from existing RED tests.
- The request is mainly frontend, E2E product flows, or visual regression.
- The user only wants isolated unit tests around helpers or utilities.

## Workflow

1. Confirm from the repo that the target backend implementation already exists.
2. Inspect the main observable entrypoints first.
   - controllers
   - routes
   - request and response DTOs
   - service orchestration
   - repository calls
   - auth or guest-user branches
3. Identify the default controller-level integration-test surface.
4. Identify which service methods deserve separate supporting tests.
   - many business-error branches
   - heavy external API error mapping
   - failure states that are awkward to induce through HTTP only
5. Fix the integration-test boundary.
   - real app or module wiring
   - real repositories and DB if feasible
   - external systems only as test doubles
6. Produce two documents in Korean.
   - test design document
   - test plan document
7. Stop after the documents are complete.

## Non-negotiable rules

- Always write the outputs in Korean unless the user explicitly requests another language.
- Always create both documents together.
- Both documents must start with a short overall summary section.
- Both documents must include an ADR section that states why the structure was chosen.
- The test plan document must make it easy to grasp what will be tested at a glance.
- Separate "purpose" and "intent" for each major scenario.
- Keep controller integration tests as the primary test axis.
- Service tests are supporting tests, not the default.
- Prefer behavior grouping over file-by-file inventories.
- Do not overfocus on call-count assertions.
- Prefer response contracts, persistence results, state transitions, ownership rules, and external-boundary handling.

## Document set

Produce exactly these two artifacts.

### 1. Test design document

This document explains how the test suite should be structured.

Required sections:
1. 전체 요약
2. ADR
3. 테스트 대상 개요
4. 테스트 경계
5. Controller 통합테스트를 기본 축으로 두는 이유
6. Service 보조 테스트를 분리하는 기준
7. 테스트 데이터와 fixture 전략
8. mock 경계
9. 테스트 파일 구조 제안
10. 리스크 또는 주의점

What ADR must cover:
- Why controller integration tests are the default
- Why service tests are only supporting tests
- Why Kent C. Dodds style is appropriate after implementation is already complete
- Why private helpers are excluded

### 2. Test plan document

This document lists what will be tested.

Required sections:
1. 전체 요약
2. ADR
3. 한눈에 보는 테스트 범위
4. Controller 통합테스트 시나리오
5. Service 보조 테스트 시나리오
6. 우선순위 또는 작성 순서
7. 완료 기준

The "한눈에 보는 테스트 범위" section must be scannable.
Use one or more of these views:
- 엔드포인트별
- 사용자 흐름별
- 권한/소유권별
- 상태 전이별
- 외부 의존성 오류별

For each major scenario, include:
- 무엇을 테스트하는가
- 목적
- 의도
- 준비 데이터
- 검증 포인트

## Decision rules for test layering

Choose controller integration tests first when the behavior is visible through:
- HTTP endpoints
- request validation and parsing
- auth or guest-user resolution
- response composition
- DB write or read side effects

Add service supporting tests only when at least one is true:
- The method has many business branches.
- External API error mapping needs focused coverage.
- Persistence failure branches are expensive to induce through controller tests alone.
- The same rule would otherwise require many repetitive controller fixtures.

Do not create service supporting tests for simple pass-through orchestration.

## Output style

- Keep the documents concise but decision-complete.
- Put the highest-signal summary first.
- Group related scenarios together.
- Use clear headings and flat bullet lists.
- Prefer domain terms over testing jargon when both are possible.

## Default template

Use this skeleton and adapt it to the target module.

```md
# <문서 제목>

## 전체 요약
- 이 문서가 다루는 테스트 범위
- controller 중심 여부
- service 보조 테스트 포함 여부
- 외부 mock 경계

## ADR
- 결정: 무엇을 기본 축으로 삼았는가
- 배경: 현재 구현 상태와 테스트 부재 상태
- 대안: unit 중심, service 중심, controller 중심 중 무엇을 비교했는가
- 결정 이유: 왜 이 구조가 지금 가장 적합한가
- 결과: 테스트 유지보수성과 신뢰도에 어떤 영향을 주는가
```

For the test plan document, add a scannable summary near the top such as:

```md
## 한눈에 보는 테스트 범위
- `POST /...`: 정상 생성, 입력 실패, 외부 API 오류, 상태 전이
- `GET /...`: 조회 성공, 권한 실패, guest 흐름
- `ServiceName.method()`: 저장 실패, 외부 응답 파싱 실패
```

## Stop conditions

Stop and ask the user instead of guessing when:
- The implementation is not actually complete.
- The target surface is unclear and multiple unrelated modules are plausible.
- The user wants code, not documents.
- The repo structure suggests a non-HTTP backend surface and the correct primary integration boundary is ambiguous.
