import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { MainQuizRepository } from 'src/datasources/repositories/tb-main-quiz.repository';
import { SolvedQuizRepository } from 'src/datasources/repositories/tb-solved-quiz.repository';
import { UserRepository } from 'src/datasources/repositories/tb-user.repository';
import { ERROR_MESSAGES } from 'src/common/constants/error-messages';
import { SpeechesService } from '../../../modules/speeches/speeches.service';

const loggerMock = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

describe('SpeechesService Integration', () => {
  let service: SpeechesService;

  const configServiceMock = {
    get: jest.fn(),
  };
  const solvedQuizRepositoryMock = {
    createSolvedQuiz: jest.fn(),
    getSpeechTextById: jest.fn(),
  };
  const userRepositoryMock = {};
  const mainQuizRepositoryMock = {};

  const mockAudioFile: Express.Multer.File = {
    fieldname: 'audio',
    originalname: 'answer.webm',
    encoding: '7bit',
    mimetype: 'audio/webm',
    buffer: Buffer.from('valid audio'),
    size: 1024,
    stream: undefined as never,
    destination: '',
    filename: 'answer.webm',
    path: '',
  };

  const setFetchMock = (mock: jest.MockedFunction<typeof fetch>) => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock;
  };

  const clearFetchMock = () => {
    delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  };

  const setValidClovaEnv = () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'NAVER_CLOVA_SPEECH_INVOKE_URL') return 'https://clova.test';
      if (key === 'NAVER_CLOVA_SPEECH_SECRET_KEY') return 'secret-key';
      if (key === 'NAVER_CLOVA_SPEECH_DEFAULT_LANG') return 'ko-KR';
      return undefined;
    });
  };

  const expectBusinessError = async (
    action: Promise<unknown>,
    expected: { status: number; errorCode: string; message: string },
  ) => {
    try {
      await action;
      throw new Error('expected error was not thrown');
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(
        expected.status,
      );
      expect((error as { getResponse: () => unknown }).getResponse()).toEqual({
        errorCode: expected.errorCode,
        message: expected.message,
      });
    }
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        SpeechesService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: SolvedQuizRepository,
          useValue: solvedQuizRepositoryMock,
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
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: loggerMock,
        },
      ],
    }).compile();

    service = moduleFixture.get(SpeechesService);

    jest.clearAllMocks();
    clearFetchMock();
    setValidClovaEnv();
    solvedQuizRepositoryMock.createSolvedQuiz.mockResolvedValue({
      solvedQuizId: 41,
    });
  });

  afterEach(() => {
    clearFetchMock();
  });

  describe('clovaSpeechLongStt', () => {
    it('CLOVA 401은 EXTERNAL_API_UNAUTHORIZED로 번역한다', async () => {
      // Given
      // 유효한 파일과 401을 반환하는 외부 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('unauthorized'),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 장문 STT 변환을 실행한다.

      // Then
      // 401 비즈니스 오류로 번역되는지 검증한다.
      await expectBusinessError(
        service.clovaSpeechLongStt(mockAudioFile, 1, 101),
        ERROR_MESSAGES.EXTERNAL_API_UNAUTHORIZED,
      );
    });

    it('CLOVA 404는 EXTERNAL_API_FORBIDDEN으로 번역한다', async () => {
      // Given
      // 유효한 파일과 404를 반환하는 외부 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('not found'),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 장문 STT 변환을 실행한다.

      // Then
      // 403 비즈니스 오류로 번역되는지 검증한다.
      await expectBusinessError(
        service.clovaSpeechLongStt(mockAudioFile, 1, 101),
        ERROR_MESSAGES.EXTERNAL_API_FORBIDDEN,
      );
    });

    it('CLOVA 429는 EXTERNAL_API_RATE_LIMIT_EXCEEDED로 번역한다', async () => {
      // Given
      // 유효한 파일과 429를 반환하는 외부 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('too many requests'),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 장문 STT 변환을 실행한다.

      // Then
      // 429 비즈니스 오류로 번역되는지 검증한다.
      await expectBusinessError(
        service.clovaSpeechLongStt(mockAudioFile, 1, 101),
        ERROR_MESSAGES.EXTERNAL_API_RATE_LIMIT_EXCEEDED,
      );
    });

    it('CLOVA가 result FAILED와 일별 한도 메시지를 주면 EXTERNAL_API_DAILY_QUOTA_EXCEEDED를 반환한다', async () => {
      // Given
      // ok 응답이지만 body.result가 FAILED인 외부 STT 응답을 준비한다.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          result: 'FAILED',
          message: '일별 한도 초과',
        }),
      } as unknown as Response) as jest.MockedFunction<typeof fetch>;
      setFetchMock(fetchMock);

      // When
      // 장문 STT 변환을 실행한다.

      // Then
      // 일별 한도 초과 비즈니스 오류로 번역되는지 검증한다.
      await expectBusinessError(
        service.clovaSpeechLongStt(mockAudioFile, 1, 101),
        ERROR_MESSAGES.EXTERNAL_API_DAILY_QUOTA_EXCEEDED,
      );
    });

    it('네트워크 실패는 EXTERNAL_API_SERVER_ERROR로 번역한다', async () => {
      // Given
      // 네트워크 예외를 던지는 외부 STT 호출을 준비한다.
      const fetchMock = jest
        .fn()
        .mockRejectedValue(new Error('socket hang up')) as jest.MockedFunction<
        typeof fetch
      >;
      setFetchMock(fetchMock);

      // When
      // 장문 STT 변환을 실행한다.

      // Then
      // 외부 서비스 서버 오류로 번역되는지 검증한다.
      await expectBusinessError(
        service.clovaSpeechLongStt(mockAudioFile, 1, 101),
        ERROR_MESSAGES.EXTERNAL_API_SERVER_ERROR,
      );
    });

    it('환경변수가 없으면 InternalServerErrorException을 던진다', async () => {
      // Given
      // CLOVA 필수 환경변수가 비어 있는 상태를 준비한다.
      configServiceMock.get.mockReturnValue(undefined);

      // When
      // 장문 STT 변환을 실행한다.
      const action = service.clovaSpeechLongStt(mockAudioFile, 1, 101);

      // Then
      // 환경변수 누락 예외를 그대로 반환하는지 검증한다.
      await expect(action).rejects.toThrow(InternalServerErrorException);
      await expect(action).rejects.toThrow(
        'CLOVA Speech 환경변수가 설정되지 않았습니다.',
      );
    });
  });

  describe('getSolvedQuizInfo', () => {
    it('존재하는 solved quiz면 speech text를 반환한다', async () => {
      // Given
      // speech text 조회가 가능한 solved quiz를 준비한다.
      solvedQuizRepositoryMock.getSpeechTextById.mockResolvedValue(
        '저장된 말하기 답변',
      );

      // When
      // solved quiz 정보를 조회한다.
      const result = await service.getSolvedQuizInfo(41);

      // Then
      // 저장된 speech text를 그대로 반환하는지 검증한다.
      expect(result).toBe('저장된 말하기 답변');
    });

    it('존재하지 않는 solved quiz면 NotFoundException을 던진다', async () => {
      // Given
      // 조회 대상 solved quiz가 없는 상태를 준비한다.
      solvedQuizRepositoryMock.getSpeechTextById.mockResolvedValue(null);

      // When
      // solved quiz 정보를 조회한다.
      const action = service.getSolvedQuizInfo(999);

      // Then
      // 조회 실패 예외를 반환하는지 검증한다.
      await expect(action).rejects.toThrow(NotFoundException);
      await expect(action).rejects.toThrow('존재하지 않는 퀴즈 입니다.');
    });
  });
});
