import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: 5432,
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'algo9619',
    database: process.env.POSTGRES_DB || 'scraperdb',
    entities: [__dirname + '/entities/*.entity.ts'],
    migrations: [__dirname + '/migrations/*.ts'],
    synchronize: true,
});
