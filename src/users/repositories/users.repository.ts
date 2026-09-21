import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/**
 * TypeORM 0.3 dropped the @EntityRepository decorator, so the current
 * idiomatic replacement is a plain injectable class wrapping a
 * Repository<T> and exposing domain-specific query methods. Services
 * depend on this, never on Repository<User> directly.
 */
@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  private repo(manager?: EntityManager): Repository<User> {
    return manager ? manager.getRepository(User) : this.repository;
  }

  findById(id: string, manager?: EntityManager): Promise<User | null> {
    return this.repo(manager).findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  async create(data: Pick<User, 'email' | 'passwordHash' | 'role' | 'companyName' | 'status'>): Promise<User> {
    const user = this.repository.create(data);
    return this.repository.save(user);
  }
}
