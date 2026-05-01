import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,

  // app.module.ts와 동일한 경로 사용
  entities: [
    join(__dirname, '..', 'datasources/entities/**/*.entity{.ts,.js}'),
  ],
  migrations: [join(__dirname, '..', 'datasources/migration/*{.ts,.js}')],

  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  logging: process.env.DB_LOGGING === 'true' || process.env.NODE_ENV !== 'test',

  extra: {
    parseInt8: true,
  },
});
