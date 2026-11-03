import { Entity, Column, PrimaryGeneratedColumn, Index, AfterInsert, AfterUpdate } from 'typeorm';

@Entity()
@Index(['jobSignature'], { unique: true })
@Index('IDX_SEARCH_VECTOR', ['searchvector'], { fulltext: true })
export class Job {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    title: string;

    @Column()
    company: string;

    @Column({ nullable: true })
    jobUrl: string;

    @Column({ nullable: true })
    datePosted?: string;

    @Column({ nullable: true })
    location?: string;

    @Column({ nullable: true })
    salary?: string;

    @Column({ nullable: true })
    revenue?: string;

    @Column({ nullable: true })
    industry?: string;

    @Column('text')
    description: string;

    @Column({ nullable: true })
    source: string;

    @Column({ unique: true })
    jobSignature: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({
        type: 'tsvector',
        select: false,
        nullable: true,
        transformer: {
            to: () => null,
            from: (value: string) => value
        }
    })
    searchvector: string;

    @AfterInsert()
    @AfterUpdate()
    updateSearchVector() {
        this.searchvector = `${this.title} ${this.company} ${this.description} ${this.salary} ${this.location} ${this.revenue} ${this.industry} ${this.datePosted}`;
    }
}