import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class ContactEmailDto {
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    name: string;

    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsString()
    @Length(5, 200)
    subject: string;

    @IsNotEmpty()
    @IsString()
    @Length(10, 2000)
    message: string;
}
