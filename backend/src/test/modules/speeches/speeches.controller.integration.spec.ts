import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { SpeechesController } from '../../../modules/speeches/speeches.controller';
import { SpeechesService } from '../../../modules/speeches/speeches.service';
import { AuthService } from '../../../modules/auth/auth.service';
import { ApiResponseInterceptor } from 'src/common/interceptors/api-response.interceptor';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';
import { UserRepository } from 'src/datasources/repositories/tb-user.repository';
import { MainQuizRepository } from 'src/datasources/repositories/tb-main-quiz.repository';
import { SolvedQuizRepository } from 'src/datasources/repositories/tb-solved-quiz.repository';
import { ERROR_MESSAGES } from 'src/common/constants/error-messages';
import {
  MAX_USER_ANSWER_LENGTH,
  MIN_USER_ANSWER_LENGTH,
} from 'src/common/constants/speech.constants';
import {
  DifficultyLevel,
  MainQuiz,
} from 'src/datasources/entities/tb-main-quiz.entity';
import { SolvedQuiz } from 'src/datasources/entities/tb-solved-quiz.entity';
import { Provider, User } from 'src/datasources/entities/tb-user.entity';

type ApiSuccess<T> = {
  success: true;
  message: string;
  errorCode: null;
  data: T;
};

type ApiFailure = {
  success: false;
  message: string;
  errorCode: string;
  data: unknown;
};

type MutableRequest = Request & { user?: User };

const loggerMock = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

const configServiceMock = {
  get: jest.fn((key: string) => {
    if (key === 'NAVER_CLOVA_SPEECH_INVOKE_URL') return 'https://clova.test';
    if (key === 'NAVER_CLOVA_SPEECH_SECRET_KEY') return 'secret-key';
    if (key === 'NAVER_CLOVA_SPEECH_DEFAULT_LANG') return 'ko-KR';
    return undefined;
  }),
};

const createUserEntity = (
  userId: number,
  provider: Provider = Provider.NAVER,
  uuid = `uuid-${userId}`,
): User =>
  ({
    userId,
    uuid,
    username: `user-${userId}`,
    provider,
    providerId: `${provider.toLowerCase()}-${userId}`,
    createdBy: 0,
    solvedQuizzes: [],
  }) as User;

const createMainQuizEntity = (mainQuizId: number): MainQuiz =>
  ({
    mainQuizId,
    title: `질문 ${mainQuizId}`,
    content: `질문 ${mainQuizId} 설명`,
    difficultyLevel: DifficultyLevel.MEDIUM,
    quizCategory: {
      quizCategoryId: 1,
      name: '백엔드',
    },
    keywords: [],
    checklistItems: [],
    solvedQuizzes: [],
  }) as MainQuiz;

const createAudioFile = (
  contents: Buffer | string,
  mimetype = 'audio/webm',
  filename = 'answer.webm',
) => ({
  buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
  filename,
  contentType: mimetype,
});

