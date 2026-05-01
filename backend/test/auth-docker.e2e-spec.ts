import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { WinstonModule } from 'nest-winston';
import { QuizModule } from '../src/modules/quizzes/quizzes.module';
import { ChecklistItem } from '../src/datasources/entities/tb-checklist-item.entity';
import { Flashcard } from '../src/datasources/entities/tb-flashcard.entity';
import { MainQuiz } from '../src/datasources/entities/tb-main-quiz.entity';
import { MultipleChoice } from '../src/datasources/entities/tb-multiple-choice.entity';
import { MultipleChoiceOption } from '../src/datasources/entities/tb-multiple-choice-option.entity';
import { QuizCategory } from '../src/datasources/entities/tb-quiz-category.entity';
import { QuizKeyword } from '../src/datasources/entities/tb-quiz-keyword.entity';
import { SolvedQuiz } from '../src/datasources/entities/tb-solved-quiz.entity';
import { UserChecklistProgress } from '../src/datasources/entities/tb-user-checklist-progress.entity';
import { User } from '../src/datasources/entities/tb-user.entity';
import { InitialSchema1000000000000 } from '../src/datasources/migration/1000000000000-InitialSchema';
import { AddColumSolvedState1769270302275 } from '../src/datasources/migration/1769270302275-AddColumSolvedState';
import { AddGuestProviderToUser1769507586000 } from '../src/datasources/migration/1769507586000-AddGuestProviderToUser';
import { UpdateColumnImportance1769528974558 } from '../src/datasources/migration/1769528974558-UpdateColumnImportance';

describe('Quizzes Docker E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        WinstonModule.forRoot({
          transports: [],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          username: process.env.DB_USERNAME,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_DATABASE,
          entities: [
            ChecklistItem,
            Flashcard,
            MainQuiz,
            MultipleChoice,
            MultipleChoiceOption,
            QuizCategory,
            QuizKeyword,
            SolvedQuiz,
            UserChecklistProgress,
            User,
          ],
          migrations: [
            InitialSchema1000000000000,
            AddColumSolvedState1769270302275,
            AddGuestProviderToUser1769507586000,
            UpdateColumnImportance1769528974558,
          ],
          migrationsRun: true,
          synchronize: false,
          logging: false,
          extra: {
            parseInt8: true,
          },
        }),
        QuizModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "tb_main_quiz", "tb_quiz_category" RESTART IDENTITY CASCADE',
    );

    await dataSource
      .getRepository(QuizCategory)
      .save([{ name: '백엔드' }, { name: '프론트엔드' }]);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/quizzes/categories returns categories stored in postgres', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/quizzes/categories')
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(
      response.body.map((category: QuizCategory) => category.name),
    ).toEqual(expect.arrayContaining(['백엔드', '프론트엔드']));
  });
});
