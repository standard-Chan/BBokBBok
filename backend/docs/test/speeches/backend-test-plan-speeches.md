# Backend Test Plan: Speeches

## 전체 요약

- `speeches` 모듈은 네 개의 공개 HTTP 엔드포인트를 가진 쓰기/조회 혼합 API이므로 Controller 통합테스트를 기본 축으로 삼는다.
- 핵심 범위는 STT 업로드, guest 사용자 생성 및 재사용, 답변 수정 소유권, 답변 목록 조회 정렬, 텍스트 직접 저장 길이 규칙이다.
- Service 보조 테스트는 `clovaSpeechLongStt()`의 외부 STT 오류 매핑과 `getSolvedQuizInfo()`의 재사용 계약만 포함한다.
- 외부 STT API와 인증 보조만 mock하고, DB 저장 결과와 응답 계약은 실제 repository 기준으로 검증한다.

## ADR

- 결정: `speeches` 테스트는 controller 통합테스트를 먼저 작성하고, service 보조 테스트는 외부 API 오류 번역과 비HTTP 재사용 계약만 담당한다.
- 배경: 구현은 완료되어 있지만, 현재 가장 큰 위험은 업로드/수정/조회/저장 흐름이 실제 HTTP 계약대로 유지되지 않는 것이다.
- 대안:
  - service 중심은 guest cookie와 공통 예외 래퍼를 놓친다.
  - unit 중심은 DB 저장 결과와 전역 validation 회귀를 충분히 막지 못한다.
  - controller 중심은 사용자 기준 시나리오를 가장 짧은 거리로 고정한다.
- 결정 이유:
  - Kent C. Dodds 스타일은 “사용자가 보는 계약”을 먼저 고정하는 데 적합하다.
  - STT 외부 오류 매핑은 controller에서 전부 다루기보다 service 보조 테스트로 분리하는 편이 읽기 쉽다.
  - private helper는 공개 동작을 통해 간접 검증 가능하므로 테스트 계획에서 제외한다.
- 결과:
  - 테스트 우선순위가 명확해지고, 회귀를 사용자 가치 기준으로 감지할 수 있다.
  - `feedback`과 연결되는 solved quiz 조회 계약도 보조 테스트로 안정화된다.

## 한눈에 보는 테스트 범위

- 엔드포인트별
  - `POST /api/speeches/stt`: 정상 업로드, 파일 누락, MIME 오류, 파일 크기 초과, guest 쿠키 발급/재사용, 외부 STT 실패 번역
  - `PATCH /api/speeches/:mainQuizId`: 수정 성공, 빈 텍스트, 타 사용자 기록 수정 실패, 존재하지 않는 solved quiz 실패, 저장 실패
  - `GET /api/speeches/:mainQuizId`: 로그인 사용자 조회, guest 조회, 최신순 정렬, 빈 목록 반환
  - `POST /api/speeches/text/:mainQuizId`: 정상 저장, 사용자 없음, 퀴즈 없음, 답변 너무 짧음, 답변 너무 김, guest 저장
- 사용자 흐름별
  - 로그인 사용자는 자신의 `userId` 기준으로 저장/조회한다.
  - 비로그인 첫 요청은 guest user를 만들고 `guestUser` 쿠키를 받는다.
  - 비로그인 재요청은 기존 guest cookie를 재사용한다.
- 권한/소유권별
  - `PATCH`는 자기 `solvedQuiz`만 수정 가능해야 한다.
  - `GET`은 요청 사용자 기준으로 자기 기록만 조회해야 한다.
- 상태 전이별
  - `POST /stt` 성공 시 새로운 `tb_solved_quiz` 행이 생성된다.
  - `PATCH` 성공 시 기존 `speech_text`가 새 값으로 바뀐다.
  - `POST /text/:mainQuizId` 성공 시 새로운 텍스트 답변 행이 생성된다.
