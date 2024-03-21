import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('allowlist')
export class AllowlistEntity {

  @PrimaryGeneratedColumn()
  allowlistId: number;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column()
  level: string;
}
