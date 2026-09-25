import { PrimaryGeneratedColumn } from 'typeorm';

/**
 * Not named BaseEntity to avoid confusion with TypeORM's own
 * ActiveRecord-style BaseEntity, which this project does not use.
 */
export abstract class UuidEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;
}
