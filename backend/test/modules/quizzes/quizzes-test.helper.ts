import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule, WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { QuizModule } from 'src/modules/quizzes/quizzes.module';
import { ApiResponseInterceptor } from 'src/common/interceptors/api-response.interceptor';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';
import { ChecklistItem } from 'src/datasources/entities/tb-checklist-item.entity';
import {
  DifficultyLevel,
  MainQuiz,
} from 'src/datasources/entities/tb-main-quiz.entity';
import { MultipleChoice } from 'src/datasources/entities/tb-multiple-choice.entity';
import { MultipleChoiceOption } from 'src/datasources/entities/tb-multiple-choice-option.entity';
import { QuizCategory } from 'src/datasources/entities/tb-quiz-category.entity';
import { QuizKeyword } from 'src/datasources/entities/tb-quiz-keyword.entity';
import {
  Importance,
  SolvedQuiz,
  SolvedState,
} from 'src/datasources/entities/tb-solved-quiz.entity';
import { UserChecklistProgress } from 'src/datasources/entities/tb-user-checklist-progress.entity';
import { Provider, User } from 'src/datasources/entities/tb-user.entity';
import { InitialSchema1000000000000 } from 'src/datasources/migration/1000000000000-InitialSchema';
import { AddColumSolvedState1769270302275 } from 'src/datasources/migration/1769270302275-AddColumSolvedState';
import { AddGuestProviderToUser1769507586000 } from 'src/datasources/migration/1769507586000-AddGuestProviderToUser';
import { UpdateColumnImportance1769528974558 } from 'src/datasources/migration/1769528974558-UpdateColumnImportance';

interface SampleChoice {
  option: string;
  isCorrect: boolean;
  explanation?: string;
}

interface SampleMultipleChoice {
  content: string;
  options: SampleChoice[];
}

interface SampleKeyword {
  keyword: string;
  description?: string;
}

interface SampleQuiz {
  mainQuizId: number;
  categoryName: string;
  difficulty: string;
  mainQuiz: {
    title: string;
    content: string;
    hint?: string;
  };
  multipleChoices?: SampleMultipleChoice[];
  checklist?: string[];
  keywords?: SampleKeyword[];
}

interface SampleSolvedQuiz {
  userId?: number;
  mainQuizId: number;
  speechText: string;
  importance?: Importance;
  solvedState?: SolvedState;
  createdAt?: string;
}

interface SampleData {
  quizzes: SampleQuiz[];
  multiple_choice_quizzes?: Array<{
    mainQuizId: number;
    content: string;
    choices: SampleChoice[];
  }>;
  solvedQuizzes?: SampleSolvedQuiz[];
  solved_quizzes?: SampleSolvedQuiz[];
}

const SAMPLE_DATA_PATH = join(process.cwd(), 'docs/test/data-sample.json');

export function loadSampleData(): SampleData {
  return JSON.parse(readFileSync(SAMPLE_DATA_PATH, 'utf8')) as SampleData;
}

export function mapDifficultyLevel(value: string): DifficultyLevel {
  switch (value) {
    case '상':
      return DifficultyLevel.HARD;
    case '중':
      return DifficultyLevel.MEDIUM;
    default:
      return DifficultyLevel.EASY;
  }
}

export function buildQuizVariants(count: number): SampleQuiz[] {
  const { quizzes } = loadSampleData();
  const template = quizzes[0];
  const categories = ['네트워크', '운영체제', '데이터베이스'];
  const difficulties = [
    DifficultyLevel.HARD,
    DifficultyLevel.MEDIUM,
    DifficultyLevel.EASY,
  ];

  return Array.from({ length: count }, (_, index) => ({
    ...template,
    mainQuizId: index + 1,
    categoryName: categories[index % categories.length],
    difficulty: difficulties[index % difficulties.length],
    mainQuiz: {
      title: `${template.mainQuiz.title} ${index + 1}`,
      content: `${template.mainQuiz.content.slice(0, 180)} ${index + 1}`,
      hint: `${template.mainQuiz.hint ?? '힌트'} ${index + 1}`,
    },
    checklist: template.checklist?.map((item, checklistIndex) => {
      return `${item} ${index + 1}-${checklistIndex + 1}`;
    }),
    keywords: template.keywords?.map((keyword, keywordIndex) => ({
      keyword: `${keyword.keyword} ${index + 1}-${keywordIndex + 1}`,
      description: keyword.description,
    })),
    multipleChoices: template.multipleChoices?.map(
      (multipleChoice, mcIndex) => ({
        content: `${multipleChoice.content} ${index + 1}-${mcIndex + 1}`,
        options: multipleChoice.options.map((option, optionIndex) => ({
          option: `${option.option} ${index + 1}-${optionIndex + 1}`,
          isCorrect: option.isCorrect,
          explanation:
            optionIndex === 0
              ? option.explanation
              : optionIndex === 1
                ? undefined
                : option.explanation,
        })),
      }),
    ),
  }));
}

