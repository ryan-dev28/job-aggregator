import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Search } from './search.entity';
@Entity()
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    email: string;

    @Column()
    password: string;

    @Column({ nullable: true })
    firstName: string;

    @Column({ nullable: true })
    lastName: string;

    @Column({ default: false })
    isVerified: boolean;

    @Column({ nullable: true, type: 'text' })
    verificationCode: string | null;

    @Column({ nullable: true, type: 'date' })
    verificationExpiry: Date | null;

    @OneToMany(() => Search, search => search.user)
    searches: Search[];

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}