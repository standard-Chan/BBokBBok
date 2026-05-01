import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { DataSource } from 'typeorm';
import {
  buildQuizVariants,
  createQuizzesTestApp,
  resetQuizzesTables,
  seedQuizFixtures,
} from './quizzes-test.helper';

interface ApiResponse<T> {
  success: boolean;
  message: string;
  errorCode: string | null;
  data: T;
}

interface QuizSummary {
  mainQuizId: string;
  difficultyLevel: string;
  quizCategory: {
    name: string;
  };
}

interface QuizListPayload {
  data: QuizSummary[];
  meta: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
}

interface QuizAggregationPayload {
  categories: Array<{
    name: string;
    count: number;
  }>;
  total: number;
}

interface QuizCategoryPayload {
  quizCategoryId: string;
  name: string;
}

interface QuizDetailPayload {
  mainQuizId: string;
  title: string;
  content: string;
  difficultyLevel: string;
  quizCategory: {
    name: string;
  };
  checklistItems: Array<{
    checklistItemId: string;
    content: string;
  }>;
}

interface QuizChecklistPayload {
  mainQuizId: string;
  title: string;
  content: string;
  difficultyLevel: string;
  checklistItems: Array<{
    checklistItemId: number;
    sortOrder: number;
    content: string;
  }>;
}

interface MultipleChoicesPayload {
  mainQuizId: number;
  totalCount: number;
  multipleChoices: Array<{
    multipleChoiceId: number;
    content: string;
    options: Array<{
      multipleQuizOptionId: number;
      option: string;
      isCorrect: boolean;
      explanation: string | null;
    }>;
  }>;
}

