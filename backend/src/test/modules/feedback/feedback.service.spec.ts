import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackService } from 'src/modules/feedback/feedback.service';
import { MainQuizRepository } from 'src/datasources/repositories/tb-main-quiz.repository';
import { SolvedQuizRepository } from 'src/datasources/repositories/tb-solved-quiz.repository';
import { SpeechesService } from 'src/modules/speeches/speeches.service';
import { UsersService } from 'src/modules/users/users.service';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ERROR_MESSAGES } from 'src/common/constants/error-messages';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

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

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        {
          provide: MainQuizRepository,
          useValue: {
            findByIdWithDetails: jest.fn(),
          },
        },
        {
          provide: SolvedQuizRepository,
          useValue: {
            updateAiFeedback: jest.fn(),
            updateSolvedState: jest.fn(),
            findByIdAndUserId: jest.fn(),
          },
        },
        {
          provide: SpeechesService,
          useValue: {
            getSolvedQuizInfo: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            getUserChecklistProgress: jest.fn(),
          },
        },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
    jest.clearAllMocks();
  });

  const expectBusinessError = async (
    promise: Promise<unknown>,
    errorCode: string,
  ) => {
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getResponse()).toMatchObject({
        errorCode,
      });
    });
  };

  describe('analyzeAnswer()', () => {
    it('정상 JSON 응답이면 파싱된 객체를 반환한다', async () => {
      // Given
      // Gemini가 JSON 문자열을 정상적으로 반환하도록 준비한다.
      generateContentMock.mockResolvedValue({
        text: JSON.stringify({ score: 5, summary: '좋습니다.' }),
      });

      // When
      // 답변 분석을 실행한다.
      const result = await service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 파싱된 객체가 그대로 반환되는지 검증한다.
      expect(result).toEqual({ score: 5, summary: '좋습니다.' });
    });

    it('응답 text가 비어 있으면 외부 서버 오류로 변환한다', async () => {
      // Given
      // Gemini가 비어 있는 응답을 반환하도록 준비한다.
      generateContentMock.mockResolvedValue({
        text: '',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 현재 구현 기준으로 외부 서버 오류 계약으로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_SERVER_ERROR.errorCode,
      );
    });

    it('잘못된 JSON이면 내부 서버 오류로 변환한다', async () => {
      // Given
      // Gemini가 파싱할 수 없는 JSON 문자열을 반환하도록 준비한다.
      generateContentMock.mockResolvedValue({
        text: 'invalid-json',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 파싱 예외가 내부 서버 오류 계약으로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.INTERNAL_SERVER_ERROR.errorCode,
      );
    });

    it('429 daily 오류면 일일 한도 초과 오류를 반환한다', async () => {
      // Given
      // Gemini가 daily quota 메시지를 포함한 429를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 429,
        message: 'Daily quota exceeded',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 일일 한도 초과 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_DAILY_QUOTA_EXCEEDED.errorCode,
      );
    });

    it('429 일반 오류면 rate limit 오류를 반환한다', async () => {
      // Given
      // Gemini가 일반적인 429 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 429,
        message: 'Too many requests',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // rate limit 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_RATE_LIMIT_EXCEEDED.errorCode,
      );
    });

    it('400 safety 오류면 safety block 오류를 반환한다', async () => {
      // Given
      // Gemini가 safety 메시지를 포함한 400 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 400,
        message: 'Blocked by safety policy',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // safety block 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_SAFETY_BLOCK.errorCode,
      );
    });

    it('400 api key 오류면 키 오류를 반환한다', async () => {
      // Given
      // Gemini가 api key 메시지를 포함한 400 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 400,
        message: 'API key is invalid',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // API 키 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_KEY_INVALID.errorCode,
      );
    });

    it('400 기타 오류면 잘못된 요청 오류를 반환한다', async () => {
      // Given
      // Gemini가 일반적인 400 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 400,
        message: 'Bad request payload',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 잘못된 요청 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_INVALID_REQUEST.errorCode,
      );
    });

    it('403 오류면 키 오류를 반환한다', async () => {
      // Given
      // Gemini가 권한 문제에 해당하는 403 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 403,
        message: 'Forbidden',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // API 키 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_KEY_INVALID.errorCode,
      );
    });

    it('5xx 오류면 외부 서버 오류를 반환한다', async () => {
      // Given
      // Gemini가 서버 오류를 반환하도록 준비한다.
      generateContentMock.mockRejectedValue({
        status: 503,
        message: 'Service unavailable',
      });

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 외부 서버 오류 코드로 변환되는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.EXTERNAL_API_SERVER_ERROR.errorCode,
      );
    });

    it('상태 코드가 없으면 내부 서버 오류를 반환한다', async () => {
      // Given
      // Gemini가 분류되지 않은 예외를 던지도록 준비한다.
      generateContentMock.mockRejectedValue(new Error('Unknown error'));

      // When
      // 답변 분석을 실행한다.
      const promise = service.analyzeAnswer('충분히 긴 사용자 답변');

      // Then
      // 내부 서버 오류 코드로 닫히는지 검증한다.
      await expectBusinessError(
        promise,
        ERROR_MESSAGES.INTERNAL_SERVER_ERROR.errorCode,
      );
    });
  });
});