- 외부 의존성 오류별
  - CLOVA 401, 404, 429
  - CLOVA `result=FAILED` 중 일별 한도 초과
  - CLOVA 기타 실패와 네트워크 실패

## Controller 통합테스트 시나리오

### `POST /api/speeches/stt`

#### 1. 로그인 사용자가 유효한 오디오 파일을 올리면 STT 결과를 반환하고 solved quiz를 저장한다

- 무엇을 테스트하는가
  - 정상 업로드의 전체 흐름
- 목적
  - 말하기 답변의 가장 핵심 저장 경로를 고정한다.
- 의도
  - multipart 업로드, user 해석, 외부 STT 성공 결과, DB 저장, 응답 DTO가 한 번에 이어지는지 보장한다.
- 준비 데이터
  - 로그인 사용자 1명
  - 존재하는 `mainQuiz`
  - 유효한 `audio/webm` 파일
  - 성공하는 CLOVA 응답 mock
- 검증 포인트
  - 201 또는 실제 구현의 성공 status
  - `success=true`
  - `data.solvedQuizId`, `data.text`
  - DB에 해당 사용자와 퀴즈로 `solvedQuiz` 1건 생성

#### 2. 비로그인 첫 요청이면 guest 사용자를 만들고 쿠키를 내려준다

- 무엇을 테스트하는가
  - guest 최초 생성 흐름
- 목적
  - 비회원도 STT 기능을 사용할 수 있는 계약을 고정한다.
- 의도
  - 인증이 없어도 guest fallback이 동작하고 이후 재조회 가능한 사용자가 생성되는지 확인한다.
- 준비 데이터
  - 쿠키 없는 요청
  - 존재하는 `mainQuiz`
  - 유효한 오디오 파일
  - 성공하는 CLOVA 응답 mock
- 검증 포인트
  - 성공 응답
  - `Set-Cookie: guestUser=...`
  - 생성된 `solvedQuiz.userId`가 새 guest 사용자와 연결되는지

#### 3. 비로그인 재요청에서 유효한 guest 쿠키가 있으면 기존 guest를 재사용한다

- 무엇을 테스트하는가
  - guest cookie 재사용
- 목적
  - guest 사용자의 답변 이력이 요청마다 분리되지 않게 한다.
- 의도
  - `findUserByUuid()` 기반 해석이 유지되는지 확인한다.
- 준비 데이터
  - 기존 guest 사용자와 uuid
  - `guestUser` 쿠키를 포함한 요청
  - 유효한 오디오 파일
  - 성공하는 CLOVA 응답 mock
- 검증 포인트
  - 성공 응답
  - 새 guest가 추가로 생성되지 않는지
  - 새 `solvedQuiz`가 기존 guest 사용자에 연결되는지

#### 4. 오디오 파일이 없으면 `MISSING_RECORD_FILE` 오류를 반환한다

- 무엇을 테스트하는가
  - 파일 누락 분기
- 목적
  - 잘못된 업로드 요청을 조기에 차단한다.
- 의도
  - controller의 명시적 파일 존재 검증을 고정한다.
- 준비 데이터
  - `mainQuizId`만 있는 요청
- 검증 포인트
  - 400 응답
  - `errorCode=MISSING_RECORD_FILE`

#### 5. 지원하지 않는 MIME 타입이면 업로드를 거절한다

- 무엇을 테스트하는가
  - 파일 형식 검증
- 목적
  - 서버가 허용하지 않는 오디오 형식을 명확히 실패시키게 한다.
- 의도
  - 파일 자체는 존재하지만 도메인 규칙을 어긴 경우를 고정한다.
- 준비 데이터
  - `video/mp4` 등 비허용 MIME 파일
  - 성공 호출 대신 service validation까지 도달 가능한 요청
- 검증 포인트
  - 415 응답
  - 오류 메시지에 MIME 타입 정보 포함

#### 6. 파일 크기가 제한을 넘으면 업로드를 거절한다

- 무엇을 테스트하는가
  - 파일 크기 제한