export async function createQuizzesTestApp(): Promise<{
  app: INestApplication<App>;
  dataSource: DataSource;
  moduleRef: TestingModule;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      WinstonModule.forRoot({
        transports: [new winston.transports.Console({ silent: true })],
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

  const app = moduleRef.createNestApplication<App>();
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
  app.useGlobalFilters(
    new HttpExceptionFilter(moduleRef.get(WINSTON_MODULE_NEST_PROVIDER)),
  );
  app.setGlobalPrefix('api');
  await app.init();

  return {
    app,
    dataSource: moduleRef.get(DataSource),
    moduleRef,
  };
}

export async function resetQuizzesTables(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "tb_user_checklist_progress", "tb_solved_quiz", "tb_multiple_choice_option", "tb_multiple_choice", "tb_quiz_keywords", "tb_checklist_item", "tb_main_quiz", "tb_quiz_category", "tb_user" RESTART IDENTITY CASCADE',
  );
}

export async function seedQuizFixtures(
  dataSource: DataSource,
  quizzes: SampleQuiz[],
): Promise<void> {
  const categoryRepo = dataSource.getRepository(QuizCategory);
  const mainQuizRepo = dataSource.getRepository(MainQuiz);
  const checklistRepo = dataSource.getRepository(ChecklistItem);
  const keywordRepo = dataSource.getRepository(QuizKeyword);
  const multipleChoiceRepo = dataSource.getRepository(MultipleChoice);
  const optionRepo = dataSource.getRepository(MultipleChoiceOption);

  const categoryMap = new Map<string, QuizCategory>();
  for (const quiz of quizzes) {
    if (!categoryMap.has(quiz.categoryName)) {
      const category = await categoryRepo.save({
        name: quiz.categoryName,
      });
      categoryMap.set(quiz.categoryName, category);
    }
  }

  for (const quiz of quizzes) {
    const savedQuiz = await mainQuizRepo.save({
      mainQuizId: quiz.mainQuizId,
      quizCategory: categoryMap.get(quiz.categoryName),
      difficultyLevel: mapDifficultyLevel(quiz.difficulty),
      title: quiz.mainQuiz.title,
      content: quiz.mainQuiz.content.slice(0, 255),
      hint: quiz.mainQuiz.hint?.slice(0, 255),
    });

    const checklistItems = quiz.checklist ?? [];
    for (const [index, checklist] of checklistItems.entries()) {
      await checklistRepo.save({
        mainQuiz: savedQuiz,
        content: checklist.slice(0, 255),
        sortOrder: index + 1,
      });
    }

    for (const keyword of quiz.keywords ?? []) {
      await keywordRepo.save({
        mainQuiz: savedQuiz,
        keyword: keyword.keyword.slice(0, 255),
        description: keyword.description,
      });
    }

    for (const multipleChoice of quiz.multipleChoices ?? []) {
      const savedMultipleChoice = await multipleChoiceRepo.save({
        mainQuiz: savedQuiz,
        content: multipleChoice.content.slice(0, 255),
      });

      for (const option of multipleChoice.options) {
        await optionRepo.save({
          multipleChoice: savedMultipleChoice,
          option: option.option.slice(0, 255),
          isCorrect: option.isCorrect,
          explanation: option.explanation ?? null,
        });
      }
    }
  }
}

export async function seedSolvedQuizFixtures(
  dataSource: DataSource,
  user: User,
  mainQuizRepo: Repository<MainQuiz>,
): Promise<SolvedQuiz[]> {
  const solvedQuizRepo = dataSource.getRepository(SolvedQuiz);
  const sampleData = loadSampleData();
  const solvedQuizSamples =
    sampleData.solvedQuizzes ?? sampleData.solved_quizzes ?? [];

  if (solvedQuizSamples.length > 0) {
    const seeded: SolvedQuiz[] = [];
    for (const sample of solvedQuizSamples) {
      const mainQuiz = await mainQuizRepo.findOneByOrFail({
        mainQuizId: sample.mainQuizId,
      });
      seeded.push(
        await solvedQuizRepo.save({
          user,
          mainQuiz,
          speechText: sample.speechText,
          importance: sample.importance ?? Importance.NORMAL,
          solvedState: sample.solvedState ?? SolvedState.COMPLETED,
          createdAt: sample.createdAt ? new Date(sample.createdAt) : undefined,
        }),
      );
    }
    return seeded;
  }

  const mainQuizzes = await mainQuizRepo.find({
    order: {
      mainQuizId: 'ASC',
    },
    take: 3,
  });

  return Promise.all(
    mainQuizzes.map((mainQuiz, index) => {
      const importanceValues = [
        Importance.HIGH,
        Importance.NORMAL,
        Importance.LOW,
      ];
      return solvedQuizRepo.save({
        user,
        mainQuiz,
        speechText: `샘플 풀이 답변 ${index + 1}`,
        importance: importanceValues[index] ?? Importance.NORMAL,
        solvedState: SolvedState.COMPLETED,
      });
    }),
  );
}

export async function seedUser(dataSource: DataSource): Promise<User> {
  return dataSource.getRepository(User).save({
    uuid: uuidv4(),
    username: 'importance-user',
    provider: Provider.GUEST,
    createdBy: 0,
  });
}