describe('SpeechesController Integration', () => {
  let app: INestApplication;

  const userStore = new Map<number, User>();
  const guestUuidStore = new Map<string, User>();
  const mainQuizStore = new Map<number, MainQuiz>();
  const solvedQuizStore = new Map<number, SolvedQuiz>();

  let nextSolvedQuizId = 1;
  let nextGuestUserId = 900;
  let updateShouldFail = false;

  const setFetchMock = (mock: jest.MockedFunction<typeof fetch>) => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock;
  };

  const clearFetchMock = () => {
    delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  };

  const seedUser = (
    userId: number,
    provider: Provider = Provider.NAVER,
    uuid = `uuid-${userId}`,
  ) => {
    const user = createUserEntity(userId, provider, uuid);
    userStore.set(userId, user);
    guestUuidStore.set(uuid, user);
    return user;
  };

  const seedMainQuiz = (mainQuizId: number) => {
    const quiz = createMainQuizEntity(mainQuizId);
    mainQuizStore.set(mainQuizId, quiz);
    return quiz;
  };

  const seedSolvedQuiz = ({
    userId,
    mainQuizId,
    speechText,
    createdAt,
  }: {
    userId: number;
    mainQuizId: number;
    speechText: string;
    createdAt?: Date;
  }) => {
    const solvedQuiz = {
      solvedQuizId: nextSolvedQuizId++,
      user: userStore.get(userId)!,
      mainQuiz: mainQuizStore.get(mainQuizId)!,
      speechText,
      createdAt: createdAt ?? new Date(),
    } as SolvedQuiz;
    solvedQuizStore.set(solvedQuiz.solvedQuizId, solvedQuiz);
    return solvedQuiz;
  };

  const authServiceMock = {
    findUserByUuid: jest.fn((uuid: string) =>
      Promise.resolve(guestUuidStore.get(uuid) ?? null),
    ),
    createGuestUser: jest.fn(() => {
      const guestUser = createUserEntity(
        nextGuestUserId,
        Provider.GUEST,
        `guest-uuid-${nextGuestUserId}`,
      );
      nextGuestUserId += 1;
      userStore.set(guestUser.userId, guestUser);
      guestUuidStore.set(guestUser.uuid, guestUser);
      return Promise.resolve(guestUser);
    }),
  };

  const userRepositoryMock = {
    findById: jest.fn((userId: number) =>
      Promise.resolve(userStore.get(userId) ?? null),
    ),
  };

  const mainQuizRepositoryMock = {
    findById: jest.fn((mainQuizId: number) =>
      Promise.resolve(mainQuizStore.get(mainQuizId) ?? null),
    ),
  };

  const solvedQuizRepositoryMock = {
    createSolvedQuiz: jest.fn(
      ({
        user,
        mainQuiz,
        speechText,
      }: {
        user: { userId: number };
        mainQuiz: { mainQuizId: number };
        speechText: string;
      }) =>
        Promise.resolve(
          seedSolvedQuiz({
            userId: user.userId,
            mainQuizId: mainQuiz.mainQuizId,
            speechText,
          }),
        ),
    ),
    getByQuizAndUser: jest.fn((mainQuizId: number, userId: number) =>
      Promise.resolve(
        [...solvedQuizStore.values()]
          .filter(
            (solvedQuiz) =>
              solvedQuiz.mainQuiz.mainQuizId === mainQuizId &&
              solvedQuiz.user.userId === userId,
          )
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime(),
          ),
      ),
    ),
    updateSpeechText: jest.fn((solvedQuizId: number, speechText: string) => {
      if (updateShouldFail) {
        return Promise.resolve(false);
      }

      const solvedQuiz = solvedQuizStore.get(solvedQuizId);
      if (!solvedQuiz) {
        return Promise.resolve(false);
      }

      solvedQuiz.speechText = speechText;
      return Promise.resolve(true);
    }),
    getById: jest.fn((solvedQuizId: number) =>
      Promise.resolve(solvedQuizStore.get(solvedQuizId) ?? null),
    ),
    getSpeechTextById: jest.fn((solvedQuizId: number) =>
      Promise.resolve(solvedQuizStore.get(solvedQuizId)?.speechText ?? null),
    ),
  };

  const httpServer = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SpeechesController],
      providers: [
        SpeechesService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: UserRepository,
          useValue: userRepositoryMock,
        },
        {
          provide: MainQuizRepository,
          useValue: mainQuizRepositoryMock,
        },
        {
          provide: SolvedQuizRepository,
          useValue: solvedQuizRepositoryMock,
        },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: loggerMock,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.use((req: Request, _res: Response, next: () => void) => {
      const userIdHeader = req.header('x-test-user-id');
      if (userIdHeader) {
        const userId = Number(userIdHeader);
        (req as MutableRequest).user =
          userStore.get(userId) ?? createUserEntity(userId);
      }
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter(loggerMock));
    app.setGlobalPrefix('api');

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearFetchMock();
    userStore.clear();
    guestUuidStore.clear();
    mainQuizStore.clear();
    solvedQuizStore.clear();
    nextSolvedQuizId = 1;
    nextGuestUserId = 900;
    updateShouldFail = false;

    seedUser(101);
    seedUser(202);
    seedUser(303, Provider.GUEST, 'guest-uuid-303');
    seedMainQuiz(1);
    seedMainQuiz(2);
  });

  afterAll(async () => {
    clearFetchMock();
    await app.close();
  });

  describe('POST /api/speeches/stt', () => {
    it('로그인 사용자가 유효한 오디오 파일을 올리면 STT 결과를 반환하고 solved quiz를 저장한다', async () => {
      // Given
      // 로그인 사용자와 유효한 오디오 파일, 성공하는 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          result: 'COMPLETED',
          text: '로그인 사용자 답변입니다.',
        }),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // multipart 업로드로 STT API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .set('x-test-user-id', '101')
        .field('mainQuizId', '1')
        .attach('audio', createAudioFile('valid audio').buffer, {
          filename: 'answer.webm',
          contentType: 'audio/webm',
        });

      // Then
      // 성공 응답과 저장된 solved quiz의 소유자 및 텍스트를 검증한다.
      expect(response.status).toBe(201);
      const body = response.body as ApiSuccess<{
        solvedQuizId: number;
        text: string;
      }>;
      expect(body.success).toBe(true);
      expect(body.data.text).toBe('로그인 사용자 답변입니다.');

      const savedSolvedQuiz = solvedQuizStore.get(body.data.solvedQuizId);
      expect(savedSolvedQuiz?.user.userId).toBe(101);
      expect(savedSolvedQuiz?.mainQuiz.mainQuizId).toBe(1);
      expect(savedSolvedQuiz?.speechText).toBe('로그인 사용자 답변입니다.');
    });

    it('비로그인 첫 요청이면 guest 사용자를 만들고 쿠키를 내려준다', async () => {
      // Given
      // 로그인 정보가 없는 요청과 성공하는 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          result: 'COMPLETED',
          text: '게스트 첫 답변입니다.',
        }),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 쿠키 없이 STT 업로드를 요청한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .field('mainQuizId', '1')
        .attach('audio', createAudioFile('guest audio').buffer, {
          filename: 'guest.webm',
          contentType: 'audio/webm',
        });

      // Then
      // guest 쿠키가 발급되고 저장된 답변이 guest 사용자에 연결되는지 검증한다.
      expect(response.status).toBe(201);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('guestUser=')]),
      );

      const body = response.body as ApiSuccess<{
        solvedQuizId: number;
        text: string;
      }>;
      const savedSolvedQuiz = solvedQuizStore.get(body.data.solvedQuizId);
      expect(savedSolvedQuiz?.user.provider).toBe(Provider.GUEST);
      expect(authServiceMock.createGuestUser).toHaveBeenCalledTimes(1);
    });

    it('비로그인 재요청에서 유효한 guest 쿠키가 있으면 기존 guest를 재사용한다', async () => {
      // Given
      // 기존 guest 사용자와 그 uuid 쿠키, 성공하는 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          result: 'COMPLETED',
          text: '기존 게스트 답변입니다.',
        }),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 기존 guest 쿠키를 포함해 STT 업로드를 요청한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .set('Cookie', 'guestUser=guest-uuid-303')
        .field('mainQuizId', '1')
        .attach('audio', createAudioFile('guest audio reuse').buffer, {
          filename: 'guest.webm',
          contentType: 'audio/webm',
        });

      // Then
      // 새 guest 생성 없이 기존 guest 소유로 답변이 저장되는지 검증한다.
      expect(response.status).toBe(201);
      const body = response.body as ApiSuccess<{
        solvedQuizId: number;
        text: string;
      }>;
      const savedSolvedQuiz = solvedQuizStore.get(body.data.solvedQuizId);
      expect(savedSolvedQuiz?.user.userId).toBe(303);
      expect(authServiceMock.createGuestUser).not.toHaveBeenCalled();
    });

    it('오디오 파일이 없으면 MISSING_RECORD_FILE 오류를 반환한다', async () => {
      // Given
      // 파일 없이 mainQuizId만 포함한 요청을 준비한다.

      // When
      // STT 업로드 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .field('mainQuizId', '1');

      // Then
      // 파일 누락 오류 코드와 메시지를 반환하는지 검증한다.
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject<ApiFailure>({
        success: false,
        errorCode: ERROR_MESSAGES.MISSING_RECORD_FILE.errorCode,
        message: ERROR_MESSAGES.MISSING_RECORD_FILE.message,
      });
    });

    it('지원하지 않는 MIME 타입이면 업로드를 거절한다', async () => {
      // Given
      // 비허용 MIME 타입 파일과 성공 가능한 STT 환경을 준비한다.
      const fetchMock = jest.fn();
      setFetchMock(fetchMock as jest.MockedFunction<typeof fetch>);

      // When
      // 지원하지 않는 MIME 타입 파일로 STT 업로드를 요청한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .set('x-test-user-id', '101')
        .field('mainQuizId', '1')
        .attach('audio', Buffer.from('video bytes'), {
          filename: 'invalid.mp4',
          contentType: 'video/mp4',
        });

      // Then
      // 415 응답과 MIME 타입 정보가 포함된 메시지를 검증한다.
      expect(response.status).toBe(415);
      expect(response.body.errorCode).toBe('HTTP_415');
      expect(response.body.message).toContain('video/mp4');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('외부 STT가 rate limit으로 실패하면 비즈니스 오류 계약으로 번역된다', async () => {
      // Given
      // 정상 업로드 입력과 429를 반환하는 외부 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('too many requests'),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // STT 업로드 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/stt')
        .set('x-test-user-id', '101')
        .field('mainQuizId', '1')
        .attach('audio', createAudioFile('valid audio').buffer, {
          filename: 'answer.webm',
          contentType: 'audio/webm',
        });

      // Then
      // rate limit 에러 코드가 내려오고 solved quiz가 저장되지 않는지 검증한다.
      expect(response.status).toBe(429);
      expect(response.body.errorCode).toBe(
        ERROR_MESSAGES.EXTERNAL_API_RATE_LIMIT_EXCEEDED.errorCode,
      );
      expect(solvedQuizStore.size).toBe(0);
    });
  });

  describe('PATCH /api/speeches/:mainQuizId', () => {
    it('로그인 사용자가 자신의 solved quiz를 수정하면 새 speech text를 반환하고 DB를 갱신한다', async () => {
      // Given
      // 사용자가 소유한 solved quiz와 수정할 새 텍스트를 준비한다.
      const solvedQuiz = seedSolvedQuiz({
        userId: 101,
        mainQuizId: 1,
        speechText: '기존 답변',
      });

      // When
      // 자기 소유 기록 수정 API를 호출한다.
      const response = await request(httpServer())
        .patch('/api/speeches/1')
        .set('x-test-user-id', '101')
        .send({
          solvedQuizId: solvedQuiz.solvedQuizId,
          speechText: '수정된 답변입니다.',
        });

      // Then
      // 응답 DTO와 저장소에 반영된 텍스트를 검증한다.
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        mainQuizId: 1,
        solvedQuizId: solvedQuiz.solvedQuizId,
        speechText: '수정된 답변입니다.',
      });
      expect(solvedQuizStore.get(solvedQuiz.solvedQuizId)?.speechText).toBe(
        '수정된 답변입니다.',
      );
    });

    it('수정 텍스트가 공백뿐이면 실패한다', async () => {
      // Given
      // 수정 대상 solved quiz와 공백 문자열 입력을 준비한다.
      const solvedQuiz = seedSolvedQuiz({
        userId: 101,
        mainQuizId: 1,
        speechText: '기존 답변',
      });

      // When
      // 공백 문자열로 수정 API를 호출한다.
      const response = await request(httpServer())
        .patch('/api/speeches/1')
        .set('x-test-user-id', '101')
        .send({
          solvedQuizId: solvedQuiz.solvedQuizId,
          speechText: '   ',
        });

      // Then
      // 400 응답과 기존 DB 값 유지 여부를 검증한다.
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        '수정된 답변 내용이 비어있습니다',
      );
      expect(solvedQuizStore.get(solvedQuiz.solvedQuizId)?.speechText).toBe(
        '기존 답변',
      );
    });

    it('다른 사용자의 solved quiz를 수정하려 하면 실패한다', async () => {
      // Given
      // 다른 사용자가 소유한 solved quiz를 준비한다.
      const solvedQuiz = seedSolvedQuiz({
        userId: 202,
        mainQuizId: 1,
        speechText: '다른 사람 답변',
      });

      // When
      // 타인 소유 기록 수정 API를 호출한다.
      const response = await request(httpServer())
        .patch('/api/speeches/1')
        .set('x-test-user-id', '101')
        .send({
          solvedQuizId: solvedQuiz.solvedQuizId,
          speechText: '수정 시도',
        });

      // Then
      // 권한 없음 메시지와 기존 DB 값 유지 여부를 검증한다.
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        '해당 기록에 대한 권한이 없습니다',
      );
      expect(solvedQuizStore.get(solvedQuiz.solvedQuizId)?.speechText).toBe(
        '다른 사람 답변',
      );
    });

    it('저장소 update 실패 시 500을 반환한다', async () => {
      // Given
      // 수정 대상 solved quiz와 저장 실패 상태를 준비한다.
      const solvedQuiz = seedSolvedQuiz({
        userId: 101,
        mainQuizId: 1,
        speechText: '기존 답변',
      });
      updateShouldFail = true;

      // When
      // 수정 API를 호출한다.
      const response = await request(httpServer())
        .patch('/api/speeches/1')
        .set('x-test-user-id', '101')
        .send({
          solvedQuizId: solvedQuiz.solvedQuizId,
          speechText: '저장 실패 유도',
        });

      // Then
      // 500 응답과 원본 DB 값 유지 여부를 검증한다.
      expect(response.status).toBe(500);
      expect(response.body.errorCode).toBe('HTTP_500');
      expect(solvedQuizStore.get(solvedQuiz.solvedQuizId)?.speechText).toBe(
        '기존 답변',
      );
    });
  });

  describe('GET /api/speeches/:mainQuizId', () => {
    it('로그인 사용자는 자신의 답변 목록만 최신순으로 조회한다', async () => {
      // Given
      // 같은 퀴즈에 대한 내 답변 두 건과 다른 사용자 답변 한 건을 준비한다.
      const older = seedSolvedQuiz({
        userId: 101,
        mainQuizId: 1,
        speechText: '첫 번째 답변',
        createdAt: new Date('2024-01-01T09:00:00.000Z'),
      });
      const newer = seedSolvedQuiz({
        userId: 101,
        mainQuizId: 1,
        speechText: '두 번째 답변',
        createdAt: new Date('2024-01-02T09:00:00.000Z'),
      });
      seedSolvedQuiz({
        userId: 202,
        mainQuizId: 1,
        speechText: '다른 사용자 답변',
        createdAt: new Date('2024-01-03T09:00:00.000Z'),
      });

      // When
      // 로그인 사용자로 목록 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/speeches/1')
        .set('x-test-user-id', '101');

      // Then
      // 내 답변만 최신순으로 내려오는지 검증한다.
      expect(response.status).toBe(200);
      expect(response.body.data.quizId).toBe(1);
      expect(response.body.data.speeches).toHaveLength(2);
      expect(
        response.body.data.speeches.map(
          (item: { solvedQuizId: number }) => item.solvedQuizId,
        ),
      ).toEqual([newer.solvedQuizId, older.solvedQuizId]);
    });

    it('비로그인 요청은 guest 기준으로 자신의 답변 목록을 조회한다', async () => {
      // Given
      // guest 사용자 답변과 다른 사용자 답변을 준비한다.
      const guestSolvedQuiz = seedSolvedQuiz({
        userId: 303,
        mainQuizId: 1,
        speechText: '게스트 답변',
        createdAt: new Date('2024-01-03T09:00:00.000Z'),
      });
      seedSolvedQuiz({
        userId: 202,
        mainQuizId: 1,
        speechText: '다른 사용자 답변',
        createdAt: new Date('2024-01-04T09:00:00.000Z'),
      });

      // When
      // guest 쿠키와 함께 목록 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/speeches/1')
        .set('Cookie', 'guestUser=guest-uuid-303');

      // Then
      // guest 자신의 답변만 내려오는지 검증한다.
      expect(response.status).toBe(200);
      expect(response.body.data.speeches).toHaveLength(1);
      expect(response.body.data.speeches[0].solvedQuizId).toBe(
        guestSolvedQuiz.solvedQuizId,
      );
    });

    it('기록이 없으면 빈 배열을 반환한다', async () => {
      // Given
      // 조회 대상 사용자와 퀴즈 조합에 답변 기록이 없는 상태를 준비한다.

      // When
      // 목록 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/speeches/2')
        .set('x-test-user-id', '101');

      // Then
      // 성공 응답과 빈 배열을 반환하는지 검증한다.
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        quizId: 2,
        speeches: [],
      });
    });
  });

  describe('POST /api/speeches/text/:mainQuizId', () => {
    it('로그인 사용자가 길이 조건을 만족하는 텍스트 답변을 보내면 solved quiz를 생성한다', async () => {
      // Given
      // 로그인 사용자와 최소 길이를 넘는 텍스트 답변을 준비한다.
      const validSpeechText = '가'.repeat(MIN_USER_ANSWER_LENGTH);

      // When
      // 텍스트 답변 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/1')
        .set('x-test-user-id', '101')
        .send({ speechText: validSpeechText });

      // Then
      // 성공 응답과 생성된 solved quiz 소유자를 검증한다.
      expect(response.status).toBe(201);
      const body = response.body as ApiSuccess<{
        mainQuizId: number;
        solvedQuizId: number;
      }>;
      expect(body.data.mainQuizId).toBe(1);
      expect(solvedQuizStore.get(body.data.solvedQuizId)?.user.userId).toBe(
        101,
      );
    });

    it('비로그인 요청이면 guest 사용자를 만들고 텍스트 답변을 저장한다', async () => {
      // Given
      // 비로그인 요청과 길이 조건을 만족하는 텍스트 답변을 준비한다.
      const validSpeechText = '나'.repeat(MIN_USER_ANSWER_LENGTH);

      // When
      // guest 생성이 필요한 텍스트 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/1')
        .send({ speechText: validSpeechText });

      // Then
      // guest 쿠키가 발급되고 guest 사용자 기준으로 저장되는지 검증한다.
      expect(response.status).toBe(201);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('guestUser=')]),
      );
      const body = response.body as ApiSuccess<{
        mainQuizId: number;
        solvedQuizId: number;
      }>;
      expect(solvedQuizStore.get(body.data.solvedQuizId)?.user.provider).toBe(
        Provider.GUEST,
      );
    });

    it('사용자가 없으면 USER_NOT_FOUND를 반환한다', async () => {
      // Given
      // 저장소에 없는 사용자 id와 유효한 텍스트 답변을 준비한다.
      const validSpeechText = '다'.repeat(MIN_USER_ANSWER_LENGTH);

      // When
      // 존재하지 않는 사용자 컨텍스트로 텍스트 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/1')
        .set('x-test-user-id', '999')
        .send({ speechText: validSpeechText });

      // Then
      // USER_NOT_FOUND 오류 코드를 반환하는지 검증한다.
      expect(response.status).toBe(404);
      expect(response.body.errorCode).toBe(
        ERROR_MESSAGES.USER_NOT_FOUND.errorCode,
      );
    });

    it('퀴즈가 없으면 MAIN_QUIZ_NOT_FOUND를 반환한다', async () => {
      // Given
      // 존재하는 사용자와 존재하지 않는 퀴즈 id, 유효한 텍스트 답변을 준비한다.
      const validSpeechText = '라'.repeat(MIN_USER_ANSWER_LENGTH);

      // When
      // 없는 퀴즈로 텍스트 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/999')
        .set('x-test-user-id', '101')
        .send({ speechText: validSpeechText });

      // Then
      // MAIN_QUIZ_NOT_FOUND 오류 코드를 반환하는지 검증한다.
      expect(response.status).toBe(404);
      expect(response.body.errorCode).toBe(
        ERROR_MESSAGES.MAIN_QUIZ_NOT_FOUND.errorCode,
      );
    });

    it('답변이 너무 짧으면 ANSWER_TOO_SHORT를 반환한다', async () => {
      // Given
      // 최소 길이보다 짧은 텍스트 답변을 준비한다.
      const shortSpeechText = '마'.repeat(MIN_USER_ANSWER_LENGTH - 1);

      // When
      // 짧은 답변으로 텍스트 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/1')
        .set('x-test-user-id', '101')
        .send({ speechText: shortSpeechText });

      // Then
      // ANSWER_TOO_SHORT 오류와 저장 없음 상태를 검증한다.
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe(
        ERROR_MESSAGES.ANSWER_TOO_SHORT.errorCode,
      );
      expect(solvedQuizStore.size).toBe(0);
    });

    it('답변이 너무 길면 ANSWER_TOO_LONG을 반환한다', async () => {
      // Given
      // 최대 길이를 초과하는 텍스트 답변을 준비한다.
      const longSpeechText = '바'.repeat(MAX_USER_ANSWER_LENGTH + 1);

      // When
      // 긴 답변으로 텍스트 저장 API를 호출한다.
      const response = await request(httpServer())
        .post('/api/speeches/text/1')
        .set('x-test-user-id', '101')
        .send({ speechText: longSpeechText });

      // Then
      // ANSWER_TOO_LONG 오류와 저장 없음 상태를 검증한다.
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe(
        ERROR_MESSAGES.ANSWER_TOO_LONG.errorCode,
      );
      expect(solvedQuizStore.size).toBe(0);
    });
  });
});
