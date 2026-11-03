import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageServiceModule } from './storage-service.module';
import { Job } from './entities/job.entity';
import { User } from './entities/user.entity';
import { Search } from './entities/search.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
                const dbHost = configService.get<string>('DB_HOST', 'localhost');
                const isCloudRunSocket = dbHost.includes('/cloudsql/');

                return {
                    type: 'postgres',
                    host: dbHost,
                    port: configService.get<number>('DB_PORT', 5432),
                    username: configService.get<string>('DB_USER'),
                    password: configService.get<string>('DB_PASS'),
                    database: configService.get<string>('DB_NAME'),
                    entities: [Job, User, Search],
                    synchronize: configService.get<string>('NODE_ENV') !== 'production',
                    ssl: !isCloudRunSocket,
                    extra: isCloudRunSocket ? {
                        socketPath: dbHost
                    } : {
                        ssl: !isCloudRunSocket ? {
                            rejectUnauthorized: false
                        } : undefined
                    }
                }
            },
            inject: [ConfigService]
        }),
        StorageServiceModule,
    ],
})
export class AppModule { }
