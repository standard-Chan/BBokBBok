import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuthService } from '../auth/auth.service';
import { MainQuizRepository } from 'src/datasources/repositories/tb-main-quiz.repository';
import { SolvedQuizRepository } from 'src/datasources/repositories/tb-solved-quiz.repository';
import { SpeechesService } from '../speeches/speeches.service';
import { UsersService } from '../users/users.service';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ApiResponseInterceptor } from 'src/common/interceptors/api-response.interceptor';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';
import { Provider, User } from 'src/datasources/entities/tb-user.entity';
import {
  DifficultyLevel,
  MainQuiz,
} from 'src/datasources/entities/tb-main-quiz.entity';
import { SolvedState } from 'src/datasources/entities/tb-solved-quiz.entity';
import { ERROR_MESSAGES } from 'src/common/constants/error-messages';
import type { Request, Response } from 'express';

const generateContentMock = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: generateContentMock,
    },
  })),
}));

jest.mock('typeorm-transactional', () => ({
  Transactional:
    () =>
    (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) =>
      descriptor,
  initializeTransactionalContext: jest.fn(),
  addTransactionalDataSource: jest.fn(),
}));

describe('FeedbackController Integration', () => {
  let app: INestApplication;

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

  const mainQuizRepositoryMock = {
    findByIdWithDetails: jest.fn(),
  };
  const solvedQuizRepositoryMock = {
    updateAiFeedback: jest.fn(),
    updateSolvedState: jest.fn(),
    findByIdAndUserId: jest.fn(),
  };
  const speechesServiceMock = {
    getSolvedQuizInfo: jest.fn(),
  };
  const usersServiceMock = {
    getUserChecklistProgress: jest.fn(),
  };
  const authServiceMock = {
    findUserByUuid: jest.fn(),
    createGuestUser: jest.fn(),
  };
  const loggerMock = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  let savedAiFeedback = new Map<number, Record<string, unknown>>();
  let solvedStateStore = new Map<number, SolvedState>();

  const createUser = (
    userId: number,
    provider: Provider = Provider.NAVER,
  ): User =>
    ({
      userId,
      uuid: `uuid-${userId}`,
      username: `user-${userId}`,
      provider,
      providerId: `provider-${userId}`,
      createdBy: 0,
      solvedQuizzes: [],
    }) as User;

  const createMainQuiz = (mainQuizId: number): MainQuiz =>
    ({
      mainQuizId,
      title: 'HTTP와 REST의 차이를 설명해주세요.',
      content: 'HTTP와 REST의 역할과 차이를 설명하는 문제입니다.',
      difficultyLevel: DifficultyLevel.MEDIUM,
      quizCategory: {
        quizCategoryId: 10,
        name: '백엔드',
      },
      keywords: [{ keyword: 'HTTP' }, { keyword: 'REST' }],
    }) as MainQuiz;

  const createChecklist = () => [
    {
      isChecked: true,
      checklistItem: {
        checklistItemId: 1,
        content: 'HTTP의 역할을 설명했다.',
      },
    },
    {
      isChecked: false,
      checklistItem: {
        checklistItemId: 2,
        content: 'REST의 제약 조건을 설명했다.',
      },
    },
  ];

  const longAnswer =
    'HTTP는 웹에서 클라이언트와 서버가 데이터를 주고받는 프로토콜이고, REST는 그 HTTP를 어떻게 일관성 있게 사용할지에 대한 설계 원칙입니다. 저는 자원 중심 URI와 무상태성, 표준 메서드 활용이 핵심이라고 이해하고 있습니다.';

  const httpServer = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [
        FeedbackService,
        {
          provide: MainQuizRepository,
          useValue: mainQuizRepositoryMock,
        },
        {
          provide: SolvedQuizRepository,
          useValue: solvedQuizRepositoryMock,
        },
        {
          provide: SpeechesService,
          useValue: speechesServiceMock,
        },
        {
          provide: UsersService,
          useValue: usersServiceMock,
        },
        {
          provide: AuthService,
          useValue: authServiceMock,
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
        (req as Request & { user?: User }).user = createUser(
          Number(userIdHeader),
        );
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
    savedAiFeedback = new Map<number, Record<string, unknown>>();
    solvedStateStore = new Map<number, SolvedState>();

    mainQuizRepositoryMock.findByIdWithDetails.mockResolvedValue(
      createMainQuiz(1),
    );
    speechesServiceMock.getSolvedQuizInfo.mockResolvedValue(longAnswer);
    usersServiceMock.getUserChecklistProgress.mockResolvedValue(
      createChecklist(),
    );
    authServiceMock.findUserByUuid.mockResolvedValue(null);
    authServiceMock.createGuestUser.mockResolvedValue(
      createUser(303, Provider.GUEST),
    );
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        score: 5,
        summary: '핵심 개념을 잘 설명했습니다.',
      }),
    });
    solvedQuizRepositoryMock.updateAiFeedback.mockImplementation(
      (solvedQuizId: number, aiFeedback: Record<string, unknown>) => {
        savedAiFeedback.set(solvedQuizId, aiFeedback);
        return true;
      },
    );
    solvedQuizRepositoryMock.updateSolvedState.mockImplementation(
      (solvedQuizId: number, solvedState: SolvedState) => {
        solvedStateStore.set(solvedQuizId, solvedState);
        return { affected: 1 };
      },
    );
    solvedQuizRepositoryMock.findByIdAndUserId.mockImplementation(
      (solvedQuizId: number, userId: number) => {
        if (solvedQuizId === 41 && userId === 101) {
          return {
            solvedQuizId,
            user: createUser(101),
            mainQuiz: { mainQuizId: 1 },
            speechText: longAnswer,
            importance: 'HIGH',
            aiFeedback: {
              score: 4,
              summary: '좋은 답변입니다.',
            },
          };
        }

        if (solvedQuizId === 42 && userId === 303) {
          return {
            solvedQuizId,
            user: createUser(303, Provider.GUEST),
            mainQuiz: { mainQuizId: 1 },
            speechText: longAnswer,
            importance: 'NORMAL',
            aiFeedback: {
              score: 3,
              summary: '게스트 답변입니다.',
            },
          };
        }

        if (solvedQuizId === 43 && userId === 101) {
          return {
            solvedQuizId,
            user: createUser(101),
            mainQuiz: { mainQuizId: 1 },
            speechText: longAnswer,
            importance: 'LOW',
            aiFeedback: null,
          };
        }

        return null;
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/feedback', () => {
    it('정상 요청이면 피드백을 생성하고 완료 상태로 전이한다', async () => {
      // Given
      // 유효한 퀴즈, 답변, 체크리스트와 외부 AI 응답을 준비한다.

      // When
      // 피드백 생성 API를 호출한다.
      const response = await request(httpServer()).post('/api/feedback').send({
        mainQuizId: 1,
        solvedQuizId: 10,
      });
      const body = response.body as ApiSuccess<{
        solvedQuizDetail: {
          mainQuizId: number;
          userChecklistProgress: {
            checklistCount: number;
            checkedCount: number;
          };
        };
        aiFeedbackResult: {
          score: number;
          summary: string;
        };
      }>;

      // Then
      // 응답과 저장된 상태 전이가 기대와 일치하는지 검증한다.
      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.aiFeedbackResult).toEqual({
        score: 5,
        summary: '핵심 개념을 잘 설명했습니다.',
      });
      expect(body.data.solvedQuizDetail.mainQuizId).toBe(1);
      expect(body.data.solvedQuizDetail.userChecklistProgress).toEqual({
        checklistCount: 2,
        checkedCount: 1,
      });
      expect(savedAiFeedback.get(10)).toEqual({
        score: 5,
        summary: '핵심 개념을 잘 설명했습니다.',
      });
      expect(solvedStateStore.get(10)).toBe(SolvedState.COMPLETED);
    });

    it('body 형식이 잘못되면 validation 오류를 반환한다', async () => {
      // Given
      // 숫자 필드가 누락된 잘못된 요청 본문을 준비한다.

      // When
      // 유효하지 않은 본문으로 생성 API를 호출한다.
      const response = await request(httpServer()).post('/api/feedback').send({
        mainQuizId: 'abc',
      });
      const body = response.body as ApiFailure;

      // Then
      // validation 실패 응답이 반환되는지 검증한다.
      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe(ERROR_MESSAGES.VALIDATION_FAILED.errorCode);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('존재하지 않는 퀴즈면 404를 반환한다', async () => {
      // Given
      // 퀴즈 조회가 실패하도록 저장소 응답을 준비한다.
      mainQuizRepositoryMock.findByIdWithDetails.mockResolvedValue(null);

      // When
      // 존재하지 않는 퀴즈로 생성 API를 호출한다.
      const response = await request(httpServer()).post('/api/feedback').send({
        mainQuizId: 999,
        solvedQuizId: 10,
      });
      const body = response.body as ApiFailure;

      // Then
      // 퀴즈 부재 오류가 반환되고 상태 전이가 남지 않는지 검증한다.
      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(savedAiFeedback.size).toBe(0);
      expect(solvedStateStore.size).toBe(0);
    });

    it('답변이 너무 짧으면 ANSWER_TOO_SHORT를 반환한다', async () => {
      // Given
      // 최소 길이보다 짧은 답변이 조회되도록 준비한다.
      speechesServiceMock.getSolvedQuizInfo.mockResolvedValue(
        '짧은 답변입니다. 길이 제한에 걸립니다.',
      );

      // When
      // 짧은 답변 상태에서 생성 API를 호출한다.
      const response = await request(httpServer()).post('/api/feedback').send({
        mainQuizId: 1,
        solvedQuizId: 11,
      });
      const body = response.body as ApiFailure;

      // Then
      // 짧은 답변 오류가 반환되고 저장이 남지 않는지 검증한다.
      expect(response.status).toBe(400);
      expect(body.errorCode).toBe(ERROR_MESSAGES.ANSWER_TOO_SHORT.errorCode);
      expect(savedAiFeedback.size).toBe(0);
    });
  });

  describe('GET /api/feedback/:solvedQuizId', () => {
    it('로그인 사용자가 자신의 피드백을 조회하면 결과를 반환한다', async () => {
      // Given
      // 로그인 사용자의 풀이 결과와 체크리스트 데이터를 준비한다.

      // When
      // 로그인 사용자 헤더로 피드백 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/feedback/41')
        .set('x-test-user-id', '101');
      const body = response.body as ApiSuccess<{
        solvedQuizDetail: {
          importance: string;
          userChecklistProgress: {
            checklistCount: number;
            checkedCount: number;
          };
        };
        aiFeedbackResult: {
          score: number;
          summary: string;
        };
      }>;

      // Then
      // 응답이 성공하고 AI 피드백과 체크리스트 요약이 포함되는지 검증한다.
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.aiFeedbackResult).toEqual({
        score: 4,
        summary: '좋은 답변입니다.',
      });
      expect(body.data.solvedQuizDetail.importance).toBe('HIGH');
      expect(body.data.solvedQuizDetail.userChecklistProgress).toEqual({
        checklistCount: 2,
        checkedCount: 1,
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('guest 쿠키가 있으면 기존 guest 사용자를 재사용한다', async () => {
      // Given
      // guest 쿠키와 해당 guest 사용자의 풀이 결과를 준비한다.
      authServiceMock.findUserByUuid.mockResolvedValue(
        createUser(303, Provider.GUEST),
      );

      // When
      // guest 쿠키를 포함해 피드백 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/feedback/42')
        .set('Cookie', 'guestUser=guest-uuid-303');
      const body = response.body as ApiSuccess<{
        aiFeedbackResult: {
          summary: string;
        };
      }>;

      // Then
      // 새 쿠키 없이 기존 guest 데이터가 반환되는지 검증한다.
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.aiFeedbackResult.summary).toBe('게스트 답변입니다.');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('guest 쿠키가 없으면 새 guest를 만들고 쿠키를 내려준다', async () => {
      // Given
      // guest 사용자를 새로 생성할 수 있도록 인증 보조 응답을 준비한다.

      // When
      // 쿠키 없이 guest 소유 풀이 결과를 조회한다.
      const response = await request(httpServer()).get('/api/feedback/42');
      const body = response.body as ApiSuccess<{
        solvedQuizDetail: {
          importance: string;
        };
      }>;

      // Then
      // guest 쿠키가 발급되고 해당 guest 데이터가 반환되는지 검증한다.
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.solvedQuizDetail.importance).toBe('NORMAL');
      expect(response.headers['set-cookie']?.[0]).toContain('guestUser=');
    });

    it('다른 사용자의 풀이 결과면 404를 반환한다', async () => {
      // Given
      // 다른 사용자의 풀이 결과만 존재하는 상태를 준비한다.

      // When
      // 권한이 없는 사용자로 피드백 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/feedback/41')
        .set('x-test-user-id', '999');
      const body = response.body as ApiFailure;

      // Then
      // 소유권 검증 실패로 404가 반환되는지 검증한다.
      expect(response.status).toBe(404);
      expect(body.errorCode).toBe(
        ERROR_MESSAGES.SOLVED_QUIZ_NOT_FOUND.errorCode,
      );
    });

    it('AI 피드백이 없으면 404를 반환한다', async () => {
      // Given
      // 피드백이 아직 저장되지 않은 풀이 결과를 준비한다.

      // When
      // 피드백이 없는 풀이 결과를 조회한다.
      const response = await request(httpServer())
        .get('/api/feedback/43')
        .set('x-test-user-id', '101');
      const body = response.body as ApiFailure;

      // Then
      // 현재 계약대로 solved quiz not found 오류가 반환되는지 검증한다.
      expect(response.status).toBe(404);
      expect(body.errorCode).toBe(
        ERROR_MESSAGES.SOLVED_QUIZ_NOT_FOUND.errorCode,
      );
    });
  });

  describe('GET /api/feedback/:solvedQuizId/speech-text', () => {
    it('로그인 사용자가 자신의 speech text를 조회하면 원문을 반환한다', async () => {
      // Given
      // 로그인 사용자의 풀이 결과 원문을 준비한다.

      // When
      // speech text 조회 API를 호출한다.
      const response = await request(httpServer())
        .get('/api/feedback/41/speech-text')
        .set('x-test-user-id', '101');
      const body = response.body as ApiSuccess<{
        speechText: string;
      }>;

      // Then
      // 원문 답변이 성공적으로 반환되는지 검증한다.
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.speechText).toBe(longAnswer);
    });

    it('숫자가 아닌 solvedQuizId면 400을 반환한다', async () => {
      // Given
      // path param이 숫자가 아닌 요청 경로를 준비한다.

      // When
      // 잘못된 path param으로 speech text 조회 API를 호출한다.
      const response = await request(httpServer()).get(
        '/api/feedback/not-a-number/speech-text',
      );
      const body = response.body as ApiFailure;

      // Then
      // ParseIntPipe 오류가 400 응답으로 반환되는지 검증한다.
      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('HTTP_400');
    });
  });
});
