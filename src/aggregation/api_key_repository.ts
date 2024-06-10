import { isEmail } from "validator";
import { Pool } from "pg";

const apiKeyRegex = /^[a-zA-Z0-9-]{32}$/;

const findUserByApiKeyQuery =
  "select id, key, email, enabled, staff, created_at, updated_at from account where key = $1";

const findUserByEmailQuery =
  "select id, key, email, enabled, staff, created_at, updated_at from account where email = $1";

interface User {
  id: number;
  key: string;
  email: string;
  enabled: boolean;
  staff: boolean;
  created_at: Date;
  updated_at: Date;
}

export default class ApiKeyRepository {
  constructor(db: Pool) {
    this.db = db;
  }

  db: Pool;

  isApiKeyValid(apiKey: string): boolean {
    return apiKeyRegex.test(apiKey);
  }

  isValidEmail(email: string): boolean {
    return isEmail(email) && email.length <= 100;
  }

  async findUserByApiKey(apiKey: string, db: Pool): Promise<User | unknown> {
    const results = await db.query(findUserByApiKeyQuery, [apiKey]);
    if (results.rows.length > 0) {
      return results.rows[0];
    }

    return null;
  }

  async findUserByEmail(email: string, db: Pool): Promise<User | unknown> {
    const results = await db.query(findUserByEmailQuery, [email]);
    if (results.rows.length > 0) {
      return results.rows[0];
    }

    return null;
  }
}