- 목적
  - 과도한 업로드가 저장 흐름으로 내려가지 않게 한다.
- 의도
  - Multer 제한과 service 자체 방어 중 어느 레이어가 처리하더라도 observable 계약을 고정한다.
- 준비 데이터
  - 8MB 초과 파일
- 검증 포인트
  - 413 또는 실제 구현의 실패 status
  - 대용량 업로드 실패 메시지

#### 7. 외부 STT가 실패하면 비즈니스 오류 계약으로 번역된다

- 무엇을 테스트하는가
  - 대표적인 외부 오류 전파
- 목적
  - 프론트가 STT 실패를 일관되게 처리할 수 있게 한다.
- 의도
  - controller에서는 대표 오류만 확인하고, 상세 상태코드 분기는 service 보조 테스트로 내린다.
- 준비 데이터
  - 정상 사용자/퀴즈/오디오 파일
  - 실패하는 CLOVA 응답 mock
- 검증 포인트
  - 502 또는 429 등 기대 status
  - `errorCode`가 외부 API 계열 값인지
  - DB에 solved quiz가 남지 않는지

### `PATCH /api/speeches/:mainQuizId`

#### 8. 로그인 사용자가 자신의 solved quiz를 수정하면 새 speech text를 반환하고 DB를 갱신한다

- 무엇을 테스트하는가
  - 수정 정상 흐름
- 목적
  - STT 후 수동 보정 기능의 핵심 계약을 고정한다.
- 의도
  - 요청 body, 사용자 소유권, DB update, 응답 DTO가 연결되는지 검증한다.
- 준비 데이터
  - 사용자 소유 `solvedQuiz`
  - 유효한 `speechText`
- 검증 포인트
  - 200 응답
  - `data.mainQuizId`, `data.solvedQuizId`, `data.speechText`
  - DB의 `speech_text`가 수정되었는지

#### 9. 수정 텍스트가 비어 있으면 실패한다

- 무엇을 테스트하는가
  - 빈 문자열 수정 방지
- 목적
  - 사용자가 의미 없는 빈 답변으로 기록을 덮어쓰지 못하게 한다.
- 의도
  - service의 `trim().length === 0` 검증을 HTTP 계약으로 고정한다.
- 준비 데이터
  - 사용자 소유 `solvedQuiz`
  - `speechText=""` 또는 공백 문자열
- 검증 포인트
  - 400 응답
  - DB 값이 변경되지 않는지

#### 10. 다른 사용자의 solved quiz를 수정하려 하면 실패한다

- 무엇을 테스트하는가
  - 소유권 검증
- 목적
  - 답변 기록이 사용자 간에 수정되지 않게 한다.
- 의도
  - `solvedQuiz.userId` 기반 권한 체크를 고정한다.
- 준비 데이터
  - 사용자 A 소유 `solvedQuiz`
  - 사용자 B 또는 guest로 요청
- 검증 포인트
  - 400 응답
  - 권한 없음 메시지
  - DB 변경 없음

#### 11. 존재하지 않는 solved quiz를 수정하려 하면 실패한다

- 무엇을 테스트하는가
  - solved quiz 부재 분기
- 목적
  - 잘못된 기록 수정 요청을 명확히 실패시킨다.
- 의도
  - `getById()` 부재가 성공처럼 보이지 않게 한다.
- 준비 데이터
  - 존재하지 않는 `solvedQuizId`
- 검증 포인트
  - 400 응답
  - DB 변경 없음

#### 12. 저장소 update 실패 시 500을 반환한다

- 무엇을 테스트하는가
  - 수정 저장 실패
- 목적
  - 수정 성공처럼 보이지만 DB에는 남지 않는 상태를 막는다.
- 의도
  - repository update 실패가 조용히 삼켜지지 않는지 확인한다.
- 준비 데이터
  - 정상 fixture
  - update 실패를 유도하는 repository stub 또는 fixture
