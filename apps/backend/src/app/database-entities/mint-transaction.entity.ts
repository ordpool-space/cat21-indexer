import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('mint-transaction')
export class MintTransactionEntity {

  @PrimaryColumn('varchar', { length: 64 })
  transactionId: string;

  @Column()
  network: string;

  @Column()
  transactionHex: string;

  @Column()
  paymentAddress: string;

  @Column()
  recipientAddress: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