describe('QuizzesController Docker E2E', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const testApp = await createQuizzesTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
  });

  beforeEach(async () => {
    await resetQuizzesTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/quizzes', () => {
    it('기본 요청이면 기본 limit 15와 다음 커서를 포함한 목록을 반환한다', async () => {
      // Given
      // 커서 페이지네이션을 검증할 수 있도록 16개의 퀴즈를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(16));

      // When
      // 기본 목록 조회 API를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes')
        .expect(200);
      const body = response.body as ApiResponse<QuizListPayload>;

      // Then
      // 응답 래퍼와 페이지네이션 메타 정보가 기대한 구조인지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data.data).toHaveLength(15);
      expect(body.data.meta.limit).toBe(15);
      expect(body.data.meta.hasNextPage).toBe(true);
      expect(body.data.meta.nextCursor).toBe('15');
      expect(body.data.data[0].mainQuizId).toBe('1');
      expect(body.data.data[14].mainQuizId).toBe('15');
    });

    it('cursor가 있으면 해당 ID 이후 데이터만 반환한다', async () => {
      // Given
      // 다음 페이지 계산을 확인할 수 있도록 8개의 퀴즈를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(8));

      // When
      // 3번 퀴즈 이후 목록을 조회한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes')
        .query({ cursor: 3, limit: 3 })
        .expect(200);
      const body = response.body as ApiResponse<QuizListPayload>;

      // Then
      // cursor 이하 데이터가 제외되고 이후 데이터만 반환되는지 검증한다.
      expect(body.data.data.map((quiz) => quiz.mainQuizId)).toEqual([
        '4',
        '5',
        '6',
      ]);
      expect(body.data.meta.hasNextPage).toBe(true);
      expect(body.data.meta.nextCursor).toBe('6');
    });

    it('카테고리와 난이도 필터를 함께 적용해도 조건에 맞는 퀴즈만 반환한다', async () => {
      // Given
      // 카테고리와 난이도가 섞인 퀴즈 집합을 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(9));

      // When
      // 네트워크 카테고리이면서 상 난이도인 퀴즈를 조회한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes')
        .query({ category: '네트워크', difficulty: '상' })
        .expect(200);
      const body = response.body as ApiResponse<QuizListPayload>;

      // Then
      // 응답의 모든 퀴즈가 요청 조건을 만족하는지 검증한다.
      expect(body.data.data).toHaveLength(3);
      for (const quiz of body.data.data) {
        expect(quiz.quizCategory.name).toBe('네트워크');
        expect(quiz.difficultyLevel).toBe('상');
      }
    });

    it('잘못된 difficulty 값이면 validation 오류를 반환한다', async () => {
      // Given
      // validation 오류는 데이터 적재 없이 재현 가능하다.

      // When
      // 허용되지 않은 난이도 값으로 목록 조회를 요청한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes')
        .query({ difficulty: '매우어려움' })
        .expect(400);
      const body = response.body as ApiResponse<string[] | null>;

      // Then
      // ValidationPipe 오류가 공통 에러 응답으로 변환되는지 검증한다.
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /api/quizzes/aggregations', () => {
    it('필터 없이 카테고리별 count와 total을 반환한다', async () => {
      // Given
      // 카테고리 분포가 보이도록 7개의 퀴즈를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(7));

      // When
      // 집계 API를 필터 없이 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/aggregations')
        .expect(200);
      const body = response.body as ApiResponse<QuizAggregationPayload>;

      // Then
      // 카테고리별 개수와 전체 개수가 함께 맞는지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(7);
      expect(body.data.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '네트워크', count: 3 }),
          expect.objectContaining({ name: '운영체제', count: 2 }),
          expect.objectContaining({ name: '데이터베이스', count: 2 }),
        ]),
      );
    });

    it('난이도 필터가 있으면 해당 난이도로만 집계한다', async () => {
      // Given
      // 난이도 분기가 섞인 퀴즈 데이터를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(9));

      // When
      // 상 난이도 기준 집계를 조회한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/aggregations')
        .query({ difficulty: '상' })
        .expect(200);
      const body = response.body as ApiResponse<QuizAggregationPayload>;

      // Then
      // 상 난이도 퀴즈만 total과 category count에 반영되는지 검증한다.
      expect(body.data.total).toBe(3);
      expect(body.data.categories).toEqual([
        expect.objectContaining({ name: '네트워크', count: 3 }),
      ]);
    });

    it('잘못된 난이도 값이면 validation 오류를 반환한다', async () => {
      // Given
      // validation 오류는 데이터 적재 없이 재현 가능하다.

      // When
      // 허용되지 않은 난이도 값으로 집계를 요청한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/aggregations')
        .query({ difficulty: 'invalid' })
        .expect(400);
      const body = response.body as ApiResponse<string[] | null>;

      // Then
      // 잘못된 query가 공통 validation 오류로 변환되는지 검증한다.
      expect(body.errorCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /api/quizzes/categories', () => {
    it('전체 카테고리 목록을 반환한다', async () => {
      // Given
      // 세 카테고리가 모두 포함되도록 퀴즈 데이터를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(6));

      // When
      // 카테고리 목록 API를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/categories')
        .expect(200);
      const body = response.body as ApiResponse<QuizCategoryPayload[]>;

      // Then
      // 카테고리 엔티티 목록이 응답 래퍼 안에 포함되는지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(3);
      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '네트워크' }),
          expect.objectContaining({ name: '운영체제' }),
          expect.objectContaining({ name: '데이터베이스' }),
        ]),
      );
    });
  });

  describe('GET /api/quizzes/:id', () => {
    it('존재하는 퀴즈 ID면 상세 정보를 반환한다', async () => {
      // Given
      // 상세 조회에 필요한 카테고리와 체크리스트가 연결된 퀴즈를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(1));

      // When
      // 첫 번째 퀴즈 상세 조회 API를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/1')
        .expect(200);
      const body = response.body as ApiResponse<QuizDetailPayload>;

      // Then
      // 단건 조회 결과에 핵심 필드와 연관 데이터가 포함되는지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data.mainQuizId).toBe('1');
      expect(body.data.quizCategory.name).toBe('네트워크');
      expect(body.data.checklistItems.length).toBeGreaterThan(0);
    });

    it('존재하지 않는 퀴즈 ID면 404를 반환한다', async () => {
      // Given
      // 존재하지 않는 ID 조회만 검증하므로 데이터를 적재하지 않는다.

      // When
      // 없는 퀴즈 ID로 상세 조회를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/999')
        .expect(404);
      const body = response.body as ApiResponse<null>;

      // Then
      // controller의 NotFoundException 변환 결과가 공통 오류 응답인지 검증한다.
      expect(body.success).toBe(false);
      expect(body.message).toBe('퀴즈를 찾을 수 없습니다.');
    });

    it('숫자가 아닌 path param이면 400을 반환한다', async () => {
      // Given
      // ParseIntPipe 오류는 데이터 적재 없이 재현 가능하다.

      // When
      // 숫자가 아닌 문자열로 상세 조회를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/not-a-number')
        .expect(400);
      const body = response.body as ApiResponse<string | string[] | null>;

      // Then
      // path param 형식 오류가 공통 에러 응답으로 변환되는지 검증한다.
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('HTTP_400');
    });
  });

  describe('GET /api/quizzes/:mainQuizId/checklist', () => {
    it('체크리스트가 있는 퀴즈면 정렬된 체크리스트를 반환한다', async () => {
      // Given
      // sortOrder 검증이 가능하도록 체크리스트가 포함된 퀴즈를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(1));

      // When
      // 체크리스트 조회 API를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/1/checklist')
        .expect(200);
      const body = response.body as ApiResponse<QuizChecklistPayload>;

      // Then
      // 체크리스트 DTO와 정렬 순서가 기대와 일치하는지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data.mainQuizId).toBe('1');
      expect(body.data.checklistItems[0].sortOrder).toBe(1);
      expect(body.data.checklistItems[1].sortOrder).toBe(2);
    });

    it('퀴즈가 없으면 404를 반환한다', async () => {
      // Given
      // 존재하지 않는 퀴즈 조회만 검증하므로 데이터를 적재하지 않는다.

      // When
      // 없는 퀴즈 ID로 체크리스트 조회를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/999/checklist')
        .expect(404);
      const body = response.body as ApiResponse<null>;

      // Then
      // 데이터 부재가 404 공통 오류 응답으로 변환되는지 검증한다.
      expect(body.success).toBe(false);
      expect(body.message).toBe('해당 퀴즈를 찾을 수 없습니다.');
    });

    it('퀴즈는 있지만 체크리스트가 없으면 404를 반환한다', async () => {
      // Given
      // 체크리스트만 제거한 퀴즈를 적재한다.
      const [quiz] = buildQuizVariants(1);
      await seedQuizFixtures(dataSource, [{ ...quiz, checklist: [] }]);

      // When
      // 체크리스트가 없는 퀴즈의 체크리스트 조회를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/1/checklist')
        .expect(404);
      const body = response.body as ApiResponse<null>;

      // Then
      // 체크리스트 부재 상태가 명확한 404 메시지로 노출되는지 검증한다.
      expect(body.success).toBe(false);
      expect(body.message).toBe(
        '해당 퀴즈에 대한 체크리스트가 존재하지 않습니다.',
      );
    });
  });

  describe('GET /api/quizzes/:mainQuizId/multiple-choices', () => {
    it('메인 퀴즈가 있으면 객관식 문항과 선택지를 DTO로 반환한다', async () => {
      // Given
      // 객관식과 선택지가 연결된 퀴즈를 적재한다.
      const [sampleQuiz] = buildQuizVariants(1);
      await seedQuizFixtures(dataSource, [
        {
          ...sampleQuiz,
          mainQuizId: 1,
          multipleChoices: sampleQuiz.multipleChoices?.slice(0, 2),
        },
      ]);

      // When
      // 객관식 조회 API를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/1/multiple-choices')
        .expect(200);
      const body = response.body as ApiResponse<MultipleChoicesPayload>;

      // Then
      // 문항 수, 옵션 순서, null explanation 매핑이 기대와 일치하는지 검증한다.
      expect(body.success).toBe(true);
      expect(body.data.mainQuizId).toBe(1);
      expect(body.data.totalCount).toBe(2);
      expect(body.data.multipleChoices[0].options[1].explanation).toBeNull();
    });

    it('메인 퀴즈가 없으면 404 비즈니스 오류를 반환한다', async () => {
      // Given
      // 없는 퀴즈 참조만 검증하므로 데이터를 적재하지 않는다.

      // When
      // 존재하지 않는 메인 퀴즈 ID로 객관식 조회를 호출한다.
      const response = await request(app.getHttpServer())
        .get('/api/quizzes/999/multiple-choices')
        .expect(404);
      const body = response.body as ApiResponse<null>;

      // Then
      // MAIN_QUIZ_NOT_FOUND 오류 계약이 유지되는지 검증한다.
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('MAIN_QUIZ_NOT_FOUND');
    });
  });
});