- 검증 포인트
  - 500 응답
  - 실패 메시지

### `GET /api/speeches/:mainQuizId`

#### 13. 로그인 사용자는 자신의 답변 목록만 최신순으로 조회한다

- 무엇을 테스트하는가
  - 목록 조회 정상 흐름
- 목적
  - 말하기 기록 목록 화면의 기본 계약을 고정한다.
- 의도
  - 같은 퀴즈에 대한 자기 기록만 내려오고 최신순 정렬이 유지되는지 보장한다.
- 준비 데이터
  - 같은 `mainQuizId`에 대한 사용자 소유 `solvedQuiz` 2건 이상
  - createdAt 차이가 명확한 seed
- 검증 포인트
  - 200 응답
  - `data.quizId`
  - `data.speeches[].solvedQuizId`
  - `data.speeches[].createdAt`이 내림차순인지

#### 14. 비로그인 요청은 guest 기준으로 자신의 답변 목록을 조회한다

- 무엇을 테스트하는가
  - guest 목록 조회
- 목적
  - 비회원 사용자가 자신의 말하기 기록을 다시 볼 수 있게 한다.
- 의도
  - guest cookie 기반 사용자 식별이 조회에서도 일관되게 동작하는지 확인한다.
- 준비 데이터
  - guest 사용자와 해당 guest 소유 `solvedQuiz`
  - `guestUser` 쿠키
- 검증 포인트
  - 200 응답
  - 다른 사용자 기록이 섞이지 않는지

#### 15. 기록이 없으면 빈 배열을 반환한다

- 무엇을 테스트하는가
  - 빈 목록 처리
- 목적
  - 기록 부재를 예외가 아닌 빈 조회 결과로 다루는 현재 계약을 고정한다.
- 의도
  - 프론트가 “아직 답변 없음” 상태를 안정적으로 그릴 수 있게 한다.
- 준비 데이터
  - 해당 사용자와 퀴즈 조합에 `solvedQuiz` 없음
- 검증 포인트
  - 200 응답
  - `data.speeches=[]`

### `POST /api/speeches/text/:mainQuizId`

#### 16. 로그인 사용자가 길이 조건을 만족하는 텍스트 답변을 보내면 solved quiz를 생성한다

- 무엇을 테스트하는가
  - 텍스트 직접 저장 정상 흐름
- 목적
  - 음성 없이도 말하기 답변을 기록하는 대체 경로를 고정한다.
- 의도
  - 사용자/퀴즈 존재 확인과 길이 규칙을 통과한 입력이 저장되는지 보장한다.
- 준비 데이터
  - 로그인 사용자
  - 존재하는 `mainQuiz`
  - 50자 이상 1500자 이하 `speechText`
- 검증 포인트
  - 201 또는 실제 성공 status
  - `data.mainQuizId`, `data.solvedQuizId`
  - DB에 새 `solvedQuiz` 생성

#### 17. 비로그인 요청이면 guest 사용자를 만들고 텍스트 답변을 저장한다

- 무엇을 테스트하는가
  - guest 텍스트 저장 흐름
- 목적
  - 비회원도 텍스트 기반 말하기 연습을 남길 수 있게 한다.
- 의도
  - STT 경로와 동일한 guest fallback이 텍스트 경로에서도 유지되는지 확인한다.
- 준비 데이터
  - 쿠키 없는 요청
  - 존재하는 `mainQuiz`
  - 유효한 `speechText`
- 검증 포인트
  - 성공 응답
  - `Set-Cookie: guestUser=...`
  - guest 사용자 기준 DB 저장

#### 18. 사용자가 없으면 `USER_NOT_FOUND`를 반환한다

- 무엇을 테스트하는가
  - 사용자 부재 분기
- 목적
  - 손상된 인증/guest 해석 상태를 명확히 실패시키게 한다.
- 의도
  - 저장 전에 사용자 존재가 검증되는지 고정한다.
