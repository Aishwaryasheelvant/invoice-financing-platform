import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RegistrableRole } from '../enums/registrable-role.enum';

export class RegisterDto {
  @ApiProperty({ example: 'sme@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'GoodPass123',
    minLength: 10,
    maxLength: 72,
    description: 'Must contain an uppercase letter, a lowercase letter, and a number',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'password must contain an uppercase letter, a lowercase letter, and a number',
  })
  password: string;

  @ApiProperty({ enum: RegistrableRole, description: 'Admin accounts cannot be self-registered' })
  @IsEnum(RegistrableRole)
  role: RegistrableRole;

  @ApiProperty({ example: 'Acme Supplies Ltd.' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  companyName: string;
}
