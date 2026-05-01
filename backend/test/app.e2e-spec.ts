import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { initializeTransactionalContext } from 'typeorm-transactional';
import cookieParser from 'cookie-parser';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    initializeTransactionalContext();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET) requires authentication', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(401)
      .expect(({ body }) => {
        expect(body.success).toBe(false);
        expect(body.errorCode).toBe('ACCESS_DENIED');
      });
  });
});