- 준비 데이터
  - 존재하지 않는 `userId`를 반환하도록 구성된 요청 컨텍스트
- 검증 포인트
  - 404 응답
  - `errorCode=USER_NOT_FOUND`

#### 19. 퀴즈가 없으면 `MAIN_QUIZ_NOT_FOUND`를 반환한다

- 무엇을 테스트하는가
  - 퀴즈 부재 분기
- 목적
  - 잘못된 퀴즈 참조를 저장 흐름에서 차단한다.
- 의도
  - `mainQuiz` 검증이 길이 검증과 저장보다 먼저 동작하는지 확인한다.
- 준비 데이터
  - 존재하지 않는 `mainQuizId`
  - 유효한 사용자
  - 유효한 길이의 `speechText`
- 검증 포인트
  - 404 응답
  - `errorCode=MAIN_QUIZ_NOT_FOUND`

#### 20. 답변이 너무 짧으면 `ANSWER_TOO_SHORT`를 반환한다

- 무엇을 테스트하는가
  - 최소 글자수 검증
- 목적
  - 너무 짧은 텍스트가 기록되지 않게 한다.
- 의도
  - 서비스 도메인 규칙을 HTTP 계약으로 고정한다.
- 준비 데이터
  - 49자 이하 `speechText`
- 검증 포인트
  - 400 응답
  - `errorCode=ANSWER_TOO_SHORT`
  - DB 저장 없음

#### 21. 답변이 너무 길면 `ANSWER_TOO_LONG`을 반환한다

- 무엇을 테스트하는가
  - 최대 글자수 검증
- 목적
  - 과도한 답변이 저장되지 않게 한다.
- 의도
  - 최대 길이 상한이 회귀하지 않도록 한다.
- 준비 데이터
  - 1501자 이상 `speechText`
- 검증 포인트
  - 400 응답
  - `errorCode=ANSWER_TOO_LONG`
  - DB 저장 없음

## Service 보조 테스트 시나리오

### `SpeechesService.clovaSpeechLongStt()`

#### 22. CLOVA 401은 `EXTERNAL_API_UNAUTHORIZED`로 번역한다

- 무엇을 테스트하는가
  - 외부 인증 실패 매핑
- 목적
  - 외부 권한 오류가 내부 500으로 뭉개지지 않게 한다.
- 의도
  - 상태 코드별 비즈니스 오류 번역을 고정한다.
- 준비 데이터
  - 유효한 오디오 파일
  - `fetch` 401 응답 mock
- 검증 포인트
  - 401 성격의 `BusinessException`
  - `errorCode=EXTERNAL_API_UNAUTHORIZED`

#### 23. CLOVA 404는 `EXTERNAL_API_FORBIDDEN`으로 번역한다

- 무엇을 테스트하는가
  - 외부 404 매핑
- 목적
  - 현재 구현이 가진 매핑 계약을 그대로 문서화한다.
- 의도
  - 코드 변경 시 의도치 않은 에러 코드 회귀를 막는다.
- 준비 데이터
  - `fetch` 404 응답 mock
- 검증 포인트
  - `errorCode=EXTERNAL_API_FORBIDDEN`

#### 24. CLOVA 429는 `EXTERNAL_API_RATE_LIMIT_EXCEEDED`로 번역한다

- 무엇을 테스트하는가
  - rate limit 매핑
- 목적
  - 과요청 상황을 프론트가 구분 처리할 수 있게 한다.
- 의도
  - 429 응답 계약을 명확히 고정한다.
- 준비 데이터
  - `fetch` 429 응답 mock
- 검증 포인트
  - `errorCode=EXTERNAL_API_RATE_LIMIT_EXCEEDED`

#### 25. CLOVA가 `result=FAILED`와 일별 한도 메시지를 주면 `EXTERNAL_API_DAILY_QUOTA_EXCEEDED`를 반환한다

- 무엇을 테스트하는가
  - body.result 기반 실패 분기
