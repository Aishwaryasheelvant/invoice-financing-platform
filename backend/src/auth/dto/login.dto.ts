import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'sme@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'GoodPass123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
