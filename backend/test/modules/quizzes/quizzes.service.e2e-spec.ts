import { NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { QuizzesService } from 'src/modules/quizzes/quizzes.service';
import { MainQuiz } from 'src/datasources/entities/tb-main-quiz.entity';
import {
  buildQuizVariants,
  createQuizzesTestApp,
  resetQuizzesTables,
  seedQuizFixtures,
  seedSolvedQuizFixtures,
  seedUser,
} from './quizzes-test.helper';

describe('QuizzesService Docker Integration', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let quizzesService: QuizzesService;

  beforeAll(async () => {
    const testApp = await createQuizzesTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    quizzesService = testApp.moduleRef.get(QuizzesService);
  });

  beforeEach(async () => {
    await resetQuizzesTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('getSolvedWithImportance', () => {
    it('사용자가 없으면 404 예외를 던진다', async () => {
      // Given
      // 존재하지 않는 사용자 ID만 준비한다.

      // When
      // 없는 사용자로 중요도 그룹 조회를 시도한다.
      const result = quizzesService.getSolvedWithImportance(999);

      // Then
      // 사용자 부재가 NotFoundException으로 유지되는지 검증한다.
      await expect(result).rejects.toThrow(NotFoundException);
    });

    it('완료된 solved quiz를 중요도별 high normal low 그룹으로 매핑한다', async () => {
      // Given
      // 사용자와 중요도가 다른 solved quiz 데이터를 함께 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(3));
      const user = await seedUser(dataSource);
      const mainQuizRepo = dataSource.getRepository(MainQuiz);
      await seedSolvedQuizFixtures(dataSource, user, mainQuizRepo);

      // When
      // 사용자의 중요도 그룹 데이터를 조회한다.
      const result = await quizzesService.getSolvedWithImportance(user.userId);

      // Then
      // 각 중요도 그룹에 최신 완료 데이터가 올바르게 매핑되는지 검증한다.
      expect(result.high).toHaveLength(1);
      expect(result.normal).toHaveLength(1);
      expect(result.low).toHaveLength(1);
      expect(result.high[0].mainQuizId).toBeDefined();
      expect(result.high[0].category).toBe('네트워크');
    });
  });

  describe('getKeywordsByQuiz', () => {
    it('키워드가 있으면 그대로 반환한다', async () => {
      // Given
      // 키워드가 연결된 퀴즈 데이터를 적재한다.
      await seedQuizFixtures(dataSource, buildQuizVariants(1));

      // When
      // 첫 번째 퀴즈의 키워드 목록을 조회한다.
      const result = await quizzesService.getKeywordsByQuiz(1);

      // Then
      // 적재된 키워드가 서비스 결과로 그대로 반환되는지 검증한다.
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].keyword).toContain('OSI 7계층');
    });

    it('키워드가 없으면 404 예외를 던진다', async () => {
      // Given
      // 키워드를 제거한 퀴즈를 적재한다.
      const [quiz] = buildQuizVariants(1);
      await seedQuizFixtures(dataSource, [{ ...quiz, keywords: [] }]);

      // When
      // 키워드가 없는 퀴즈의 키워드 목록을 조회한다.
      const result = quizzesService.getKeywordsByQuiz(1);

      // Then
      // 빈 키워드 세트가 NotFoundException으로 번역되는지 검증한다.
      await expect(result).rejects.toThrow(NotFoundException);
    });
  });
});