- 목적
  - HTTP status만으로 드러나지 않는 한도 초과 케이스를 놓치지 않는다.
- 의도
  - 구현의 특수 분기를 집중적으로 고정한다.
- 준비 데이터
  - `ok=true`
  - `json={ result: 'FAILED', message: '일별 한도 ...' }`
- 검증 포인트
  - `errorCode=EXTERNAL_API_DAILY_QUOTA_EXCEEDED`

#### 26. 네트워크 실패나 기타 비예상 오류는 `EXTERNAL_API_SERVER_ERROR`로 번역한다

- 무엇을 테스트하는가
  - fetch 자체 실패 분기
- 목적
  - 외부 장애가 공통 계약으로 수렴하는지 보장한다.
- 의도
  - 예기치 못한 에러 타입 변화에도 프론트 계약을 안정화한다.
- 준비 데이터
  - `fetch` reject mock
- 검증 포인트
  - `errorCode=EXTERNAL_API_SERVER_ERROR`

#### 27. 환경변수가 없으면 내부 서버 오류를 반환한다

- 무엇을 테스트하는가
  - CLOVA 설정 누락 분기
- 목적
  - 설정 문제를 조기에 드러내게 한다.
- 의도
  - 운영 환경 미설정이 외부 API 오류로 잘못 분류되지 않도록 한다.
- 준비 데이터
  - `ConfigService`가 URL 또는 secretKey를 반환하지 않음
- 검증 포인트
  - `InternalServerErrorException`
  - 환경변수 누락 메시지

### `SpeechesService.getSolvedQuizInfo()`

#### 28. solved quiz가 존재하면 speech text를 반환한다

- 무엇을 테스트하는가
  - `feedback` 모듈이 재사용하는 조회 계약
- 목적
  - 다른 모듈이 의존하는 최소 계약을 고정한다.
- 의도
  - 단순 조회지만 재사용 지점이 있으므로 회귀 비용을 줄인다.
- 준비 데이터
  - `speechText`가 저장된 `solvedQuiz`
- 검증 포인트
  - 반환 문자열이 저장값과 일치하는지

#### 29. solved quiz가 없으면 404를 반환한다

- 무엇을 테스트하는가
  - 재사용 계약의 부재 분기
- 목적
  - 피드백 생성에서 잘못된 solved quiz를 명확히 차단한다.
- 의도
  - null 반환이 아닌 예외 계약을 고정한다.
- 준비 데이터
  - 존재하지 않는 `solvedQuizId`
- 검증 포인트
  - `NotFoundException`

## 우선순위 또는 작성 순서

1. `POST /api/speeches/stt` 정상/실패/guest 시나리오
2. `POST /api/speeches/text/:mainQuizId` 정상/길이 검증/guest 시나리오
3. `PATCH /api/speeches/:mainQuizId` 소유권/빈 텍스트/저장 실패 시나리오
4. `GET /api/speeches/:mainQuizId` 로그인/guest/빈 목록/정렬 시나리오
5. `SpeechesService.clovaSpeechLongStt()` 외부 오류 매핑
6. `SpeechesService.getSolvedQuizInfo()` 재사용 계약

## 완료 기준

- 네 개의 controller 엔드포인트에 대해 정상 1개 이상, 대표 실패 1개 이상, guest 흐름이 있는 경우 guest 시나리오가 모두 존재한다.
- STT 경로는 파일 누락, MIME 오류, 파일 크기 오류, 외부 실패 번역 중 최소 핵심 케이스가 포함된다.
- 텍스트 저장과 수정 경로는 소유권 및 길이 규칙 회귀를 막는 테스트가 포함된다.
- service 보조 테스트는 CLOVA 오류 매핑과 `getSolvedQuizInfo()` 재사용 계약을 포함한다.
- 문서 기준 테스트를 구현했을 때, 응답 body뿐 아니라 DB 저장 결과 또는 미저장 결과까지 검증하도록 설계되어 있다.
