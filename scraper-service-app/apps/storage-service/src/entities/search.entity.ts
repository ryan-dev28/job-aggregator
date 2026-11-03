import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class Search {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => User, user => user.searches)
    user: User;

    @Column()
    name: string;

    @Column({ nullable: true })
    title?: string;

    @Column({ nullable: true })
    location?: string;

    @Column({ nullable: true })
    company?: string;

    @Column({ nullable: true })
    salary?: string;

    @Column({ nullable: true })
    keywords?: string;

    @Column({ nullable: true })
    datePosted?: string;

    @Column({ nullable: true })
    revenue?: string;

    @Column({ nullable: true })
    industry?: string;

    @Column({ default: false })
    alert: boolean;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}