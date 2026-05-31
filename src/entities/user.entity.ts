// import {
//   Column,
//   CreateDateColumn,
//   Entity,
//   JoinColumn,
//   ManyToOne,
//   PrimaryGeneratedColumn,
//   UpdateDateColumn,
// } from 'typeorm';

// @Entity({ name: 'users' })
// export class UserEntity {
//   @PrimaryGeneratedColumn({
//     type: 'bigint',
//     unsigned: true,
//   })
//   id: number;

//   @Column({
//     type: 'varchar',
//     length: 255,
//   })
//   name: string;

//   @Column({
//     type: 'varchar',
//     length: 255,
//     unique: true,
//   })
//   email: string;

//   @Column({
//     name: 'email_verified_at',
//     type: 'timestamp',
//     nullable: true,
//   })
//   emailVerifiedAt?: Date;

//   @Column({
//     type: 'varchar',
//     length: 255,
//     nullable: true,
//   })
//   password?: string;

//   @Column({
//     type: 'varchar',
//     length: 255,
//     nullable: true,
//   })
//   avatar?: string;

//   @Column({
//     name: 'remember_token',
//     type: 'varchar',
//     length: 100,
//     nullable: true,
//   })
//   rememberToken?: string;

//   @Column({
//     type: 'decimal',
//     precision: 20,
//     scale: 10,
//     default: 0,
//   })
//   balance: string;

//   @Column({
//     name: 'referred_by',
//     type: 'bigint',
//     nullable: true,
//   })
//   referredBy?: number;

//   @Column({
//     name: 'tier_id',
//     type: 'bigint',
//     unsigned: true,
//     nullable: true,
//   })
//   tierId?: number;

//   @Column({
//     type: 'enum',
//     enum: ['active', 'inactive', 'suspended'],
//     default: 'active',
//   })
//   status: 'active' | 'inactive' | 'suspended';

//   @CreateDateColumn({
//     name: 'created_at',
//     type: 'timestamp',
//   })
//   createdAt: Date;

//   @UpdateDateColumn({
//     name: 'updated_at',
//     type: 'timestamp',
//   })
//   updatedAt: Date;

//   // =========================
//   // Relations
//   // =========================

//   @ManyToOne(() => UserEntity, {
//     nullable: true,
//   })
//   @JoinColumn({
//     name: 'referred_by',
//   })
//   referrer?: UserEntity;
// }