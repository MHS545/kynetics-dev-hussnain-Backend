// PostgreSQL user row fields used by the users module. No ORM or schema change.
export interface UserEntity {
  id: string;
  email: string;
  metadata: Record<string, unknown>;
  active: boolean;
  created_at: Date | string;
}
