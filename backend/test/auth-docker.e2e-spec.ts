import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { initializeTransactionalContext } from 'typeorm-transactional';
import { AppModule } from '../src/app.module';
import { Provider } from '../src/datasources/entities/tb-user.entity';
import { UserRepository } from '../src/datasources/repositories/tb-user.repository';

describe('Auth Docker E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let userRepository: UserRepository;

  beforeAll(async () => {
    initializeTransactionalContext();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
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
    app.setGlobalPrefix('api');

    await app.init();

    dataSource = app.get(DataSource);
    userRepository = app.get(UserRepository);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE "tb_user" RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /api/auth/login/test stores user in postgres and refresh token in redis', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login/test')
      .send({ username: 'docker-e2e-user' })
      .expect(201);

    expect(loginResponse.body.success).toBe(true);
    expect(loginResponse.body.data.success).toBe(true);

    const persistedUser = await userRepository.findByProvider(
      Provider.GUEST,
      'test-user-id',
    );
    expect(persistedUser).not.toBeNull();
    expect(persistedUser?.username).toBe('docker-e2e-user');

    const setCookie = loginResponse.headers['set-cookie'];
    expect(setCookie).toEqual(expect.arrayContaining([expect.stringContaining('refreshToken=')]));
    expect(setCookie).toEqual(expect.arrayContaining([expect.stringContaining('accessToken=')]));

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', setCookie)
      .expect(201)
      .expect(({ body, headers }) => {
        expect(body.success).toBe(true);
        expect(body.data.success).toBe(true);
        expect(headers['set-cookie']).toEqual(
          expect.arrayContaining([expect.stringContaining('accessToken=')]),
        );
      });
  });
});
