---
name: test-integration-KentC-implement
description: Implement Kent C. Dodds style backend integration tests from an existing test design document when backend implementation is already complete. Use for controller-first integration test writing with short write-run-fix loops, Korean test names, mandatory Given/When/Then comments, final backend-wide verification, and resumable progress tracking when the API count is large.
---

# test-integration-KentC-implement

## Overview

Use this skill when all of the following are true:
- The backend implementation is already complete.
- A test design document already exists.
- The next step is to write real integration test code, not more planning.
- The user wants a Kent C. Dodds style approach.

This skill writes test code and runs it.
It is not a document-only skill.

## Core stance

- Treat the test design document as the source of truth.
- Controller or API integration tests are the default axis.
- Add service-level supporting tests only for branch-heavy or awkward-to-induce failure logic.
- Prefer short tests and small helpers over big abstractions.
- Mock only external boundaries.
- Keep the loop short: write, run, fix, run.
- If the code requires large production changes to make the tests work, stop and report.

## Required inputs

Expect all of the following:
- A backend target that is already implemented
- A test design document
- Optionally a test plan document

If both documents exist:
- Trust the design document first.
- Adjust the plan document only as needed to match the design.

If the design document is missing:
- Stop and ask for it.

## Good triggers

Use this skill for requests like:
- "설계 문서를 바탕으로 실제 통합테스트를 구현해줘"
- "문서 기준으로 테스트 코드를 쓰고 실행하면서 보완해줘"
- "Kent 방식으로 백엔드 통합테스트를 실제로 작성하고 돌려줘"
- "controller 중심 통합테스트를 구현하고 깨지는 부분을 반복 수정해줘"

## Bad triggers

Do not use this skill when:
- The feature is not implemented yet.
- The user wants only a plan or documentation.
- The user wants only RED tests.
- The user wants broad E2E product testing.
- The user wants a large production refactor first.

## Batch policy

Default to the full target scope.

However, if the number of APIs to implement is 4 or more:
- Recommend split execution.
- Split by controller or endpoint group.
- Keep strongly related endpoints in the same batch.
- Keep supporting service tests with the controller batch they belong to.

If the target has 3 or fewer APIs:
- Prefer implementing them in one pass.

## Progress tracking

When the work is split into batches, you must create and maintain a progress document.

The progress document exists so a future session can resume immediately by reading one file.

The progress document must include:
- 전체 대상 범위
- 전체 API 수
- 배치 분할 기준
- 완료된 배치
- 각 배치에서 작성된 테스트 파일
- 아직 남은 배치
- 마지막 실행 결과
- 남은 실패 또는 blocker
- 다음 시작 지점

Update the progress document:
- before split execution starts
- after each batch completes
- immediately when a blocker stops progress

Keep it short and operational.
Do not turn it into a long narrative log.

## Workflow

1. Read the test design document first.
2. Read the target implementation and confirm the observable controller surface.
3. Count the target APIs.
4. Decide full-scope or split execution using the batch policy.
5. If split execution is chosen, initialize the progress document first.
6. Write controller integration tests first.
7. Add service supporting tests only when the design document clearly requires them.
8. Keep setup inline at first.
9. Extract a helper only when the same setup repeats 2 or more times.
10. Run only the current batch's target tests.
11. Classify the failure briefly.
    - test code issue
    - fixture/helper issue
    - wiring/config issue
    - suspected production bug
12. Apply only the smallest useful fix.
13. Re-run the same target tests.
14. Repeat within the loop limit.
15. When the current batch passes, run related lint and format checks.
16. If more batches remain, update the progress document and continue.
17. After the final batch passes, run backend-wide verification.
18. Stop only after final verification passes, or when a blocker requires the user's decision.

## Loop rules

Prefer a short loop.

Recommended loop budget:
- target: 3 cycles
- hard limit: 5 cycles

If the current failure still is not resolved by 5 cycles:
- stop
- summarize the current failure
- explain the most likely root cause
- say what decision or code change is needed next

During one loop:
- fix one failure class at a time
- do not rewrite many parts at once
- do not add broad abstractions

## Verification policy

During the loop, run only:
- the target spec file or current batch spec files
- related lint
- related format check

At the very end, after all intended tests are implemented:
- run backend-wide tests
- run related lint
- run related format check

Do not run backend-wide verification on every loop.

## Production code policy

Small production changes are allowed only when they are clearly necessary and local.

Allowed examples:
- tiny wiring fixes
- obvious small bug fixes
- small testability fixes that do not change architecture

Stop and report when any of the following is true:
- a structural refactor is required
- the design document no longer fits the implementation
- many production files need to change
- the fix is no longer clearly about test implementation support

## Test writing rules

All test names must be written in Korean.

Every test must contain:
- `// Given`
- `// When`
- `// Then`

Each block must also include a short explanatory comment right below the block header.

Example:

```ts
it('정상 요청이면 피드백을 생성하고 완료 상태로 전이한다', async () => {
  // Given
  // 테스트에 필요한 사용자, 풀이 데이터, 외부 응답을 준비한다.

  // When
  // 실제 API를 호출해 피드백 생성 흐름을 실행한다.

  // Then
  // 응답과 DB 상태 전이가 기대와 일치하는지 검증한다.
});
```

Keep the explanatory comments short.
One sentence per block is enough.

## Style rules for keeping tests short

- Prefer one scenario per test.
- Prefer small local helpers over large global factories.
- Extract helpers only after repetition appears.
- Avoid generic builders unless the design document clearly implies repeated need.
- Prefer response, persistence, ownership, and state-transition assertions over call-count assertions.
- Avoid overly defensive setup.
- Do not add comments that merely restate code line by line.

## Priority order

Write tests in this order unless the design document says otherwise:
1. controller happy path
2. controller major failure paths
3. auth, ownership, guest-user branches
4. service supporting tests for branch-heavy logic

## Expected outputs

This skill should leave behind:
- integration test code
- minimal fixture or helper code when needed
- updated progress document when split execution is used
- a short execution summary or blocker report

## Recommended file placement

Follow the repo's existing test placement rules when they are clear.

If the repo does not make this obvious:
- place controller integration tests under the backend test tree
- keep helper files close to the tests that use them
- keep the progress document near the design document or in a dedicated `.codex` progress path

## Stop conditions

Stop and report instead of guessing when:
- the design document is missing
- the implementation is not actually complete
- the required test boundary is no longer clear
- the production code needs large changes
- the loop limit is exhausted
- the final backend-wide verification reveals breakage outside the current local fix scope
