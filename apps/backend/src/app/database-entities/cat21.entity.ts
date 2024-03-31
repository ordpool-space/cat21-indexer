import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('cat21')
export class Cat21Entity {

  @PrimaryColumn('varchar', { length: 64 })
  transactionId: string;

  @Column()
  blockId: string;

  @Column()
  number: number;

  @Column()
  feeRate: number;

  @Column()
  blockHeight: number;

  @Column()
  blockTime: number;

  @Column()
  fee: number;

  @Column()
  size: number;

  @Column()
  weight: number;

  @Column()
  value: number;

  @Column()
  sat: number;

  @Column()
  firstOwner: string;
}
